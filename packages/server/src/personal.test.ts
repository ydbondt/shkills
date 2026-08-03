import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, login, makeUser, resetDb, sampleSkill } from './test/helpers.js';

/** A personal skill belonging to whoever holds `cookie`. */
async function makePersonal(cookie: string, slug: string, extra: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/api/v1/skills')
    .set('Cookie', cookie)
    .send({ ...sampleSkill, slug, visibility: 'personal', ...extra });
  if (res.status !== 201) throw new Error(`creating ${slug} failed: ${res.status} ${res.text}`);
  return res.body;
}

function slugs(body: { skills: { slug: string }[] }): string[] {
  return body.skills.map((s) => s.slug).sort();
}

describe('a skill of your own', () => {
  let dev: string;
  let other: string;
  let lead: string;

  beforeEach(async () => {
    resetDb();
    makeUser('dev@corp.test', 'member', 'Dev');
    makeUser('other@corp.test', 'member', 'Other');
    makeUser('lead@corp.test', 'curator', 'Lead');
    dev = await login('dev@corp.test');
    other = await login('other@corp.test');
    lead = await login('lead@corp.test');
  });

  it('is live the moment a member writes it, with nothing to review', async () => {
    const created = await makePersonal(dev, 'scratch-notes');
    expect(created.version.status).toBe('approved');

    const queue = await request(app).get('/api/v1/skills/pending').set('Cookie', lead);
    expect(queue.body.proposals).toHaveLength(0);
    expect(queue.body.shareRequests).toHaveLength(0);
  });

  it('reaches its own machines without anybody subscribing to it', async () => {
    await makePersonal(dev, 'scratch-notes');

    const mine = await request(app).get('/api/v1/sync').set('Cookie', dev);
    expect(slugs(mine.body)).toEqual(['scratch-notes']);
    expect(mine.body.skills[0].sources).toEqual(['yours']);
    expect(mine.body.skills[0].content).toContain('name: scratch-notes');
  });

  it('reaches nobody else, not even a curator', async () => {
    await makePersonal(dev, 'scratch-notes');

    const theirs = await request(app).get('/api/v1/sync').set('Cookie', other);
    expect(theirs.body.skills).toHaveLength(0);

    const leadSync = await request(app).get('/api/v1/sync').set('Cookie', lead);
    expect(leadSync.body.skills).toHaveLength(0);
  });

  it('is absent from everyone else\'s catalog, including a curator\'s', async () => {
    await makePersonal(dev, 'scratch-notes');

    const mine = await request(app).get('/api/v1/skills').set('Cookie', dev);
    expect(slugs(mine.body)).toEqual(['scratch-notes']);
    expect(mine.body.skills[0].visibility).toBe('personal');

    for (const cookie of [other, lead]) {
      const { body } = await request(app).get('/api/v1/skills').set('Cookie', cookie);
      expect(body.skills).toHaveLength(0);
    }
  });

  it('cannot be read by slug, or as raw markdown, by anybody else', async () => {
    await makePersonal(dev, 'scratch-notes');

    for (const cookie of [other, lead]) {
      expect((await request(app).get('/api/v1/skills/scratch-notes').set('Cookie', cookie)).status).toBe(404);
      expect(
        (await request(app).get('/api/v1/skills/scratch-notes/raw').set('Cookie', cookie)).status,
      ).toBe(404);
    }

    expect((await request(app).get('/api/v1/skills/scratch-notes').set('Cookie', dev)).status).toBe(200);
  });

  it('cannot be subscribed to by somebody who is not its owner', async () => {
    await makePersonal(dev, 'scratch-notes');

    const res = await request(app)
      .post('/api/v1/subscriptions')
      .set('Cookie', other)
      .send({ kind: 'skill', slug: 'scratch-notes' });
    expect(res.status).toBe(404);
  });

  it('cannot be put into a collection, which would hand it to everyone in it', async () => {
    await makePersonal(dev, 'scratch-notes');
    await request(app)
      .post('/api/v1/collections')
      .set('Cookie', lead)
      .send({ slug: 'backend', name: 'Backend' });

    const res = await request(app)
      .put('/api/v1/collections/backend/skills/scratch-notes')
      .set('Cookie', lead);
    expect(res.status).toBe(404);
  });

  it('keeps publishing revisions immediately, without a queue', async () => {
    await makePersonal(dev, 'scratch-notes');
    const revision = await request(app)
      .post('/api/v1/skills/scratch-notes/versions')
      .set('Cookie', dev)
      .send({ ...sampleSkill, body: 'A second attempt at the same idea, now with detail.' });

    expect(revision.status).toBe(201);
    expect(revision.body.version.status).toBe('approved');

    const sync = await request(app).get('/api/v1/sync').set('Cookie', dev);
    expect(sync.body.skills[0].content).toContain('A second attempt');
    expect(sync.body.skills[0].version).toBe(2);
  });

  it('can only be revised by its owner', async () => {
    await makePersonal(dev, 'scratch-notes');
    const res = await request(app)
      .post('/api/v1/skills/scratch-notes/versions')
      .set('Cookie', lead)
      .send({ ...sampleSkill, body: 'Somebody else editing a private draft.' });
    expect(res.status).toBe(404);
  });
});

