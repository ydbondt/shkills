import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, login, makeUser, resetDb, sampleSkill } from './test/helpers.js';
import { startFakeGitHub, type FakeRepo } from './test/fake-github.js';
import { db } from './db.js';
import { config } from './config.js';
import { cancelScheduledMirror, desiredFiles, getMirror, runMirror, saveMirror } from './services/mirror.js';

/**
 * The mirror, against a GitHub that is not GitHub but does speak its git-data
 * API over a real socket. See `test/fake-github.ts` for why that rather than a
 * mocked `fetch`.
 */

let github: FakeRepo;
let lead: string;
let dev: string;

async function publish(cookie: string, slug: string, extra: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/api/v1/skills')
    .set('Cookie', cookie)
    .send({ ...sampleSkill, slug, ...extra });
  if (res.status !== 201) throw new Error(`publish ${slug} failed: ${res.status} ${res.text}`);
  return res.body;
}

function configure(overrides: Partial<Parameters<typeof saveMirror>[0]> = {}): void {
  saveMirror({ enabled: true, owner: 'acme', repo: 'skills', branch: 'main', pathPrefix: 'skills', ...overrides });
}

beforeEach(async () => {
  resetDb();
  db.prepare("UPDATE git_mirror SET enabled = 0, owner = '', repo = '', last_error = NULL, last_commit = NULL").run();
  github = await startFakeGitHub({ owner: 'acme', repo: 'skills' });
  config.github.api = github.url;
  config.github.token = 'ghp_a_fake_token';

  makeUser('dev@corp.test', 'member', 'Dev');
  makeUser('lead@corp.test', 'curator', 'Lead');
  lead = await login('lead@corp.test');
  dev = await login('dev@corp.test');
});

afterEach(async () => {
  cancelScheduledMirror();
  await github.stop();
});

describe('what the repository should hold', () => {
  it('holds the exact bytes a machine gets, at a predictable path', async () => {
    await publish(lead, 'commit-messages');
    configure();

    const result = await runMirror();
    expect(result.ok).toBe(true);
    expect(result.added).toContain('commit-messages/SKILL.md');

    const written = github.files().get('skills/commit-messages/SKILL.md');
    expect(written).toBeDefined();
    const served = (await request(app).get('/api/v1/skills/commit-messages/raw').set('Cookie', dev)).text;
    // One renderer: whatever a laptop is told to write is what the repo holds.
    expect(written).toBe(served);
  });

  it('writes an index that explains what the repository is', async () => {
    await publish(lead, 'commit-messages');
    configure();
    await runMirror();

    const readme = github.files().get('skills/README.md')!;
    expect(readme).toContain('Shkills is the source of truth');
    expect(readme).toContain('~/.claude/skills/');
    expect(readme).toContain('commit-messages/SKILL.md');
  });

  it('never mirrors somebody\'s personal skill', async () => {
    await publish(lead, 'commit-messages');
    await publish(dev, 'scratch-notes', { visibility: 'personal' });
    configure();

    await runMirror();

    const paths = [...github.files().keys()];
    expect(paths).toContain('skills/commit-messages/SKILL.md');
    expect(paths.some((p) => p.includes('scratch-notes'))).toBe(false);
    expect(github.files().get('skills/README.md')).not.toContain('scratch-notes');
  });

  it('mirrors a personal skill only once it has been shared', async () => {
    await publish(dev, 'scratch-notes', { visibility: 'personal' });
    configure();
    await runMirror();
    expect([...github.files().keys()].some((p) => p.includes('scratch-notes'))).toBe(false);

    await request(app).post('/api/v1/skills/scratch-notes/share').set('Cookie', dev);
    await request(app).post('/api/v1/skills/scratch-notes/share/approve').set('Cookie', lead);
    await runMirror();

    expect(github.files().has('skills/scratch-notes/SKILL.md')).toBe(true);
  });

  it('leaves out a skill that has never been approved', async () => {
    await publish(dev, 'proposed-only', { submitForReview: true });
    configure();
    await runMirror();
    expect([...github.files().keys()].some((p) => p.includes('proposed-only'))).toBe(false);
  });

  it('keeps the file the mirror does not own', async () => {
    await publish(lead, 'commit-messages');
    configure();
    await runMirror();
    // The fake repository starts with a NOTES.md at the root.
    expect(github.files().get('NOTES.md')).toBe('# Not ours\n');
  });
});

