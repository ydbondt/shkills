import { Given, Then, When } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ShkillsWorld } from '../world.js';
import { consoleResetEntry } from '../paths.js';

/**
 * Getting back in after a lost password.
 *
 * The steps below are careful about one thing: the link is never taken from
 * anywhere the person could not have taken it from. It comes out of the email
 * that was actually written, out of the portal an administrator actually
 * clicked, or off a console — never out of the database.
 */

/** The newest message written for somebody, as the file transport wrote it. */
function mailFor(world: ShkillsWorld, email: string): string | undefined {
  const dir = world.server.mailDir;
  if (!fs.existsSync(dir)) return undefined;
  const files = fs
    .readdirSync(dir)
    .filter((file) => file.includes(email.replace(/[^a-z0-9@._-]/gi, '_')))
    .sort();
  const newest = files.at(-1);
  return newest ? fs.readFileSync(path.join(dir, newest), 'utf8') : undefined;
}

function linkIn(message: string): string {
  const url = message.match(/http:\/\/\S+\/reset\?token=\S+/)?.[0];
  assert.ok(url, `no reset link in the message:\n${message}`);
  return url;
}

// ---- asking ---------------------------------------------------------------

When('{string} asks for a way back in', async function (this: ShkillsWorld, email: string) {
  this.lastForgot = await this.anonymous().post('/v1/auth/forgot', { email });
});

/**
 * The whole reason the answer is a constant. If it varied, this page would let
 * a stranger ask, one address at a time, who works here.
 */
Then(
  'an address nobody uses is answered exactly the same way',
  async function (this: ShkillsWorld) {
    assert.ok(this.lastForgot, 'nobody has asked for a way back in yet');
    const stranger = await this.anonymous().post('/v1/auth/forgot', {
      email: 'nobody-at-all@acme.test',
    });
    assert.deepEqual(
      stranger,
      this.lastForgot,
      'the portal answers an unknown address differently from a known one',
    );
  },
);

// ---- following the link ---------------------------------------------------

When(
  'I follow the link that was emailed to {string}',
  async function (this: ShkillsWorld, email: string) {
    const message = mailFor(this, email);
    assert.ok(message, `nothing was emailed to ${email}`);
    this.resetLink = linkIn(message);
    await this.page.goto(this.resetLink, { waitUntil: 'domcontentloaded' });
  },
);

When('I follow that link again', async function (this: ShkillsWorld) {
  assert.ok(this.resetLink, 'no link has been followed in this scenario yet');
  await this.page.goto(this.resetLink, { waitUntil: 'domcontentloaded' });
});

When(
  'an administrator makes a newer link for {string}',
  async function (this: ShkillsWorld, email: string) {
    const admin = await this.as(this.adminEmail());
    const { users } = await admin.get<{ users: { id: number; email: string }[] }>('/v1/admin/users');
    const target = users.find((user) => user.email === email.toLowerCase());
    assert.ok(target, `there is nobody called ${email}`);
    await admin.post(`/v1/admin/users/${target.id}/reset-link`, {});
  },
);

/** The administrator hands the link over; this is the person receiving it. */
When('I follow the link the administrator made', async function (this: ShkillsWorld) {
  const shown = (
    await this.page.locator('[data-testid="password-link-url"]').first().textContent()
  )?.trim();
  assert.ok(shown, 'the portal did not show the administrator a link');
  this.resetLink = shown;
  await this.context.clearCookies();
  this.signedInAs = undefined;
  await this.page.goto(this.resetLink, { waitUntil: 'domcontentloaded' });
});

Then('the email to {string} names the address I used', async function (this: ShkillsWorld, email: string) {
  const message = mailFor(this, email);
  assert.ok(message, `nothing was emailed to ${email}`);
  const expected = this.portalAddress ?? this.server.url;
  assert.ok(
    linkIn(message).startsWith(expected),
    `the link says ${linkIn(message)}, which is not on ${expected} — the address they reached us on`,
  );
});

Then('nothing is emailed to {string}', function (this: ShkillsWorld, email: string) {
  assert.equal(mailFor(this, email), undefined, `${email} was emailed after all`);
});

// ---- what the reset did ---------------------------------------------------

Given(
  '{string} is signed in somewhere else',
  async function (this: ShkillsWorld, email: string) {
    // `as` signs in and keeps the cookie, which is exactly what "another
    // browser, still signed in" means to the server.
    const api = await this.as(email);
    await api.get('/v1/auth/me');
  },
);

Then('{string} is signed out there', async function (this: ShkillsWorld, email: string) {
  const api = await this.as(email);
  const attempt = await api.attempt('GET', '/v1/auth/me');
  assert.equal(attempt.status, 401, 'the other session is still signed in after the reset');
});

Then(
  '{string} can sign in with {string}',
  async function (this: ShkillsWorld, email: string, password: string) {
    const attempt = await this.anonymous().attempt('POST', '/v1/auth/login', { email, password });
    assert.equal(attempt.status, 200, `signing in with "${password}" failed: ${attempt.error}`);
  },
);

Then(
  '{string} cannot sign in with {string}',
  async function (this: ShkillsWorld, email: string, password: string) {
    const attempt = await this.anonymous().attempt('POST', '/v1/auth/login', { email, password });
    assert.equal(attempt.status, 401, `"${password}" still works, and this scenario says it should not`);
  },
);

// ---- the console --------------------------------------------------------

/**
 * The last door, for the administrator of a deployment whose only account is
 * theirs: no mail server, and nobody else to ask. Run against the same database
 * the server is using, exactly as `kubectl exec` would.
 */
When(
  'an operator runs the console command for {string}',
  function (this: ShkillsWorld, email: string) {
    const result = spawnSync(process.execPath, [consoleResetEntry, email], {
      encoding: 'utf8',
      env: {
        ...process.env,
        SHKILLS_DATA_DIR: this.server.dataDir,
        SHKILLS_DB: path.join(this.server.dataDir, 'shkills.sqlite'),
        SHKILLS_PUBLIC_URL: this.server.url,
      },
    });
    this.consoleOutput = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 0, `the console command failed:\n${this.consoleOutput}`);
  },
);

When('I follow the link it printed', async function (this: ShkillsWorld) {
  assert.ok(this.consoleOutput, 'no console command has run in this scenario');
  this.resetLink = linkIn(this.consoleOutput);
  await this.page.goto(this.resetLink, { waitUntil: 'domcontentloaded' });
});
