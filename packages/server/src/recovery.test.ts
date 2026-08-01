import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, login, makeUser, resetDb } from './test/helpers.js';
import { db } from './db.js';
import { hashToken } from './auth.js';

/**
 * Recovering a lost password.
 *
 * The tests below are about the two things that make it either a way back in or
 * a way in: that a link is single-use and short-lived, and that the signed-out
 * page never says whether an address belongs to anybody.
 */

/** Reads the secret out of the database, standing in for reading the email. */
function linkFor(email: string): string {
  const row = db
    .prepare(
      `SELECT r.token_hash FROM password_resets r JOIN users u ON u.id = r.user_id
        WHERE u.email = ? AND r.used_at IS NULL AND r.voided_at IS NULL
        ORDER BY r.id DESC LIMIT 1`,
    )
    .get(email) as { token_hash: string } | undefined;
  if (!row) throw new Error(`no outstanding reset for ${email}`);
  return row.token_hash;
}

/**
 * The tests hold hashes, not tokens — only the person with the link has the
 * token. To drive the endpoints, put a token of our own in with a known hash.
 */
function plantToken(email: string, token: string, options: { expiresInMinutes?: number } = {}): void {
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: number };
  const minutes = options.expiresInMinutes ?? 60;
  db.prepare(
    `INSERT INTO password_resets (user_id, token_hash, delivery, expires_at)
     VALUES (?, ?, 'administrator', datetime('now', ?))`,
  ).run(user.id, hashToken(token), `${minutes >= 0 ? '+' : ''}${minutes} minutes`);
}

describe('asking for a way back in', () => {
  beforeEach(() => {
    resetDb();
    makeUser('lost@acme.test');
  });

  it('mints a link for an account that exists', async () => {
    await request(app).post('/api/v1/auth/forgot').send({ email: 'lost@acme.test' }).expect(202);
    expect(() => linkFor('lost@acme.test')).not.toThrow();
  });

  /**
   * The whole point of the constant answer. If the two cases differed in status,
   * body or the presence of a record, a signed-out stranger could ask the portal
   * who works here, one address at a time.
   */
  it('answers an unknown address exactly as it answers a known one', async () => {
    const known = await request(app).post('/api/v1/auth/forgot').send({ email: 'lost@acme.test' });
    const unknown = await request(app)
      .post('/api/v1/auth/forgot')
      .send({ email: 'nobody@acme.test' });

    expect(unknown.status).toBe(known.status);
    expect(unknown.body).toEqual(known.body);
    expect(db.prepare('SELECT COUNT(*) AS n FROM password_resets').get()).toEqual({ n: 1 });
  });

  it('says nothing about an account that has been deactivated', async () => {
    db.prepare('UPDATE users SET active = 0 WHERE email = ?').run('lost@acme.test');
    await request(app).post('/api/v1/auth/forgot').send({ email: 'lost@acme.test' }).expect(202);
    expect(db.prepare('SELECT COUNT(*) AS n FROM password_resets').get()).toEqual({ n: 0 });
  });

  /** Otherwise the signed-out page is a way to fill somebody's inbox. */
  it('asking twice in a row does not mint a second link', async () => {
    await request(app).post('/api/v1/auth/forgot').send({ email: 'lost@acme.test' }).expect(202);
    await request(app).post('/api/v1/auth/forgot').send({ email: 'lost@acme.test' }).expect(202);
    expect(db.prepare('SELECT COUNT(*) AS n FROM password_resets').get()).toEqual({ n: 1 });
  });

  it('a deployment with no mail server says an administrator will do it', async () => {
    const res = await request(app)
      .post('/api/v1/auth/forgot')
      .send({ email: 'lost@acme.test' })
      .expect(202);
    expect(res.body.delivery).toBe('administrator');
  });
});