describe('keeping the repository up to date', () => {
  it('commits a change as an update, not a second copy', async () => {
    await publish(lead, 'commit-messages');
    configure();
    await runMirror();

    await request(app)
      .post('/api/v1/skills/commit-messages/versions')
      .set('Cookie', lead)
      .send({ ...sampleSkill, body: 'A different rule entirely, worth at least twenty characters.' });

    const second = await runMirror();
    // The index carries the version, so it moves with the skill.
    expect(second.updated.sort()).toEqual(['README.md', 'commit-messages/SKILL.md']);
    expect(second.added).toEqual([]);
    expect(github.files().get('skills/commit-messages/SKILL.md')).toContain('A different rule entirely');
    expect(github.commits()).toHaveLength(2);
    expect(github.commits()[1].message).toContain('Update commit-messages');
  });

  it('removes a skill that was archived', async () => {
    await publish(lead, 'commit-messages');
    await publish(lead, 'code-review');
    configure();
    await runMirror();
    expect(github.files().has('skills/code-review/SKILL.md')).toBe(true);

    await request(app).delete('/api/v1/skills/code-review').set('Cookie', lead);
    const result = await runMirror();

    expect(result.removed).toContain('code-review/SKILL.md');
    expect(github.files().has('skills/code-review/SKILL.md')).toBe(false);
    expect(github.files().has('skills/commit-messages/SKILL.md')).toBe(true);
    expect(github.commits()[1].message).toContain('Remove code-review');
  });

  it('does nothing at all when nothing has changed', async () => {
    await publish(lead, 'commit-messages');
    configure();
    await runMirror();
    const after = github.commits().length;

    const again = await runMirror();
    expect(again.ok).toBe(true);
    expect(again.commit).toBeNull();
    expect(github.commits()).toHaveLength(after);
  });

  it('repairs a mirror that somebody edited by hand', async () => {
    await publish(lead, 'commit-messages');
    configure();
    await runMirror();

    // Somebody edits the mirror directly. Shkills is the source of truth, so the
    // next run puts it back rather than trying to work out who is right.
    const repo = { owner: 'acme', repo: 'skills', branch: 'main' };
    const { commitChanges, headCommit } = await import('./github.js');
    await commitChanges(repo, await headCommit(repo), 'hand edit', [
      { path: 'skills/commit-messages/SKILL.md', content: 'rubbish' },
    ]);
    expect(github.files().get('skills/commit-messages/SKILL.md')).toBe('rubbish');

    const result = await runMirror();
    expect(result.updated).toContain('commit-messages/SKILL.md');
    expect(github.files().get('skills/commit-messages/SKILL.md')).toContain('name: commit-messages');
  });

  it('starts a repository that has no commits yet', async () => {
    await github.stop();
    github = await startFakeGitHub({ owner: 'acme', repo: 'skills', empty: true });
    config.github.api = github.url;

    await publish(lead, 'commit-messages');
    configure();
    const result = await runMirror();

    expect(result.ok).toBe(true);
    expect(github.files().has('skills/commit-messages/SKILL.md')).toBe(true);
  });

  it('can mirror to the root of the repository', async () => {
    await publish(lead, 'commit-messages');
    configure({ pathPrefix: '' });
    await runMirror();
    expect(github.files().has('commit-messages/SKILL.md')).toBe(true);
    // Still not touching what it does not own.
    expect(github.files().get('NOTES.md')).toBe('# Not ours\n');
  });

  it('only ever deletes files of the shape it writes', async () => {
    await publish(lead, 'commit-messages');
    configure();
    await runMirror();

    // Somebody keeps their own notes inside the mirrored directory. Deleting
    // "everything I did not write" would take them with it.
    const repo = { owner: 'acme', repo: 'skills', branch: 'main' };
    const { commitChanges, headCommit } = await import('./github.js');
    await commitChanges(repo, await headCommit(repo), 'notes', [
      { path: 'skills/HOW-WE-USE-THESE.md', content: 'ours, not the mirror\'s\n' },
      { path: 'skills/commit-messages/rationale.md', content: 'why we do it this way\n' },
    ]);

    await request(app).delete('/api/v1/skills/commit-messages').set('Cookie', lead);
    const result = await runMirror();

    expect(result.removed).toEqual(['commit-messages/SKILL.md']);
    expect(github.files().get('skills/HOW-WE-USE-THESE.md')).toContain('ours, not');
    expect(github.files().get('skills/commit-messages/rationale.md')).toContain('why we do it');
  });
});

