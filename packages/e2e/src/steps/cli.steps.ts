import { Given, Then, When } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import type { CommandResult } from '../machine.js';
import { ShkillsWorld } from '../world.js';
import { signIn } from './sign-in.js';

/**
 * The terminal half of the suite. These steps run the built CLI bundle in a
 * throwaway HOME — the same file the installer downloads — so "the skill
 * arrived" means a file arrived, not that a mock was called.
 */

function remember(world: ShkillsWorld, result: CommandResult): CommandResult {
  world.lastCommand = result;
  return result;
}

function lastCommand(world: ShkillsWorld): CommandResult {
  if (!world.lastCommand) throw new Error('no command has run in this scenario yet');
  return world.lastCommand;
}

async function deadPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

// ---- machines -------------------------------------------------------------

Given('a machine called {string}', function (this: ShkillsWorld, name: string) {
  this.addMachine(name);
});

Given(
  'the machine {string} has a skill of its own called {string} saying:',
  function (this: ShkillsWorld, name: string, slug: string, content: string) {
    this.machine(name).writeOwnSkill(slug, content);
  },
);

Given(
  'the machine {string} is no longer letting Shkills manage {string}',
  function (this: ShkillsWorld, name: string, slug: string) {
    this.machine(name).removeMarker(slug);
  },
);

Given(
  'the machine {string} already has Claude settings:',
  function (this: ShkillsWorld, name: string, json: string) {
    this.machine(name).writeSettings(JSON.parse(json) as Record<string, unknown>);
  },
);

Given(
  'somebody has edited the skill {string} on the machine {string} to say:',
  function (this: ShkillsWorld, slug: string, name: string, content: string) {
    this.machine(name).writeOwnSkill(slug, content);
  },
);

// ---- linking --------------------------------------------------------------

When(
  '{string} links the machine {string}',
  { timeout: 120_000 },
  async function (this: ShkillsWorld, email: string, name: string) {
    const machine = this.machine(name);
    if (this.signedInAs !== this.person(email).email) await signIn(this, email);

    const result = await machine.login(async (userCode) => {
      await this.visit(`/link?code=${encodeURIComponent(userCode)}`);
      await this.page.locator('[data-testid="link-approve"]').first().click();
      await this.page.locator('[data-testid="link-approved"]').first().waitFor({ state: 'visible' });
    });

    remember(this, result);
    assert.equal(result.code, 0, `linking ${name} failed:\n${result.output}`);
  },
);

/**
 * The same dance, but reaching the server by a different one of its names —
 * which is how the suite can tell whether the device-link prompt follows the
 * caller or a value baked in at deploy time.
 */
When(
  '{string} links the machine {string} from {string}',
  { timeout: 120_000 },
  async function (this: ShkillsWorld, email: string, name: string, address: string) {
    const machine = this.machine(name);
    if (this.signedInAs !== this.person(email).email) await signIn(this, email);

    const host = addressBy(this, address);
    this.lastLoginAddress = host;
    const result = await machine.login(async (userCode) => {
      await this.visit(`/link?code=${encodeURIComponent(userCode)}`);
      await this.page.locator('[data-testid="link-approve"]').first().click();
      await this.page.locator('[data-testid="link-approved"]').first().waitFor({ state: 'visible' });
    }, host);

    remember(this, result);
    assert.equal(result.code, 0, `linking ${name} failed:\n${result.output}`);
  },
);

When(
  '{string} refuses to link the machine {string}',
  { timeout: 120_000 },
  async function (this: ShkillsWorld, email: string, name: string) {
    const machine = this.machine(name);
    if (this.signedInAs !== this.person(email).email) await signIn(this, email);

    // The CLI keeps polling after a refusal until the code expires, so let it
    // discover the refusal and then stop waiting on it.
    let refusedCode = '';
    await Promise.race([
      machine
        .login(async (userCode) => {
          refusedCode = userCode;
          await this.visit(`/link?code=${encodeURIComponent(userCode)}`);
          await this.page.locator('[data-testid="link-deny"]').first().click();
          await this.page.locator('[data-testid="link-denied"]').first().waitFor({ state: 'visible' });
        })
        .then((result) => remember(this, result)),
      new Promise((resolve) => setTimeout(resolve, 6_000)),
    ]);
    this.refusedCode = refusedCode;
  },
);