describe('using the link', () => {
  beforeEach(() => {
    resetDb();
    makeUser('lost@acme.test');
  });

  it('names whose account it opens, before asking for a password', async () => {
    plantToken('lost@acme.test', 'good-token');
    const res = await request(app).get('/api/v1/auth/reset?token=good-token').expect(200);
    expect(res.body.email).toBe('lost@acme.test');
  });

  it('sets the new password and signs the person in', async () => {
    plantToken('lost@acme.test', 'good-token');
    const res = await request(app)
      .post('/api/v1/auth/reset')
      .send({ token: 'good-token', password: 'a-brand-new-password' })
      .expect(200);

    expect(res.body.user.email).toBe('lost@acme.test');
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('shkills_session='),
    );
    expect(cookie).toBeDefined();

    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'lost@acme.test', password: 'a-brand-new-password' })
      .expect(200);
  });

  it('the old password stops working', async () => {
    plantToken('lost@acme.test', 'good-token');
    await request(app)
      .post('/api/v1/auth/reset')
      .send({ token: 'good-token', password: 'a-brand-new-password' })
      .expect(200);
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'lost@acme.test', password: 'password123' })
      .expect(401);
  });

  it('the link works once', async () => {
    plantToken('lost@acme.test', 'good-token');
    await request(app)
      .post('/api/v1/auth/reset')
      .send({ token: 'good-token', password: 'a-brand-new-password' })
      .expect(200);
    const second = await request(app)
      .post('/api/v1/auth/reset')
      .send({ token: 'good-token', password: 'somebody-elses-choice' })
      .expect(410);
    expect(second.body.error).toMatch(/expired or has already been used/);
  });

  it('an expired link is refused', async () => {
    plantToken('lost@acme.test', 'stale-token', { expiresInMinutes: -1 });
    await request(app).get('/api/v1/auth/reset?token=stale-token').expect(410);
    await request(app)
      .post('/api/v1/auth/reset')
      .send({ token: 'stale-token', password: 'a-brand-new-password' })
      .expect(410);
  });

  it('a made-up token is refused, and says nothing else', async () => {
    const res = await request(app).get('/api/v1/auth/reset?token=not-a-real-token').expect(410);
    expect(res.body).toEqual({ error: 'this link has expired or has already been used' });
  });

  it('a short password is refused, and the link survives to be used properly', async () => {
    plantToken('lost@acme.test', 'good-token');
    await request(app).post('/api/v1/auth/reset').send({ token: 'good-token', password: 'short' }).expect(422);
    await request(app)
      .post('/api/v1/auth/reset')
      .send({ token: 'good-token', password: 'a-brand-new-password' })
      .expect(200);
  });

  /** Asking again while a link is outstanding must not leave two doors open. */
  it('a newer link kills the older one', async () => {
    plantToken('lost@acme.test', 'first-token');
    plantToken('lost@acme.test', 'second-token');
    // The second was planted directly, so retire the first the way the service
    // does: by minting through the API.
    db.prepare("UPDATE password_resets SET created_at = datetime('now', '-10 minutes')").run();
    await request(app).post('/api/v1/auth/forgot').send({ email: 'lost@acme.test' }).expect(202);

    await request(app).get('/api/v1/auth/reset?token=first-token').expect(410);
    await request(app).get('/api/v1/auth/reset?token=second-token').expect(410);
  });

  it('using one link voids every other one for that account', async () => {
    plantToken('lost@acme.test', 'first-token');
    plantToken('lost@acme.test', 'second-token');
    await request(app)
      .post('/api/v1/auth/reset')
      .send({ token: 'second-token', password: 'a-brand-new-password' })
      .expect(200);
    await request(app).get('/api/v1/auth/reset?token=first-token').expect(410);
  });
});

describe('what a reset takes back', () => {
  beforeEach(() => {
    resetDb();
    makeUser('lost@acme.test');
  });

  /**
   * Without this, resetting is cosmetic: whoever knew the old password stays
   * signed in for up to twelve hours after you have locked them out.
   */
  it('every other session is signed out', async () => {
    const stolen = await login('lost@acme.test');
    await request(app).get('/api/v1/auth/me').set('Cookie', stolen).expect(200);

    plantToken('lost@acme.test', 'good-token');
    await request(app)
      .post('/api/v1/auth/reset')
      .send({ token: 'good-token', password: 'a-brand-new-password' })
      .expect(200);

    await request(app).get('/api/v1/auth/me').set('Cookie', stolen).expect(401);
  });

  /**
   * Device tokens are separate credentials that were never derived from the
   * password, and revoking them would silently stop skills reaching every
   * machine the person owns. The reset says how many there are instead, so an
   * unfamiliar one can be noticed. See docs/security.md.
   */
  it('linked machines keep working, and are counted so they can be reviewed', async () => {
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get('lost@acme.test') as {
      id: number;
    };
    db.prepare(
      "INSERT INTO device_tokens (user_id, name, token_hash, prefix) VALUES (?, 'laptop', ?, 'abcd')",
    ).run(user.id, hashToken('shk_abcd_secret'));

    plantToken('lost@acme.test', 'good-token');
    const res = await request(app)
      .post('/api/v1/auth/reset')
      .send({ token: 'good-token', password: 'a-brand-new-password' })
      .expect(200);

    expect(res.body.linkedDevices).toBe(1);
    await request(app)
      .get('/api/v1/sync')
      .set('Authorization', 'Bearer shk_abcd_secret')
      .expect((r) => expect(r.status).not.toBe(401));
  });

  it('changing your own password the normal way does not sign you out of this browser', async () => {
    const cookie = await login('lost@acme.test');
    await request(app)
      .post('/api/v1/auth/password')
      .set('Cookie', cookie)
      .send({ current: 'password123', next: 'a-brand-new-password' })
      .expect(200)
      .then(async (res) => {
        const fresh = (res.headers['set-cookie'] as unknown as string[])
          .map((c) => c.split(';')[0])
          .join('; ');
        await request(app).get('/api/v1/auth/me').set('Cookie', fresh).expect(200);
      });

    // …but the session it replaced is gone.
    await request(app).get('/api/v1/auth/me').set('Cookie', cookie).expect(401);
  });

  /**
   * Found by running the console command: it set the password and left the
   * link it had printed a minute earlier still working. Any route that sets a
   * password has to retire the outstanding links, or taking your account back
   * leaves a spare key lying about.
   */
  it('remembering your password and changing it retires the link you asked for', async () => {
    await request(app).post('/api/v1/auth/forgot').send({ email: 'lost@acme.test' }).expect(202);
    const cookie = await login('lost@acme.test');
    const token = 'the-link-they-were-sent';
    plantToken('lost@acme.test', token);

    await request(app)
      .post('/api/v1/auth/password')
      .set('Cookie', cookie)
      .send({ current: 'password123', next: 'i-remembered-it' })
      .expect(200);

    await request(app).get(`/api/v1/auth/reset?token=${token}`).expect(410);
  });

  it('the reset is on the record', async () => {
    plantToken('lost@acme.test', 'good-token');
    await request(app)
      .post('/api/v1/auth/reset')
      .send({ token: 'good-token', password: 'a-brand-new-password' })
      .expect(200);
    const actions = (
      db.prepare('SELECT action FROM audit_log').all() as { action: string }[]
    ).map((r) => r.action);
    expect(actions).toContain('auth.password_reset');
  });
});

