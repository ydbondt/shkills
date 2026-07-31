import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface CliConfig {
  host: string;
  token?: string;
  user?: { name: string; email: string };
}

export interface ManagedSkill {
  version: number;
  checksum: string;
}

export interface CliState {
  manifest?: string;
  syncedAt?: string;
  /** Only skills in here are ever modified or deleted by a sync. */
  skills: Record<string, ManagedSkill>;
}

export function shkillsHome(): string {
  return process.env.SHKILLS_HOME || path.join(os.homedir(), '.shkills');
}

/**
 * Claude Code reads personal skills from `<config dir>/skills/<name>/SKILL.md`,
 * and honours CLAUDE_CONFIG_DIR when it is set.
 */
export function claudeDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

export function skillsDir(): string {
  return path.join(claudeDir(), 'skills');
}

export function settingsPath(): string {
  return path.join(claudeDir(), 'settings.json');
}

const configFile = () => path.join(shkillsHome(), 'config.json');
const stateFile = () => path.join(shkillsHome(), 'state.json');

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, value: unknown, mode?: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, mode ? { mode } : undefined);
}

export function loadConfig(): CliConfig {
  const config = readJson<CliConfig>(configFile(), { host: '' });
  if (process.env.SHKILLS_HOST) config.host = process.env.SHKILLS_HOST;
  if (process.env.SHKILLS_TOKEN) config.token = process.env.SHKILLS_TOKEN;
  return config;
}

export function saveConfig(config: CliConfig): void {
  // The file holds a bearer token: keep it to the owner.
  writeJson(configFile(), config, 0o600);
}

export function loadState(): CliState {
  return readJson<CliState>(stateFile(), { skills: {} });
}

export function saveState(state: CliState): void {
  writeJson(stateFile(), state);
}

/** Marker file that says "Shkills owns this directory". */
export const MARKER = '.shkills.json';