When('that code is used again', async function (this: ShkillsWorld) {
  assert.ok(this.refusedCode, 'no code was refused in this scenario');
  await this.visit(`/link?code=${encodeURIComponent(this.refusedCode)}`);
  await this.page.locator('[data-testid="link-approve"]').first().click();
});

// ---- running things -------------------------------------------------------

When('the machine {string} syncs', async function (this: ShkillsWorld, name: string) {
  remember(this, await this.machine(name).run(['sync']));
});

When('Claude starts on the machine {string}', async function (this: ShkillsWorld, name: string) {
  remember(this, await this.machine(name).startClaudeSession());
});

When(
  'Claude starts on the machine {string} while Shkills is unreachable',
  async function (this: ShkillsWorld, name: string) {
    const machine = this.machine(name);
    const command = machine.sessionStartCommand();
    assert.ok(command, `${name} has no Shkills SessionStart hook`);
    const port = await deadPort();
    remember(this, await machine.shell(command, { env: { SHKILLS_HOST: `http://127.0.0.1:${port}` } }));
  },
);

When('the machine {string} runs {string}', async function (this: ShkillsWorld, name: string, command: string) {
  remember(this, await this.machine(name).run(command.replace(/^shkills\s+/, '').split(/\s+/)));
});

// ---- what is on the machine ----------------------------------------------

Then('the machine {string} has the skill {string}', function (this: ShkillsWorld, name: string, slug: string) {
  const machine = this.machine(name);
  assert.ok(
    machine.hasSkill(slug),
    `${name} has ${machine.installedSkills().join(', ') || 'no skills'}, but not ${slug}`,
  );
});

Then(
  'the machine {string} does not have the skill {string}',
  function (this: ShkillsWorld, name: string, slug: string) {
    const machine = this.machine(name);
    assert.ok(!machine.hasSkill(slug), `${name} still has ${slug}`);
  },
);

Then(
  'the machine {string} has exactly {int} skill(s)',
  function (this: ShkillsWorld, name: string, count: number) {
    const installed = this.machine(name).installedSkills();
    assert.equal(installed.length, count, `${name} has ${installed.join(', ') || 'nothing'}`);
  },
);

Then(
  'the skill {string} on the machine {string} says {string}',
  function (this: ShkillsWorld, slug: string, name: string, expected: string) {
    const content = this.machine(name).readSkill(slug);
    assert.ok(content.includes(expected), `${slug} on ${name} does not mention "${expected}":\n${content}`);
  },
);

Then(
  'the skill {string} on the machine {string} does not say {string}',
  function (this: ShkillsWorld, slug: string, name: string, unexpected: string) {
    const content = this.machine(name).readSkill(slug);
    assert.ok(!content.includes(unexpected), `${slug} on ${name} still mentions "${unexpected}"`);
  },
);

Then(
  'the machine {string} knows {string} as version {int}',
  function (this: ShkillsWorld, name: string, slug: string, version: number) {
    const marker = this.machine(name).marker(slug);
    assert.ok(marker, `Shkills does not manage ${slug} on ${name}`);
    assert.equal(marker.version, version);
  },
);

Then('the machine {string} refreshes skills when Claude starts', function (this: ShkillsWorld, name: string) {
  const command = this.machine(name).sessionStartCommand();
  assert.ok(command, `${name} has no Shkills SessionStart hook in ${this.machine(name).settingsFile()}`);
});

Then('the settings on {string} still contain {string}', function (this: ShkillsWorld, name: string, key: string) {
  const settings = this.machine(name).settings();
  assert.ok(key in settings, `${key} is gone from ${this.machine(name).settingsFile()}`);
});