describe('proposing a personal skill for sharing', () => {
  let dev: string;
  let other: string;
  let lead: string;

  beforeEach(async () => {
    resetDb();
    makeUser('dev@corp.test', 'member', 'Dev');
    makeUser('other@corp.test', 'member', 'Other');
    makeUser('lead@corp.test', 'curator', 'Lead');
    dev = await login('dev@corp.test');
    other = await login('other@corp.test');
    lead = await login('lead@corp.test');
    await makePersonal(dev, 'scratch-notes');
  });

  const ask = () => request(app).post('/api/v1/skills/scratch-notes/share').set('Cookie', dev);

  it('puts it in the review queue without publishing it', async () => {
    expect((await ask()).status).toBe(200);

    const queue = await request(app).get('/api/v1/skills/pending').set('Cookie', lead);
    expect(queue.body.shareRequests).toHaveLength(1);
    expect(queue.body.shareRequests[0]).toMatchObject({ slug: 'scratch-notes', owner: 'Dev' });
    expect(queue.body.shareRequests[0].body).toContain(sampleSkill.body);

    // Still nobody else's.
    const theirs = await request(app).get('/api/v1/skills').set('Cookie', other);
    expect(theirs.body.skills).toHaveLength(0);
  });

  it('never takes the skill off the owner\'s machine while it waits', async () => {
    await ask();
    const sync = await request(app).get('/api/v1/sync').set('Cookie', dev);
    expect(slugs(sync.body)).toEqual(['scratch-notes']);
  });

  it('lets a curator read it, because they have to in order to review it', async () => {
    const before = await request(app).get('/api/v1/skills/scratch-notes').set('Cookie', lead);
    expect(before.status).toBe(404);

    await ask();

    const during = await request(app).get('/api/v1/skills/scratch-notes').set('Cookie', lead);
    expect(during.status).toBe(200);
    // Another member still cannot.
    expect((await request(app).get('/api/v1/skills/scratch-notes').set('Cookie', other)).status).toBe(404);
  });

  it('becomes an ordinary company skill once a curator agrees', async () => {
    await ask();
    const approve = await request(app)
      .post('/api/v1/skills/scratch-notes/share/approve')
      .set('Cookie', lead);
    expect(approve.status).toBe(200);

    const theirs = await request(app).get('/api/v1/skills').set('Cookie', other);
    expect(slugs(theirs.body)).toEqual(['scratch-notes']);
    expect(theirs.body.skills[0].visibility).toBe('shared');

    // Shared means subscribable, and it keeps the history it had while private.
    const sub = await request(app)
      .post('/api/v1/subscriptions')
      .set('Cookie', other)
      .send({ kind: 'skill', slug: 'scratch-notes' });
    expect(sub.status).toBe(201);
    const sync = await request(app).get('/api/v1/sync').set('Cookie', other);
    expect(sync.body.skills[0].version).toBe(1);
  });

  it('goes back to being private when a curator declines, with the reason', async () => {
    await ask();
    const decline = await request(app)
      .post('/api/v1/skills/scratch-notes/share/decline')
      .set('Cookie', lead)
      .send({ note: 'Too close to the commit-messages skill we already have.' });
    expect(decline.status).toBe(200);

    const mine = await request(app).get('/api/v1/skills/scratch-notes').set('Cookie', dev);
    expect(mine.body.skill.visibility).toBe('personal');
    expect(mine.body.skill.shareStatus).toBe('declined');
    expect(mine.body.skill.shareNote).toContain('commit-messages');

    // And it is still on the owner's machine, which is the point of declining
    // rather than deleting.
    const sync = await request(app).get('/api/v1/sync').set('Cookie', dev);
    expect(slugs(sync.body)).toEqual(['scratch-notes']);
    expect((await request(app).get('/api/v1/skills').set('Cookie', other)).body.skills).toHaveLength(0);
  });

  it('needs a reason to decline', async () => {
    await ask();
    const res = await request(app)
      .post('/api/v1/skills/scratch-notes/share/decline')
      .set('Cookie', lead)
      .send({});
    expect(res.status).toBe(422);
  });

  it('can be withdrawn by its owner before anybody looks at it', async () => {
    await ask();
    expect((await request(app).delete('/api/v1/skills/scratch-notes/share').set('Cookie', dev)).status).toBe(
      200,
    );

    const queue = await request(app).get('/api/v1/skills/pending').set('Cookie', lead);
    expect(queue.body.shareRequests).toHaveLength(0);
    expect((await request(app).get('/api/v1/skills/scratch-notes').set('Cookie', lead)).status).toBe(404);
  });

  it('cannot be approved by a member, even straight at the API', async () => {
    await ask();
    const res = await request(app).post('/api/v1/skills/scratch-notes/share/approve').set('Cookie', other);
    expect(res.status).toBe(403);
  });

  it('cannot be asked for by somebody who does not own it', async () => {
    const res = await request(app).post('/api/v1/skills/scratch-notes/share').set('Cookie', other);
    expect(res.status).toBe(404);
  });
});

