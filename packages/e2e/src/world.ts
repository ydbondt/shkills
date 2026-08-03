import { World, setWorldConstructor, type IWorldOptions } from '@cucumber/cucumber';
import type { Browser, BrowserContext, Page } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Api } from './api.js';
import { Machine, type CommandResult } from './machine.js';
import { startServer, type TestServer } from './server.js';
import { FAKE_TOKEN, startFakeGitHub, type FakeRepo } from './github.js';

export interface Person {
  email: string;
  name: string;
  password: string;
  role: 'member' | 'curator' | 'admin';
  department: string;
}

/**
 * One scenario owns one Shkills: its own server process, its own empty
 * database, its own browser context, and its own throwaway machines. Nothing
 * leaks between scenarios, so they can be read — and debugged — on their own.
 */
export class ShkillsWorld extends World {
  server!: TestServer;
  context!: BrowserContext;
  page!: Page;

  readonly people = new Map<string, Person>();
  readonly machines = new Map<string, Machine>();
  private readonly apis = new Map<string, Api>();
  private tmpRoot?: string;

  /** Whoever the browser is signed in as. */
  signedInAs?: string;
  /** The result of the last API refusal a scenario deliberately provoked. */
  lastApiAttempt?: { status: number; error: string };
  /** The last thing a machine ran, for the "the terminal says …" steps. */
  lastCommand?: CommandResult;
  /** Fingerprints taken by "I note the skill …", to compare against later. */
  noted?: Map<string, string>;
  /** The device code from a refused link, so a scenario can try to reuse it. */
  refusedCode?: string;
  /** Which of the server's addresses the last link was made through. */
  lastLoginAddress?: string;
  /** Which of its addresses the browser is using, when it is not the default. */
  portalAddress?: string;
  /** The portal's answer to the last "I have forgotten my password". */
  lastForgot?: unknown;
  /** The reset link this scenario is holding, however it came by it. */
  resetLink?: string;
  /** What the console recovery command printed. */
  consoleOutput?: string;
  /** What the last "push the mirror" answered, success or failure. */
  lastMirrorRun?: unknown;
  /** The stand-in GitHub, for a scenario that mirrors somewhere. */
  private github?: FakeRepo;

  constructor(options: IWorldOptions) {
    super(options);
  }

  async open(browser: Browser, options: { mail?: boolean; git?: boolean } = {}): Promise<void> {
    // Started before the server, because the server is told where GitHub is
    // when its process starts — the same reason mail is a tag and not a `Given`.
    if (options.git) this.github = await startFakeGitHub({ owner: 'acme', repo: 'skills' });

    this.server = await startServer({
      mail: options.mail,
      ...(this.github ? { githubApi: this.github.url, githubToken: FAKE_TOKEN } : {}),
    });
    this.context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    this.page = await this.context.newPage();
    this.tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shkills-e2e-home-'));
  }

  async close(): Promise<void> {
    for (const machine of this.machines.values()) machine.dispose();
    await this.context?.close();
    await this.server?.stop();
    await this.github?.stop();
    if (this.tmpRoot) fs.rmSync(this.tmpRoot, { recursive: true, force: true });
  }

  /** The repository this scenario mirrors into, when it asked for one. */
  repository(): FakeRepo {
    if (!this.github) {
      throw new Error('this scenario has no git repository — tag it @with-a-git-repository');
    }
    return this.github;
  }

  // ---- people ------------------------------------------------------------

  person(email: string): Person {
    const person = this.people.get(email.toLowerCase());
    if (!person) {
      throw new Error(
        `this scenario never introduced "${email}" — add them to its "Given these people" table`,
      );
    }
    return person;
  }

  /** An API client already signed in as that person, created on first use. */
  async as(email: string): Promise<Api> {
    const key = email.toLowerCase();
    const existing = this.apis.get(key);
    if (existing) return existing;
    const person = this.person(key);
    const api = new Api(this.server.url);
    await api.post('/v1/auth/login', { email: person.email, password: person.password });
    this.apis.set(key, api);
    return api;
  }

  /** The anonymous client, for registration and for "signed out" assertions. */
  anonymous(): Api {
    return new Api(this.server.url);
  }

  /** The person who runs this company, for setup steps that need an admin. */
  adminEmail(): string {
    for (const person of this.people.values()) {
      if (person.role === 'admin') return person.email;
    }
    throw new Error('this scenario has no administrator — list one in its "Given these people" table');
  }

  /** Somebody who is allowed to publish, for setup steps that need no author. */
  curatorEmail(): string {
    for (const person of this.people.values()) {
      if (person.role === 'curator' || person.role === 'admin') return person.email;
    }
    throw new Error('this scenario has nobody who can curate — add a curator or an admin');
  }

  async createCollection(slug: string, isDefault: boolean, skills: string[]): Promise<void> {
    const api = await this.as(this.curatorEmail());
    await api.post('/v1/collections', {
      slug,
      name: slug
        .split('-')
        .map((word) => word[0].toUpperCase() + word.slice(1))
        .join(' '),
      description: `Everything that belongs to ${slug}.`,
      isDefault,
    });
    for (const skill of skills) await api.put(`/v1/collections/${slug}/skills/${skill}`);
  }

  // ---- machines ----------------------------------------------------------

  machine(name: string): Machine {
    const machine = this.machines.get(name);
    if (!machine) {
      throw new Error(`this scenario has no machine called "${name}" — give it one first`);
    }
    return machine;
  }

  addMachine(name: string): Machine {
    if (!this.tmpRoot) throw new Error('the world was never opened');
    const machine = new Machine(name, path.join(this.tmpRoot, name), this.server.url);
    this.machines.set(name, machine);
    return machine;
  }

  /** The machine a step did not name — scenarios with only one never have to. */
  soleMachine(): Machine {
    if (this.machines.size !== 1) {
      throw new Error(
        `"the machine" is ambiguous: this scenario has ${this.machines.size} of them, so name it`,
      );
    }
    return [...this.machines.values()][0];
  }

  // ---- browser -----------------------------------------------------------

  async visit(pathname: string): Promise<void> {
    await this.page.goto(`${this.portalAddress ?? this.server.url}${pathname}`, {
      waitUntil: 'domcontentloaded',
    });
  }
}

setWorldConstructor(ShkillsWorld);