Then(
  'Claude on {string} still runs {string} at session start',
  function (this: ShkillsWorld, name: string, command: string) {
    const settings = this.machine(name).settings() as {
      hooks?: { SessionStart?: { hooks?: { command?: string }[] }[] };
    };
    const commands = (settings.hooks?.SessionStart ?? []).flatMap((matcher) =>
      (matcher.hooks ?? []).map((hook) => hook.command),
    );
    assert.ok(
      commands.includes(command),
      `${name} now runs ${JSON.stringify(commands)} at session start — "${command}" was dropped`,
    );
  },
);

// ---- noting and comparing -------------------------------------------------

When(
  'I note the skill {string} on the machine {string}',
  function (this: ShkillsWorld, slug: string, name: string) {
    this.noted ??= new Map();
    this.noted.set(`${name}/${slug}`, this.machine(name).fingerprint(slug));
  },
);

Then(
  'the skill {string} on the machine {string} is exactly as it was',
  function (this: ShkillsWorld, slug: string, name: string) {
    const before = this.noted?.get(`${name}/${slug}`);
    assert.ok(before, `this scenario never noted ${slug} on ${name}`);
    assert.equal(
      this.machine(name).fingerprint(slug),
      before,
      `${slug} on ${name} was changed, and this scenario says it must not be`,
    );
  },
);

// ---- installing ----------------------------------------------------------

/**
 * The test server answers on 127.0.0.1; `localhost` is a second name for the
 * very same process. That is the whole point — one deployment, two addresses,
 * and the installer has to name back the one that was actually used.
 */
function addressBy(world: ShkillsWorld, name: string): string {
  return world.server.url.replace('127.0.0.1', name);
}

When(
  'the machine {string} installs Shkills from {string}',
  { timeout: 120_000 },
  async function (this: ShkillsWorld, machine: string, address: string) {
    remember(this, await this.machine(machine).install(addressBy(this, address)));
  },
);

Then(
  'the machine {string} is pointed at {string}',
  function (this: ShkillsWorld, machine: string, address: string) {
    const expected = addressBy(this, address);
    const actual = this.machine(machine).shkillsConfig().host;
    assert.equal(
      actual,
      expected,
      `${machine} would talk to ${actual ?? 'nowhere'}, so that is what it will sync from`,
    );
  },
);

Then('the machine {string} is still linked', function (this: ShkillsWorld, machine: string) {
  const config = this.machine(machine).shkillsConfig();
  assert.ok(config.token, `${machine} lost its token and would have to be linked again`);
});

Then(
  'a new shell on {string} finds the installed shkills',
  { timeout: 60_000 },
  async function (this: ShkillsWorld, machine: string) {
    const found = await this.machine(machine).shkillsOnPath();
    const expected = path.join(this.machine(machine).shkillsHome, 'bin', 'shkills');
    assert.equal(found, expected, `a login shell resolved shkills to “${found || 'nothing'}”`);
  },
);

Then(
  'the link it printed points at the address that machine uses',
  function (this: ShkillsWorld, ) {
    const result = lastCommand(this);
    const host = this.lastLoginAddress;
    assert.ok(host, 'no machine was linked in this scenario');
    assert.ok(
      result.output.includes(`${host}/link`),
      `the terminal told them to open a different address than the one this machine talks to (${host}):\n${result.output}`,
    );
  },
);

// ---- what the terminal said ----------------------------------------------

Then('the command succeeds', function (this: ShkillsWorld) {
  const result = lastCommand(this);
  assert.equal(result.code, 0, `it exited ${result.code}:\n${result.output}`);
});

Then('the command exits {int}', function (this: ShkillsWorld, code: number) {
  const result = lastCommand(this);
  assert.equal(result.code, code, `it exited ${result.code}:\n${result.output}`);
});

Then('the terminal says {string}', function (this: ShkillsWorld, expected: string) {
  const result = lastCommand(this);
  assert.ok(result.output.includes(expected), `the terminal said:\n${result.output}`);
});

Then('the terminal does not say {string}', function (this: ShkillsWorld, unexpected: string) {
  const result = lastCommand(this);
  assert.ok(!result.output.includes(unexpected), `the terminal said:\n${result.output}`);
});
