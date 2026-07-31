import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, login, makeUser, resetDb, sampleSkill } from './test/helpers.js';

describe('proposal and approval workflow', () => {
  beforeEach(() => {
    resetDb();
    makeUser('dev@corp.test', 'member', 'Dev');
    makeUser('lead@corp.test', 'curator', 'Lead');
  });

  it('holds a member proposal until a curator approves it', async () => {
    const dev = await login('dev@corp.test');

    const created = await request(app)
      .post('/api/v1/skills')
      .set('Cookie', dev)
      .send(sampleSkill);
    expect(created.status).toBe(201);
    expect(created.body.version.status).toBe('pending');

    // Nothing to sync yet: an unapproved skill must never reach a machine.
    const beforeApproval = await request(app).get('/api/v1/sync').set('Cookie', dev);
    expect(beforeApproval.body.skills).toHaveLength(0);

    const lead = await login('lead@corp.test');
    const queue = await request(app).get('/api/v1/skills/pending').set('Cookie', lead);
    expect(queue.body.proposals).toHaveLength(1);
    expect(queue.body.proposals[0].isNewSkill).toBe(true);

    const approved = await request(app)
      .post(`/api/v1/skills/versions/${created.body.version.id}/approve`)
      .set('Cookie', lead)
      .send({ note: 'good' });
    expect(approved.status).toBe(200);

    const detail = await request(app).get('/api/v1/skills/commit-messages').set('Cookie', dev);
    expect(detail.body.skill.published.version).toBe(1);
    expect(detail.body.skill.published.status).toBe('approved');
  });

  it('publishes a curator’s own skill immediately', async () => {
    const lead = await login('lead@corp.test');
    const created = await request(app).post('/api/v1/skills').set('Cookie', lead).send(sampleSkill);
    expect(created.body.version.status).toBe('approved');

    const queue = await request(app).get('/api/v1/skills/pending').set('Cookie', lead);
    expect(queue.body.proposals).toHaveLength(0);
  });

  it('lets a curator opt into review for their own change', async () => {
    const lead = await login('lead@corp.test');
    const created = await request(app)
      .post('/api/v1/skills')
      .set('Cookie', lead)
      .send({ ...sampleSkill, submitForReview: true });
    expect(created.body.version.status).toBe('pending');
  });

  it('refuses to let a member approve anything', async () => {
    const lead = await login('lead@corp.test');
    const dev = await login('dev@corp.test');
    const created = await request(app).post('/api/v1/skills').set('Cookie', dev).send(sampleSkill);

    const asMember = await request(app)
      .post(`/api/v1/skills/versions/${created.body.version.id}/approve`)
      .set('Cookie', dev)
      .send({});
    expect(asMember.status).toBe(403);

    const asCurator = await request(app)
      .post(`/api/v1/skills/versions/${created.body.version.id}/approve`)
      .set('Cookie', lead)
      .send({});
    expect(asCurator.status).toBe(200);
  });

  it('keeps the live version serving while a revision is in review', async () => {
    const lead = await login('lead@corp.test');
    const dev = await login('dev@corp.test');
    await request(app).post('/api/v1/skills').set('Cookie', lead).send(sampleSkill);
    await request(app)
      .post('/api/v1/subscriptions')
      .set('Cookie', dev)
      .send({ kind: 'skill', slug: 'commit-messages' });

    const revision = await request(app)
      .post('/api/v1/skills/commit-messages/versions')
      .set('Cookie', dev)
      .send({ ...sampleSkill, body: 'Completely rewritten guidance for commit messages.' });
    expect(revision.body.version.status).toBe('pending');

    const stillOld = await request(app).get('/api/v1/sync').set('Cookie', dev);
    expect(stillOld.body.skills[0].version).toBe(1);
    expect(stillOld.body.skills[0].content).toContain('under 72 characters');

    await request(app)
      .post(`/api/v1/skills/versions/${revision.body.version.id}/approve`)
      .set('Cookie', lead)
      .send({});

    const nowNew = await request(app).get('/api/v1/sync').set('Cookie', dev);
    expect(nowNew.body.skills[0].version).toBe(2);
    expect(nowNew.body.skills[0].content).toContain('Completely rewritten');
  });

  it('records a rejection with the reason and leaves nothing published', async () => {
    const lead = await login('lead@corp.test');
    const dev = await login('dev@corp.test');
    const created = await request(app).post('/api/v1/skills').set('Cookie', dev).send(sampleSkill);

    const noReason = await request(app)
      .post(`/api/v1/skills/versions/${created.body.version.id}/reject`)
      .set('Cookie', lead)
      .send({});
    expect(noReason.status).toBe(422);

    await request(app)
      .post(`/api/v1/skills/versions/${created.body.version.id}/reject`)
      .set('Cookie', lead)
      .send({ note: 'overlaps with an existing skill' });

    const detail = await request(app).get('/api/v1/skills/commit-messages').set('Cookie', dev);
    expect(detail.body.skill.published).toBeNull();
    expect(detail.body.skill.versions[0].status).toBe('rejected');
    expect(detail.body.skill.versions[0].reviewNote).toBe('overlaps with an existing skill');
  });

  it('rolls a skill back to an earlier approved version', async () => {
    const lead = await login('lead@corp.test');
    await request(app).post('/api/v1/skills').set('Cookie', lead).send(sampleSkill);
    await request(app)
      .post('/api/v1/skills/commit-messages/versions')
      .set('Cookie', lead)
      .send({ ...sampleSkill, body: 'A second take on commit message guidance.' });

    const detail = await request(app).get('/api/v1/skills/commit-messages').set('Cookie', lead);
    expect(detail.body.skill.published.version).toBe(2);
    const v1 = detail.body.skill.versions.find((v: { version: number }) => v.version === 1);

    const rollback = await request(app)
      .post(`/api/v1/skills/versions/${v1.id}/rollback`)
      .set('Cookie', lead)
      .send({});
    expect(rollback.status).toBe(200);

    const after = await request(app).get('/api/v1/skills/commit-messages').set('Cookie', lead);
    expect(after.body.skill.published.version).toBe(1);
  });

  it('rejects a slug that is not a clean kebab-case name', async () => {
    const lead = await login('lead@corp.test');
    const bad = await request(app)
      .post('/api/v1/skills')
      .set('Cookie', lead)
      .send({ ...sampleSkill, slug: 'Commit Messages' });
    expect(bad.status).toBe(422);
  });

  it('refuses a second skill with the same name', async () => {
    const lead = await login('lead@corp.test');
    await request(app).post('/api/v1/skills').set('Cookie', lead).send(sampleSkill);
    const dupe = await request(app).post('/api/v1/skills').set('Cookie', lead).send(sampleSkill);
    expect(dupe.status).toBe(409);
  });
});
