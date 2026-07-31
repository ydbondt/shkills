import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shkills-hook-'));
  process.env.CLAUDE_CONFIG_DIR = dir;
  process.env.SHKILLS_HOME = path.join(dir, 'shkills-home');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.CLAUDE_CONFIG_DIR;
  delete process.env.SHKILLS_HOME;
});

function settings(): Record<string, any> {
  return JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
}

function writeSettings(value: unknown): void {
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(value, null, 2));
}

async function hookModule() {
  // Imported per-test so it reads the env set above.
  return import('./hook.js');
}

describe('the auto-update hook', () => {
  it('registers a SessionStart hook when Claude has no settings yet', async () => {
    const { installHook } = await hookModule();
    const { changed } = installHook();

    expect(changed).toBe(true);
    expect(settings().hooks.SessionStart[0].hooks[0].command).toContain('sync --quiet');
  });

  it('leaves every other setting untouched', async () => {
    writeSettings({
      model: 'opus',
      permissions: { allow: ['Read', 'Write'] },
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'audit.sh' }] }] },
    });

    const { installHook } = await hookModule();
    installHook();

    const after = settings();
    expect(after.model).toBe('opus');
    expect(after.permissions.allow).toEqual(['Read', 'Write']);
    expect(after.hooks.PreToolUse[0].hooks[0].command).toBe('audit.sh');
    expect(after.hooks.SessionStart).toHaveLength(1);
  });

  it('is safe to run twice', async () => {
    const { installHook } = await hookModule();
    installHook();
    const second = installHook();

    expect(second.changed).toBe(false);
    expect(settings().hooks.SessionStart).toHaveLength(1);
  });

  it('updates its own entry in place when the launcher moves', async () => {
    writeSettings({
      hooks: {
        SessionStart: [
          { hooks: [{ type: 'command', command: '/old/path/shkills sync --quiet' }] },
        ],
      },
    });

    const { installHook } = await hookModule();
    const { changed, command } = installHook();

    expect(changed).toBe(true);
    expect(settings().hooks.SessionStart).toHaveLength(1);
    expect(settings().hooks.SessionStart[0].hooks[0].command).toBe(command);
  });

  it('coexists with somebody else’s SessionStart hook', async () => {
    writeSettings({
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'greet.sh' }] }] },
    });

    const { installHook, removeHook } = await hookModule();
    installHook();
    expect(settings().hooks.SessionStart).toHaveLength(2);

    removeHook();
    const after = settings();
    expect(after.hooks.SessionStart).toHaveLength(1);
    expect(after.hooks.SessionStart[0].hooks[0].command).toBe('greet.sh');
  });

  it('cleans up after itself completely on removal', async () => {
    const { installHook, removeHook, hookInstalled } = await hookModule();
    installHook();
    expect(hookInstalled().installed).toBe(true);

    expect(removeHook()).toBe(true);
    expect(hookInstalled().installed).toBe(false);
    expect(settings().hooks).toBeUndefined();
  });

  it('reports nothing to remove when it was never installed', async () => {
    writeSettings({ model: 'opus' });
    const { removeHook } = await hookModule();
    expect(removeHook()).toBe(false);
  });

  it('backs the settings file up before changing it', async () => {
    writeSettings({ model: 'opus' });
    const { installHook } = await hookModule();
    installHook();

    const backup = JSON.parse(
      fs.readFileSync(path.join(dir, 'settings.json.shkills-backup'), 'utf8'),
    );
    expect(backup).toEqual({ model: 'opus' });
  });

  it('refuses to write over a settings file it cannot parse', async () => {
    fs.writeFileSync(path.join(dir, 'settings.json'), '{ this is not json');
    const { installHook } = await hookModule();

    expect(() => installHook()).toThrow(/not valid JSON/);
    expect(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')).toBe('{ this is not json');
  });
});
