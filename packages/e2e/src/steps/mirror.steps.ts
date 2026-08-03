import { Given, Then, When } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { ShkillsWorld } from '../world.js';

/**
 * The git mirror. The repository these steps look at is the fake GitHub the
 * scenario's server was pointed at when it started, so "the repository holds…"
 * is a statement about what really went over a socket.
 */

const PREFIX = 'skills';

function path(slug: string): string {
  return `${PREFIX}/${slug}/SKILL.md`;
}

Given(
  'the skills are mirrored into {string}',
  async function (this: ShkillsWorld, target: string) {
    const [owner, repo] = target.split('/');
    const api = await this.as(this.adminEmail());
    await api.put('/v1/admin/mirror', {
      enabled: true,
      owner,
      repo,
      branch: 'main',
      pathPrefix: PREFIX,
    });
  },
);

When('an administrator pushes the mirror', async function (this: ShkillsWorld) {
  const api = await this.as(this.adminEmail());
  this.lastMirrorRun = await api.post('/v1/admin/mirror/sync');
});

Given('the repository is unreachable', function (this: ShkillsWorld) {
  // Enough failures to cover every call a run makes, so the whole attempt fails
  // rather than half of it.
  this.repository().failNext(50, 503);
});

Given('the repository can be reached again', function (this: ShkillsWorld) {
  this.repository().failNext(0);
});

Given('the repository already holds {string}', function (this: ShkillsWorld, file: string) {
  // The fake repository is created with this file, so this step only says out
  // loud what the scenario depends on.
  assert.ok(this.repository().files().has(file), `the repository does not hold ${file}`);
});

Then('the repository holds the skill {string}', function (this: ShkillsWorld, slug: string) {
  const files = this.repository().files();
  assert.ok(
    files.has(path(slug)),
    `the repository holds ${[...files.keys()].join(', ') || 'nothing'}, not ${path(slug)}`,
  );
});

Then('the repository does not hold the skill {string}', function (this: ShkillsWorld, slug: string) {
  assert.ok(!this.repository().files().has(path(slug)), `${path(slug)} is in the repository after all`);
});

Then('the repository still holds {string}', function (this: ShkillsWorld, file: string) {
  assert.ok(this.repository().files().has(file), `${file} is gone from the repository`);
});

Then('the mirrored {string} says {string}', function (this: ShkillsWorld, slug: string, expected: string) {
  const content = this.repository().files().get(path(slug));
  assert.ok(content, `${path(slug)} is not in the repository`);
  assert.ok(content.includes(expected), `the mirrored ${slug} does not say "${expected}"`);
});

/**
 * The strongest thing this feature can claim: the repository is not a rendering
 * of the skill, it is the same bytes the CLI is told to write.
 */
Then(
  'the mirrored {string} is exactly what a machine is given',
  async function (this: ShkillsWorld, slug: string) {
    const api = await this.as(this.curatorEmail());
    const served = await api.text(`/v1/skills/${slug}/raw`);
    const mirrored = this.repository().files().get(path(slug));
    assert.equal(mirrored, served, 'the repository does not hold the bytes a machine would be given');
  },
);

Then(
  "the repository's index explains how to use the skills without Shkills",
  function (this: ShkillsWorld) {
    const readme = this.repository().files().get(`${PREFIX}/README.md`);
    assert.ok(readme, 'the repository has no index');
    assert.ok(readme.includes('~/.claude/skills/'), 'the index does not say where the files go');
    assert.ok(
      readme.includes('source of truth'),
      'the index does not say that an edit made in the repository will be overwritten',
    );
  },
);

Then('the mirror says it failed', function (this: ShkillsWorld) {
  const run = this.lastMirrorRun as { ok: boolean; result: { error?: string } } | undefined;
  assert.ok(run, 'no mirror run has happened in this scenario');
  assert.equal(run.ok, false, 'the mirror reported success');
  assert.ok(run.result.error, 'the mirror failed without saying why');
});

/** Publishing must not depend on the mirror, so this asks the sync API, not the repo. */
Then('the skill {string} is live for everybody', async function (this: ShkillsWorld, slug: string) {
  const api = await this.as(this.curatorEmail());
  const detail = await api.get<{ skill: { published: { version: number } | null } }>(
    `/v1/skills/${slug}`,
  );
  assert.ok(detail.skill.published, `${slug} is not published`);
});

Then('the mirror settings never mention the token', async function (this: ShkillsWorld) {
  const api = await this.as(this.adminEmail());
  const body = await api.get<unknown>('/v1/admin/mirror');
  const text = JSON.stringify(body);
  assert.ok(!/gh[pous]_/.test(text), 'the mirror settings carry something that looks like a token');
  assert.match(text, /"hasToken":true/, 'the settings do not say whether a token exists');
});

Given('{string} agrees to share {string}', async function (this: ShkillsWorld, email: string, slug: string) {
  const api = await this.as(email);
  await api.post(`/v1/skills/${slug}/share/approve`);
});
