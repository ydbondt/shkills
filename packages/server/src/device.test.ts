import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, login, makeUser, resetDb, sampleSkill } from './test/helpers.js';

describe('linking a machine', () => {
  let lead: string;

  beforeEach(async () => {
    resetDb();
    makeUser('lead@corp.test', 'curator', 'Lead');
    lead = await login('lead@corp.test');
  });

  it('walks the CLI from an unclaimed code to a working token', async () => {
    const start = await request(app)
      .post('/api/v1/device/code')
      .send({ hostname: 'laptop-42' });
    expect(start.status).toBe(201);
    expect(start.body.userCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    // The CLI polls while the human is still in the browser.
    const pending = await request(app)
      .post('/api/v1/device/token')
      .send({ deviceCode: start.body.deviceCode });
    expect(pending.status).toBe(202);

    const preview = await request(app)
      .get(`/api/v1/device/pending/${start.body.userCode}`)
      .set('Cookie', lead);
    expect(preview.body.hostname).toBe('laptop-42');

    await request(app)
      .post('/api/v1/device/approve')
      .set('Cookie', lead)
      .send({ userCode: start.body.userCode });

    const claimed = await request(app)
      .post('/api/v1/device/token')
      .send({ deviceCode: start.body.deviceCode });
    expect(claimed.status).toBe(200);
    expect(claimed.body.token).toMatch(/^shk_/);

    // The token is the CLI's credential from here on.
    await request(app).post('/api/v1/skills').set('Cookie', lead).send(sampleSkill);
    await request(app)
      .post('/api/v1/subscriptions')
      .set('Cookie', lead)
      .send({ kind: 'skill', slug: 'commit-messages' });

    const synced = await request(app)
      .get('/api/v1/sync')
      .set('Authorization', `Bearer ${claimed.body.token}`);
    expect(synced.status).toBe(200);
    expect(synced.body.skills).toHaveLength(1);
  });

  it('hands the plaintext token over exactly once', async () => {
    const start = await request(app).post('/api/v1/device/code').send({ hostname: 'laptop' });
    await request(app)
      .post('/api/v1/device/approve')
      .set('Cookie', lead)
      .send({ userCode: start.body.userCode });

    expect(
      (await request(app).post('/api/v1/device/token').send({ deviceCode: start.body.deviceCode }))
        .status,
    ).toBe(200);
    expect(
      (await request(app).post('/api/v1/device/token').send({ deviceCode: start.body.deviceCode }))
        .status,
    ).toBe(409);
  });

  it('honours a denial', async () => {
    const start = await request(app).post('/api/v1/device/code').send({ hostname: 'someone-else' });
    await request(app)
      .post('/api/v1/device/deny')
      .set('Cookie', lead)
      .send({ userCode: start.body.userCode });

    const res = await request(app)
      .post('/api/v1/device/token')
      .send({ deviceCode: start.body.deviceCode });
    expect(res.status).toBe(403);
  });

  it('stops a revoked token from syncing', async () => {
    const start = await request(app).post('/api/v1/device/code').send({ hostname: 'old-laptop' });
    await request(app)
      .post('/api/v1/device/approve')
      .set('Cookie', lead)
      .send({ userCode: start.body.userCode });
    const { body } = await request(app)
      .post('/api/v1/device/token')
      .send({ deviceCode: start.body.deviceCode });

    const tokens = await request(app).get('/api/v1/tokens').set('Cookie', lead);
    expect(tokens.body.tokens).toHaveLength(1);

    await request(app).delete(`/api/v1/tokens/${tokens.body.tokens[0].id}`).set('Cookie', lead);

    const res = await request(app).get('/api/v1/sync').set('Authorization', `Bearer ${body.token}`);
    expect(res.status).toBe(401);
  });

  it('will not approve a code that does not exist', async () => {
    const res = await request(app)
      .post('/api/v1/device/approve')
      .set('Cookie', lead)
      .send({ userCode: 'ZZZZ-9999' });
    expect(res.status).toBe(404);
  });
});

describe('accounts', () => {
  beforeEach(() => resetDb());

  it('makes the very first account an admin and later ones members', async () => {
    const first = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'founder@corp.test', name: 'Founder', password: 'password123' });
    expect(first.body.user.role).toBe('admin');

    const second = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'new@corp.test', name: 'New', password: 'password123' });
    expect(second.body.user.role).toBe('member');
  });

  it('gives the same answer for a wrong password and an unknown account', async () => {
    makeUser('someone@corp.test');
    const wrongPassword = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'someone@corp.test', password: 'not-the-password' });
    const unknownUser = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@corp.test', password: 'not-the-password' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(wrongPassword.body.error).toBe(unknownUser.body.error);
  });

  it('refuses to demote the last admin', async () => {
    const adminId = makeUser('admin@corp.test', 'admin');
    const cookie = await login('admin@corp.test');
    const res = await request(app)
      .patch(`/api/v1/admin/users/${adminId}`)
      .set('Cookie', cookie)
      .send({ role: 'member' });
    expect(res.status).toBe(409);
  });
});
