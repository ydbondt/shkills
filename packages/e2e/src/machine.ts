import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { cliBundle } from './paths.js';

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
  /** Both streams, in the order a person would have seen them. */
  output: string;
}

interface RunOptions {
  env?: Record<string, string>;
  timeoutMs?: number;
}

/**
 * A throwaway laptop: its own HOME, its own `~/.shkills` and its own
 * `~/.claude`, driven by the real CLI bundle. Nothing here reaches into the
 * CLI's internals — if a machine says a skill arrived, a file arrived.
 */
export class Machine {
  readonly home: string;
  readonly shkillsHome: string;
  readonly claudeDir: string;
  /** Anything still running, so a scenario cannot leave a process behind. */
  private readonly running = new Set<ReturnType<typeof spawn>>();

  constructor(
    readonly name: string,
    root: string,
    private readonly serverUrl: string,
  ) {
    this.home = root;
    this.shkillsHome = path.join(root, '.shkills');
    this.claudeDir = path.join(root, '.claude');
    fs.mkdirSync(this.claudeDir, { recursive: true });
    fs.mkdirSync(this.shkillsHome, { recursive: true });
  }

  private env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
    return {
      ...process.env,
      HOME: this.home,
      SHKILLS_HOME: this.shkillsHome,
      CLAUDE_CONFIG_DIR: this.claudeDir,
      SHKILLS_HOSTNAME: this.name,
      // Never let the developer's own link leak into a test machine.
      SHKILLS_HOST: '',
      SHKILLS_TOKEN: '',
      ...extra,
    };
  }

  /** Runs `shkills …` on this machine. */
  run(args: string[], options: RunOptions = {}): Promise<CommandResult> {
    return this.exec(process.execPath, [cliBundle, ...args], options);
  }

  /** Runs a shell command — used for the literal hook line out of settings.json. */
  shell(command: string, options: RunOptions = {}): Promise<CommandResult> {
    return this.exec('/bin/sh', ['-c', command], options);
  }

  private exec(command: string, args: string[], options: RunOptions): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { env: this.env(options.env), stdio: ['ignore', 'pipe', 'pipe'] });
      this.running.add(child);
      child.once('close', () => this.running.delete(child));
      let stdout = '';
      let stderr = '';
      let output = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
        output += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
        output += chunk.toString();
      });

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`\`${args.join(' ')}\` on ${this.name} never finished:\n${output}`));
      }, options.timeoutMs ?? 30_000);

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code: code ?? -1, stdout, stderr, output });
      });
    });
  }

  /**
   * `shkills login`, all the way through: the CLI prints a code and polls,
   * `approve` does whatever a person would do in the browser, and the command
   * finishes on its own once that happens.
   */
  async login(
    approve: (userCode: string) => Promise<void>,
    host: string = this.serverUrl,
  ): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [cliBundle, 'login', '--host', host], {
        env: this.env(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.running.add(child);
      child.once('close', () => this.running.delete(child));
      let stdout = '';
      let stderr = '';
      let output = '';
      let approving = false;

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`linking ${this.name} never finished:\n${output}`));
      }, 90_000);

      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
        output += text;
        const match = /\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/.exec(stdout);
        if (match && !approving) {
          approving = true;
          approve(match[1]).catch((err: unknown) => {
            child.kill('SIGKILL');
            clearTimeout(timer);
            reject(err instanceof Error ? err : new Error(String(err)));
          });
        }
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
        output += chunk.toString();
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code: code ?? -1, stdout, stderr, output });
      });
    });
  }

  /**
   * A refused login keeps polling for a moment after the scenario has learned
   * what it wanted to know. Nothing may outlive the scenario that started it.
   */
  dispose(): void {
    for (const child of this.running) child.kill('SIGKILL');
    this.running.clear();
  }

  // ---- what is on disk ---------------------------------------------------

  skillDir(slug: string): string {
    return path.join(this.claudeDir, 'skills', slug);
  }

  skillFile(slug: string): string {
    return path.join(this.skillDir(slug), 'SKILL.md');
  }

  hasSkill(slug: string): boolean {
    return fs.existsSync(this.skillFile(slug));
  }

  readSkill(slug: string): string {
    return fs.readFileSync(this.skillFile(slug), 'utf8');
  }

  fingerprint(slug: string): string {
    return createHash('md5').update(this.readSkill(slug)).digest('hex');
  }

  installedSkills(): string[] {
    const dir = path.join(this.claudeDir, 'skills');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).sort();
  }

  marker(slug: string): { version: number; checksum: string } | null {
    const file = path.join(this.skillDir(slug), '.shkills.json');
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8')) as { version: number; checksum: string };
  }

  removeMarker(slug: string): void {
    fs.rmSync(path.join(this.skillDir(slug), '.shkills.json'), { force: true });
  }

  // ---- what this machine believes about its server ------------------------

  /** What `~/.shkills/config.json` says, as the CLI would read it. */
  shkillsConfig(): { host?: string; token?: string; user?: { email: string } } {
    const file = path.join(this.shkillsHome, 'config.json');
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, 'utf8')) as { host?: string; token?: string };
  }

  /**
   * The onboarding command, run exactly as a person pastes it — including the
   * pipe into `sh`, which is the part that has bitten this project before.
   */
  async install(from: string): Promise<CommandResult> {
    return this.shell(`curl -fsSL ${from}/install.sh | sh`, { timeoutMs: 60_000 });
  }

  /**
   * Where a *new login shell* would find `shkills`. Resolving the path rather
   * than just running it matters: the machine running the suite may well have
   * its own Shkills on PATH, and finding that one would prove nothing.
   */
  async shkillsOnPath(): Promise<string> {
    const result = await this.shell(`sh -lc 'command -v shkills'`);
    return result.stdout.trim();
  }

  /** A skill the person wrote themselves — Shkills must never touch it. */
  writeOwnSkill(slug: string, content: string): void {
    fs.mkdirSync(this.skillDir(slug), { recursive: true });
    fs.writeFileSync(this.skillFile(slug), content, 'utf8');
  }

  // ---- Claude settings ---------------------------------------------------

  settingsFile(): string {
    return path.join(this.claudeDir, 'settings.json');
  }

  settings(): Record<string, unknown> {
    if (!fs.existsSync(this.settingsFile())) return {};
    return JSON.parse(fs.readFileSync(this.settingsFile(), 'utf8')) as Record<string, unknown>;
  }

  writeSettings(settings: Record<string, unknown>): void {
    fs.writeFileSync(this.settingsFile(), `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  }

  /** The exact command Claude would run at the start of a session, if any. */
  sessionStartCommand(): string | null {
    const settings = this.settings() as {
      hooks?: { SessionStart?: { hooks?: { command?: string }[] }[] };
    };
    for (const matcher of settings.hooks?.SessionStart ?? []) {
      for (const hook of matcher.hooks ?? []) {
        if (hook.command && /shkills(\.[cm]?js)?["']?\s+sync\b/.test(hook.command)) return hook.command;
      }
    }
    return null;
  }

  /** Starts a Claude session, as far as Shkills is concerned. */
  async startClaudeSession(): Promise<CommandResult> {
    const command = this.sessionStartCommand();
    if (!command) {
      throw new Error(`${this.name} has no Shkills SessionStart hook, so Claude would refresh nothing`);
    }
    return this.shell(command);
  }
}
