import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { serverEntry } from './paths.js';

export interface TestServer {
  url: string;
  port: number;
  dataDir: string;
  /** Where the `file` mail transport drops messages, when it is switched on. */
  mailDir: string;
  /** Everything the process wrote, kept so a failure can show it. */
  log: () => string;
  stop: () => Promise<void>;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

async function waitForHealth(url: string, child: ChildProcess, log: () => string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`the server exited with ${child.exitCode} before answering:\n${log()}`);
    }
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  throw new Error(`the server never became healthy on ${url}:\n${log()}`);
}

/**
 * Starts a Shkills exactly as a deployment does: the built server, its own
 * empty SQLite database, and a public URL over plain HTTP — which is also what
 * decides whether the session cookie carries `Secure`, so the browser in these
 * tests sees the same cookie a homelab deployment issues.
 */
export async function startServer(
  options: { mail?: boolean; githubApi?: string; githubToken?: string } = {},
): Promise<TestServer> {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shkills-e2e-server-'));
  const mailDir = path.join(dataDir, 'mail');
  const url = `http://127.0.0.1:${port}`;

  const child = spawn(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      PORT: String(port),
      SHKILLS_DATA_DIR: dataDir,
      SHKILLS_DB: path.join(dataDir, 'shkills.sqlite'),
      SHKILLS_PUBLIC_URL: url,
      SHKILLS_JWT_SECRET: 'e2e-secret-not-used-anywhere-real',
      NODE_ENV: 'production',
      // Off by default, because that is the state of a freshly stood-up
      // deployment and the one the administrator queue exists for. The
      // `file` transport writes real messages a scenario can read and follow.
      SHKILLS_MAIL_TRANSPORT: options.mail ? 'file' : 'none',
      SHKILLS_MAIL_DIR: mailDir,
      // A GitHub that is not GitHub, when the scenario asked for one. Absent
      // otherwise, which is a deployment that mirrors nowhere — the default.
      ...(options.githubApi ? { SHKILLS_GITHUB_API: options.githubApi } : {}),
      ...(options.githubToken ? { SHKILLS_GITHUB_TOKEN: options.githubToken } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  const log = () => output.trim();

  await waitForHealth(url, child, log);

  return {
    url,
    port,
    dataDir,
    mailDir,
    log,
    stop: async () => {
      if (child.exitCode === null) {
        const exited = new Promise((resolve) => child.once('exit', resolve));
        child.kill('SIGTERM');
        await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3_000))]);
        if (child.exitCode === null) child.kill('SIGKILL');
      }
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
