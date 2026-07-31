import { Then, When } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import type { SkillDetail } from '../api.js';
import { ShkillsWorld } from '../world.js';

/**
 * The few criteria that are about the service rather than a screen: what the
 * API refuses, and what a machine can download before it has a CLI at all.
 */

When(
  '{string} tries to approve the proposal for {string}',
  async function (this: ShkillsWorld, email: string, slug: string) {
    const curator = await this.as(this.curatorEmail());
    const { skill } = await curator.get<{ skill: SkillDetail }>(`/v1/skills/${slug}`);
    const pending = skill.versions.find((version) => version.status === 'pending');
    assert.ok(pending, `${slug} has nothing waiting for review`);

    const api = await this.as(email);
    this.lastApiAttempt = await api.attempt('POST', `/v1/skills/versions/${pending.id}/approve`);
  },
);

When(
  '{string} tries to leave the collection {string}',
  async function (this: ShkillsWorld, email: string, slug: string) {
    const api = await this.as(email);
    this.lastApiAttempt = await api.attempt('DELETE', `/v1/subscriptions/collection/${slug}`);
  },
);

Then('the server refuses, saying {string}', function (this: ShkillsWorld, expected: string) {
  const attempt = this.lastApiAttempt;
  assert.ok(attempt, 'nothing was attempted in this scenario');
  assert.ok(attempt.status >= 400, `the server allowed it (${attempt.status})`);
  assert.ok(
    attempt.error.includes(expected),
    `the server said "${attempt.error}" (${attempt.status}), not "${expected}"`,
  );
});

Then('the installer can be downloaded', async function (this: ShkillsWorld) {
  const response = await fetch(`${this.server.url}/install.sh`);
  assert.equal(response.status, 200, 'install.sh is not being served');
  const script = await response.text();
  assert.ok(script.includes('Shkills installer'), 'install.sh is not the installer');
  assert.ok(
    script.includes(this.server.url),
    'install.sh does not point back at this server, so an installed CLI would talk to the wrong one',
  );
});

Then('the CLI it downloads can be downloaded', async function (this: ShkillsWorld) {
  const bundle = await fetch(`${this.server.url}/cli/shkills.mjs`);
  assert.equal(bundle.status, 200, 'the CLI bundle is not being served');
  assert.ok((await bundle.text()).includes('shkills'), 'the CLI bundle looks empty');

  const version = await fetch(`${this.server.url}/cli/version`);
  assert.equal(version.status, 200, 'the CLI version endpoint is not being served');
  assert.match(await version.text(), /sha256/, 'the CLI version does not carry a checksum');
});

Then('the service reports itself healthy', async function (this: ShkillsWorld) {
  const response = await fetch(`${this.server.url}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: 'shkills' });
});

Then('the session cookie is not marked Secure', async function (this: ShkillsWorld) {
  // This deployment is plain HTTP; a Secure cookie would be dropped silently by
  // the browser and the portal would sign people in and out at the same time.
  const response = await fetch(`${this.server.url}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: this.curatorEmail(),
      password: this.person(this.curatorEmail()).password,
    }),
  });
  const cookie = response.headers.get('set-cookie') ?? '';
  assert.ok(cookie.includes('HttpOnly'), `the session cookie is not HttpOnly: ${cookie}`);
  assert.ok(!/;\s*Secure/i.test(cookie), `the session cookie is marked Secure over http: ${cookie}`);
});