describe('an administrator handing over a link', () => {
  beforeEach(() => {
    resetDb();
    makeUser('boss@acme.test', 'admin');
    makeUser('lost@acme.test');
  });

  it('shows who is waiting', async () => {
    await request(app).post('/api/v1/auth/forgot').send({ email: 'lost@acme.test' }).expect(202);
    const cookie = await login('boss@acme.test');
    const res = await request(app)
      .get('/api/v1/admin/password-requests')
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body.requests).toHaveLength(1);
    expect(res.body.requests[0].email).toBe('lost@acme.test');
  });

  it('the queue never carries the link itself', async () => {
    await request(app).post('/api/v1/auth/forgot').send({ email: 'lost@acme.test' }).expect(202);
    const cookie = await login('boss@acme.test');
    const res = await request(app)
      .get('/api/v1/admin/password-requests')
      .set('Cookie', cookie)
      .expect(200);
    expect(JSON.stringify(res.body)).not.toMatch(/token|url/i);
  });

  it('mints a link that actually works', async () => {
    const cookie = await login('boss@acme.test');
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get('lost@acme.test') as {
      id: number;
    };
    const res = await request(app)
      .post(`/api/v1/admin/users/${user.id}/reset-link`)
      .set('Cookie', cookie)
      .expect(200);

    const token = new URL(res.body.url).searchParams.get('token')!;
    expect(res.body.url).toContain('/reset?token=');
    await request(app)
      .post('/api/v1/auth/reset')
      .send({ token, password: 'a-brand-new-password' })
      .expect(200);
  });

  it('handing over a link clears that person from the queue', async () => {
    await request(app).post('/api/v1/auth/forgot').send({ email: 'lost@acme.test' }).expect(202);
    const cookie = await login('boss@acme.test');
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get('lost@acme.test') as {
      id: number;
    };
    await request(app).post(`/api/v1/admin/users/${user.id}/reset-link`).set('Cookie', cookie).expect(200);

    const res = await request(app)
      .get('/api/v1/admin/password-requests')
      .set('Cookie', cookie)
      .expect(200);
    // The older request was superseded by the link the admin just handed over.
    expect(res.body.requests).toHaveLength(1);
    expect(res.body.requests[0].delivery).toBe('administrator');
  });

  it('a curator cannot mint one, and cannot see the queue', async () => {
    makeUser('curator@acme.test', 'curator');
    const cookie = await login('curator@acme.test');
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get('lost@acme.test') as {
      id: number;
    };
    await request(app).get('/api/v1/admin/password-requests').set('Cookie', cookie).expect(403);
    await request(app)
      .post(`/api/v1/admin/users/${user.id}/reset-link`)
      .set('Cookie', cookie)
      .expect(403);
  });

  it('a signed-out stranger cannot mint one', async () => {
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get('lost@acme.test') as {
      id: number;
    };
    await request(app).post(`/api/v1/admin/users/${user.id}/reset-link`).expect(401);
    await request(app).get('/api/v1/admin/password-requests').expect(401);
  });
});
