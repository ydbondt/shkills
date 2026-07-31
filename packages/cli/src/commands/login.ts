import os from 'node:os';
import { api, ApiError } from '../api.js';
import { loadConfig, saveConfig } from '../paths.js';
import { fail, say, style } from '../ui.js';
import { runSetup } from './setup.js';

interface DeviceCodeResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

interface TokenResponse {
  status: string;
  token: string;
  user: { name: string; email: string };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function login(args: { host?: string; token?: string }): Promise<void> {
  const config = loadConfig();
  if (args.host) config.host = args.host.replace(/\/+$/, '');
  if (!config.host) {
    fail('no server configured — run `shkills login --host https://shkills.yourcompany.com`');
  }
  saveConfig(config);

  // Non-interactive path, for CI images and shared build machines.
  if (args.token) {
    config.token = args.token;
    saveConfig(config);
    const me = await api<{ user: { name: string; email: string } }>('/api/v1/auth/me');
    config.user = me.user;
    saveConfig(config);
    say(`${style.green('✓')} Linked as ${style.bold(me.user.name)}.`);
    return;
  }

  const start = await api<DeviceCodeResponse>('/api/v1/device/code', {
    method: 'POST',
    body: { hostname: os.hostname() },
    anonymous: true,
  });

  say();
  say(`  ${style.dim('Open')}  ${style.underline(start.verificationUriComplete)}`);
  say();
  say(`  ${style.dim('Code')}  ${style.bold(start.userCode)}`);
  say();
  say(style.dim('  Waiting for you to approve this machine…'));

  const deadline = Date.now() + start.expiresIn * 1000;
  while (Date.now() < deadline) {
    await sleep(start.interval * 1000);
    try {
      const result = await api<TokenResponse>('/api/v1/device/token', {
        method: 'POST',
        body: { deviceCode: start.deviceCode },
        anonymous: true,
      });
      if (result.token) {
        config.token = result.token;
        config.user = result.user;
        saveConfig(config);
        say();
        say(`${style.green('✓')} Linked as ${style.bold(result.user.name)}.`);
        // Finishing the job here is the point: one command, fully set up.
        await runSetup({ silent: false });
        return;
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 202) continue;
      if (err instanceof ApiError && err.status >= 400) fail(err.message);
      throw err;
    }
  }

  fail('this login request expired — run `shkills login` again');
}

export function logout(): void {
  const config = loadConfig();
  delete config.token;
  delete config.user;
  saveConfig(config);
  say(`${style.green('✓')} This machine is no longer linked.`);
  say(style.dim('  Skills already on disk are left in place. `shkills clean` removes them.'));
}