describe('when GitHub will not play', () => {
  it('records the reason and never throws', async () => {
    await publish(lead, 'commit-messages');
    configure();
    github.failNext(1, 500);

    const result = await runMirror();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('500');
    expect(getMirror().lastError).toContain('500');
  });

  it('publishing a skill still succeeds while the mirror is broken', async () => {
    configure();
    github.failNext(20, 503);

    const res = await request(app).post('/api/v1/skills').set('Cookie', lead).send(sampleSkill);
    expect(res.status).toBe(201);
    // And the skill really is live for the people who need it.
    const sync = await request(app).get('/api/v1/sync').set('Cookie', lead);
    expect(sync.status).toBe(200);
  });

  it('catches up by itself once GitHub comes back', async () => {
    await publish(lead, 'commit-messages');
    configure();
    github.failNext(1, 503);
    expect((await runMirror()).ok).toBe(false);

    const result = await runMirror();
    expect(result.ok).toBe(true);
    expect(github.files().has('skills/commit-messages/SKILL.md')).toBe(true);
    expect(getMirror().lastError).toBeNull();
  });

  it('refuses to run when nothing is set up', async () => {
    const result = await runMirror();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not set up');
    expect(github.requests).toHaveLength(0);
  });

  it('does not run when a token is missing, however configured it looks', async () => {
    configure();
    config.github.token = '';
    const result = await runMirror();
    expect(result.ok).toBe(false);
    expect(github.requests).toHaveLength(0);
    config.github.token = 'ghp_a_fake_token';
  });
});

describe('setting it up', () => {
  it('is an administrator\'s decision, not a curator\'s', async () => {
    const asCurator = await request(app)
      .put('/api/v1/admin/mirror')
      .set('Cookie', lead)
      .send({ enabled: true, owner: 'acme', repo: 'skills', branch: 'main', pathPrefix: 'skills' });
    expect(asCurator.status).toBe(403);
  });

  it('never hands the token back, to anybody', async () => {
    makeUser('boss@corp.test', 'admin', 'Boss');
    const admin = await login('boss@corp.test');
    await request(app)
      .put('/api/v1/admin/mirror')
      .set('Cookie', admin)
      .send({ enabled: true, owner: 'acme', repo: 'skills', branch: 'main', pathPrefix: 'skills' });

    const res = await request(app).get('/api/v1/admin/mirror').set('Cookie', admin);
    expect(res.status).toBe(200);
    expect(res.body.mirror.owner).toBe('acme');
    // It says whether a token exists, never what it is.
    expect(res.body.mirror.hasToken).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('ghp_');
  });

  it('lets an administrator push on demand and says what happened', async () => {
    makeUser('boss@corp.test', 'admin', 'Boss');
    const admin = await login('boss@corp.test');
    await publish(lead, 'commit-messages');
    await request(app)
      .put('/api/v1/admin/mirror')
      .set('Cookie', admin)
      .send({ enabled: true, owner: 'acme', repo: 'skills', branch: 'main', pathPrefix: 'skills' });

    const res = await request(app).post('/api/v1/admin/mirror/sync').set('Cookie', admin);
    expect(res.status).toBe(200);
    expect(res.body.result.added).toContain('commit-messages/SKILL.md');
    expect(github.files().has('skills/commit-messages/SKILL.md')).toBe(true);
  });

  it('tidies a prefix somebody typed with slashes round it', async () => {
    configure({ pathPrefix: '/company/skills/' });
    expect(getMirror().pathPrefix).toBe('company/skills');
  });

  it('gives every published company skill a file, and nothing else one', async () => {
    await publish(lead, 'commit-messages');
    await publish(dev, 'scratch-notes', { visibility: 'personal' });
    await publish(dev, 'proposed-only', { submitForReview: true });

    expect([...desiredFiles().keys()].sort()).toEqual(['README.md', 'commit-messages/SKILL.md']);
  });
});