describe('sharing as a curator, and the way back', () => {
  let lead: string;
  let dev: string;

  beforeEach(async () => {
    resetDb();
    makeUser('dev@corp.test', 'member', 'Dev');
    makeUser('lead@corp.test', 'curator', 'Lead');
    dev = await login('dev@corp.test');
    lead = await login('lead@corp.test');
  });

  it('lets a curator share their own without queueing it for themselves', async () => {
    await makePersonal(lead, 'scratch-notes');
    const res = await request(app).post('/api/v1/skills/scratch-notes/share').set('Cookie', lead);
    expect(res.status).toBe(200);
    expect(res.body.shared).toBe(true);

    const { body } = await request(app).get('/api/v1/skills').set('Cookie', dev);
    expect(slugs(body)).toEqual(['scratch-notes']);
  });

  it('refuses to make a shared skill private again', async () => {
    await request(app).post('/api/v1/skills').set('Cookie', lead).send(sampleSkill);
    const res = await request(app)
      .post('/api/v1/skills/commit-messages/versions')
      .set('Cookie', lead)
      .send({ ...sampleSkill, visibility: 'personal' });
    expect(res.status).toBe(201);

    const { body } = await request(app).get('/api/v1/skills/commit-messages').set('Cookie', dev);
    // The revision went through; the visibility did not, because withdrawing a
    // skill from machines that already have it is what archiving is for.
    expect(body.skill.visibility).toBe('shared');
  });

  it('leaves personal skills out of the headline count, and puts share requests into the queue count', async () => {
    await request(app).post('/api/v1/skills').set('Cookie', lead).send(sampleSkill);
    await makePersonal(dev, 'scratch-notes');

    const before = await request(app).get('/api/v1/admin/stats').set('Cookie', dev);
    expect(before.body.stats.skills).toBe(1);
    expect(before.body.stats.pending).toBe(0);

    await request(app).post('/api/v1/skills/scratch-notes/share').set('Cookie', dev);

    const after = await request(app).get('/api/v1/admin/stats').set('Cookie', lead);
    expect(after.body.stats.skills).toBe(1);
    expect(after.body.stats.pending).toBe(1);
  });

  it('says a name is taken even when the skill holding it is somebody\'s private one', async () => {
    await makePersonal(dev, 'scratch-notes');
    const res = await request(app)
      .post('/api/v1/skills')
      .set('Cookie', lead)
      .send({ ...sampleSkill, slug: 'scratch-notes' });
    expect(res.status).toBe(409);
  });
});
