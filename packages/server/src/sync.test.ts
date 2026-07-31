import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, login, makeUser, resetDb, sampleSkill } from './test/helpers.js';

async function publish(cookie: string, slug: string, extra: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/api/v1/skills')
    .set('Cookie', cookie)
    .send({ ...sampleSkill, slug, ...extra });
  if (res.status !== 201) throw new Error(`publish ${slug} failed: ${res.status} ${res.text}`);
  return res.body;
}

describe('what lands on a machine', () => {
  let lead: string;
  let dev: string;

  beforeEach(async () => {
    resetDb();
    makeUser('dev@corp.test', 'member', 'Dev');
    makeUser('lead@corp.test', 'curator', 'Lead');
    lead = await login('lead@corp.test');
    dev = await login('dev@corp.test');
  });

  it('gives a user nothing until they subscribe', async () => {
    await publish(lead, 'commit-messages');
    const res = await request(app).get('/api/v1/sync').set('Cookie', dev);
    expect(res.body.skills).toHaveLength(0);
  });

  it('delivers a directly subscribed skill as ready-to-write SKILL.md bytes', async () => {
    await publish(lead, 'commit-messages');
    await request(app)
      .post('/api/v1/subscriptions')
      .set('Cookie', dev)
      .send({ kind: 'skill', slug: 'commit-messages' });

    const res = await request(app).get('/api/v1/sync').set('Cookie', dev);
    expect(res.body.skills).toHaveLength(1);
    const skill = res.body.skills[0];
    expect(skill.content.startsWith('---\n')).toBe(true);
    expect(skill.content).toContain('name: commit-messages');
    expect(skill.content).toContain('description: "Use when writing a git commit message');
    expect(skill.sources).toEqual(['direct']);
  });

  it('delivers everything in a subscribed collection', async () => {
    await publish(lead, 'commit-messages');
    await publish(lead, 'code-review');
    await request(app)
      .post('/api/v1/collections')
      .set('Cookie', lead)
      .send({ slug: 'backend', name: 'Backend Engineering' });
    await request(app).put('/api/v1/collections/backend/skills/commit-messages').set('Cookie', lead);
    await request(app).put('/api/v1/collections/backend/skills/code-review').set('Cookie', lead);

    const before = await request(app).get('/api/v1/sync').set('Cookie', dev);
    expect(before.body.skills).toHaveLength(0);

    await request(app)
      .post('/api/v1/subscriptions')
      .set('Cookie', dev)
      .send({ kind: 'collection', slug: 'backend' });

    const after = await request(app).get('/api/v1/sync').set('Cookie', dev);
    expect(after.body.skills.map((s: { slug: string }) => s.slug).sort()).toEqual([
      'code-review',
      'commit-messages',
    ]);
    expect(after.body.skills[0].sources).toEqual(['Backend Engineering']);
  });

  it('pushes company defaults to everyone without asking', async () => {
    await publish(lead, 'security-basics');
    await request(app)
      .post('/api/v1/collections')
      .set('Cookie', lead)
      .send({ slug: 'company', name: 'Company Baseline', isDefault: true });
    await request(app).put('/api/v1/collections/company/skills/security-basics').set('Cookie', lead);

    const res = await request(app).get('/api/v1/sync').set('Cookie', dev);
    expect(res.body.skills).toHaveLength(1);
    expect(res.body.skills[0].sources[0]).toContain('company default');

    // And it cannot be opted out of — that is the point of a default.
    const drop = await request(app)
      .delete('/api/v1/subscriptions/collection/company')
      .set('Cookie', dev);
    expect(drop.status).toBe(409);
  });

  it('lists a skill once even when several collections carry it', async () => {
    await publish(lead, 'commit-messages');
    for (const [slug, name] of [
      ['backend', 'Backend'],
      ['frontend', 'Frontend'],
    ]) {
      await request(app).post('/api/v1/collections').set('Cookie', lead).send({ slug, name });
      await request(app).put(`/api/v1/collections/${slug}/skills/commit-messages`).set('Cookie', lead);
      await request(app)
        .post('/api/v1/subscriptions')
        .set('Cookie', dev)
        .send({ kind: 'collection', slug });
    }

    const res = await request(app).get('/api/v1/sync').set('Cookie', dev);
    expect(res.body.skills).toHaveLength(1);
    expect(res.body.skills[0].sources.sort()).toEqual(['Backend', 'Frontend']);
  });

  it('answers 304 while nothing has changed, and 200 the moment it does', async () => {
    await publish(lead, 'commit-messages');
    await request(app)
      .post('/api/v1/subscriptions')
      .set('Cookie', dev)
      .send({ kind: 'skill', slug: 'commit-messages' });

    const first = await request(app).get('/api/v1/sync').set('Cookie', dev);
    const etag = first.headers.etag;
    expect(etag).toBeTruthy();

    const unchanged = await request(app)
      .get('/api/v1/sync')
      .set('Cookie', dev)
      .set('If-None-Match', etag);
    expect(unchanged.status).toBe(304);

    await request(app)
      .post('/api/v1/skills/commit-messages/versions')
      .set('Cookie', lead)
      .send({ ...sampleSkill, body: 'Updated guidance that changes the published bytes.' });

    const changed = await request(app)
      .get('/api/v1/sync')
      .set('Cookie', dev)
      .set('If-None-Match', etag);
    expect(changed.status).toBe(200);
    expect(changed.body.skills[0].version).toBe(2);
  });

  it('withdraws an archived skill from the next sync', async () => {
    await publish(lead, 'commit-messages');
    await request(app)
      .post('/api/v1/subscriptions')
      .set('Cookie', dev)
      .send({ kind: 'skill', slug: 'commit-messages' });
    expect((await request(app).get('/api/v1/sync').set('Cookie', dev)).body.skills).toHaveLength(1);

    await request(app).delete('/api/v1/skills/commit-messages').set('Cookie', lead);
    expect((await request(app).get('/api/v1/sync').set('Cookie', dev)).body.skills).toHaveLength(0);

    await request(app).post('/api/v1/skills/commit-messages/restore').set('Cookie', lead);
    expect((await request(app).get('/api/v1/sync').set('Cookie', dev)).body.skills).toHaveLength(1);
  });

  it('requires authentication to sync at all', async () => {
    const res = await request(app).get('/api/v1/sync');
    expect(res.status).toBe(401);
  });
});
