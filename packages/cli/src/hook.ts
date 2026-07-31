import fs from 'node:fs';
import path from 'node:path';
import { settingsPath, shkillsHome } from './paths.js';

/**
 * How we recognise our own hook entry across upgrades and path changes. It has
 * to match every shape `hookCommand` can produce — a quoted launcher path, a
 * bare `shkills` on PATH, or `node <bundle>.js` — or `setup` would append a
 * duplicate entry every time it ran.
 */
const SIGNATURE = /shkills(\.js)?["']?\s+sync\b/;

function isOurs(command: string | undefined): boolean {
  return !!command && SIGNATURE.test(command);
}

interface HookCommand {
  type: string;
  command: string;
  timeout?: number;
}

interface HookMatcher {
  matcher?: string;
  hooks: HookCommand[];
}

type Settings = Record<string, unknown> & { hooks?: Record<string, HookMatcher[]> };

function readSettings(): Settings {
  const file = settingsPath();
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Settings;
  } catch (err) {
    throw new Error(
      `${file} is not valid JSON, so it cannot be updated safely — fix it and try again`,
    );
  }
}

function writeSettings(settings: Settings): void {
  const file = settingsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Keep one rollback copy: this file is the user's, not ours.
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.shkills-backup`);
  fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

export function hookCommand(): string {
  // Prefer the launcher the installer wrote — an absolute path keeps working
  // regardless of what PATH looks like when Claude spawns the hook.
  const launcher = path.join(shkillsHome(), 'bin', 'shkills');
  if (fs.existsSync(launcher)) return `"${launcher}" sync --quiet`;

  // A dev checkout or a `node <bundle>` invocation. Match on the file name, not
  // the whole path — a parent directory called "shkills" is not our entrypoint.
  const entry = process.argv[1];
  if (entry && /^shkills(\.[cm]?js)?$/i.test(path.basename(entry))) {
    return `node "${entry}" sync --quiet`;
  }

  // Installed some other way (npm -g): trust PATH.
  return 'shkills sync --quiet';
}

export function hookInstalled(): { installed: boolean; command?: string } {
  const settings = readSettings();
  for (const matcher of settings.hooks?.SessionStart ?? []) {
    for (const hook of matcher.hooks ?? []) {
      if (isOurs(hook.command)) return { installed: true, command: hook.command };
    }
  }
  return { installed: false };
}

/**
 * Registers a SessionStart hook so every new Claude session refreshes its
 * skills first. This is the whole "configure once, stay current forever" story:
 * after this runs, nobody ever types a sync command again.
 */
export function installHook(): { changed: boolean; command: string } {
  const settings = readSettings();
  const command = hookCommand();

  settings.hooks ??= {};
  settings.hooks.SessionStart ??= [];

  for (const matcher of settings.hooks.SessionStart) {
    for (const hook of matcher.hooks ?? []) {
      if (isOurs(hook.command)) {
        if (hook.command === command) return { changed: false, command };
        hook.command = command;
        hook.timeout = 20;
        writeSettings(settings);
        return { changed: true, command };
      }
    }
  }

  settings.hooks.SessionStart.push({
    hooks: [{ type: 'command', command, timeout: 20 }],
  });
  writeSettings(settings);
  return { changed: true, command };
}

export function removeHook(): boolean {
  const settings = readSettings();
  const sessionStart = settings.hooks?.SessionStart;
  if (!sessionStart) return false;

  let removed = false;
  for (const matcher of sessionStart) {
    const before = matcher.hooks?.length ?? 0;
    matcher.hooks = (matcher.hooks ?? []).filter((h) => !isOurs(h.command));
    if (matcher.hooks.length !== before) removed = true;
  }
  if (!removed) return false;

  // Don't leave empty scaffolding behind in someone else's settings file.
  settings.hooks!.SessionStart = sessionStart.filter((m) => (m.hooks?.length ?? 0) > 0);
  if (settings.hooks!.SessionStart.length === 0) delete settings.hooks!.SessionStart;
  if (Object.keys(settings.hooks!).length === 0) delete settings.hooks;

  writeSettings(settings);
  return true;
}
