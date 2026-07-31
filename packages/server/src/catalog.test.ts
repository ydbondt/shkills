import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, login, makeUser, resetDb, sampleSkill } from './test/helpers.js';

describe('the catalog listing', () => {
  let lead: string;
  let dev: string;

  beforeEach(async () => {
    resetDb();
    makeUser('dev@corp.test', 'member', 'Dev');
    makeUser('lead@corp.test', 'curator', 'Lead');
    lead = await login('lead@corp.test');
    dev = await login('dev@corp.test');
  });

  it('shows a skill awaiting its first approval with a real name and description', async () => {
    await request(app).post('/api/v1/skills').set('Cookie', dev).send(sampleSkill);

    const { body } = await request(app).get('/api/v1/skills').set('Cookie', dev);
    const skill = body.skills[0];

    expect(skill.published).toBe(false);
    expect(skill.version).toBe(0);
    // The card has to be readable before anything is published.
    expect(skill.title).toBe(sampleSkill.title);
    expect(skill.description).toBe(sampleSkill.description);
    expect(skill.category).toBe('engineering');
    expect(skill.pendingCount).toBe(1);
  });

  it('keeps showing the live version while a revision is pending', async () => {
    await request(app).post('/api/v1/skills').set('Cookie', lead).send(sampleSkill);
    await request(app)
      .post('/api/v1/skills/commit-messages/versions')
      .set('Cookie', dev)
      .send({ ...sampleSkill, title: 'Proposed New Title' });

    const { body } = await request(app).get('/api/v1/skills').set('Cookie', dev);
    const skill = body.skills[0];

    expect(skill.title).toBe(sampleSkill.title);
    expect(skill.published).toBe(true);
    expect(skill.version).toBe(1);
    expect(skill.pendingCount).toBe(1);
  });

  it('can hide unpublished skills for callers that only want the live set', async () => {
    await request(app).post('/api/v1/skills').set('Cookie', lead).send(sampleSkill);
    await request(app)
      .post('/api/v1/skills')
      .set('Cookie', dev)
      .send({ ...sampleSkill, slug: 'in-review' });

    const all = await request(app).get('/api/v1/skills').set('Cookie', dev);
    expect(all.body.skills).toHaveLength(2);

    const liveOnly = await request(app).get('/api/v1/skills?unpublished=0').set('Cookie', dev);
    expect(liveOnly.body.skills).toHaveLength(1);
    expect(liveOnly.body.skills[0].slug).toBe('commit-messages');
  });

  it('hides archived skills unless they are asked for', async () => {
    await request(app).post('/api/v1/skills').set('Cookie', lead).send(sampleSkill);
    await request(app).delete('/api/v1/skills/commit-messages').set('Cookie', lead);

    const normal = await request(app).get('/api/v1/skills').set('Cookie', dev);
    expect(normal.body.skills).toHaveLength(0);

    const withArchived = await request(app)
      .get('/api/v1/skills?includeArchived=1')
      .set('Cookie', dev);
    expect(withArchived.body.skills).toHaveLength(1);
    expect(withArchived.body.skills[0].archived).toBe(true);
  });

  it('searches across name, title, description and tags', async () => {
    await request(app).post('/api/v1/skills').set('Cookie', lead).send(sampleSkill);
    await request(app)
      .post('/api/v1/skills')
      .set('Cookie', lead)
      .send({ ...sampleSkill, slug: 'discovery-call', title: 'Discovery Calls', tags: ['sales'] });

    const byTag = await request(app).get('/api/v1/skills?q=sales').set('Cookie', dev);
    expect(byTag.body.skills.map((s: { slug: string }) => s.slug)).toEqual(['discovery-call']);

    const byDescription = await request(app).get('/api/v1/skills?q=commit').set('Cookie', dev);
    expect(byDescription.body.skills).toHaveLength(2);
  });

  it('reports only the categories and audiences actually in use', async () => {
    await request(app).post('/api/v1/skills').set('Cookie', lead).send(sampleSkill);
    await request(app)
      .post('/api/v1/skills')
      .set('Cookie', lead)
      .send({
        ...sampleSkill,
        slug: 'discovery-call',
        category: 'sales',
        audiences: ['sales', 'marketing'],
      });

    const { body } = await request(app).get('/api/v1/skills/facets').set('Cookie', dev);
    expect(body.categories).toEqual(['engineering', 'sales']);
    expect(body.audiences).toEqual(['engineering', 'marketing', 'sales']);
  });
});
