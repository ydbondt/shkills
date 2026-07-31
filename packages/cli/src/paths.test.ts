import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let home: string;
const saved = process.env.SHKILLS_HOME;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'shkills-paths-'));
  process.env.SHKILLS_HOME = home;
});

afterEach(() => {
  if (saved === undefined) delete process.env.SHKILLS_HOME;
  else process.env.SHKILLS_HOME = saved;
  fs.rmSync(home, { recursive: true, force: true });
});

const configFile = () => path.join(home, 'config.json');
const mode = (file: string) => (fs.statSync(file).mode & 0o777).toString(8);

describe('the file that holds the device token', () => {
  it('is readable only by its owner', async () => {
    const { saveConfig } = await import('./paths.js');
    saveConfig({ host: 'http://shkills.test', token: 'shk_secret' });
    expect(mode(configFile())).toBe('600');
  });

  /**
   * The one that bites in practice. Node applies the `mode` option only when it
   * *creates* a file, so a config.json the installer had already written with
   * the default umask stayed group- and world-readable for ever, and the token
   * written into it later went along for the ride.
   */
  it('is tightened even when the file already existed', async () => {
    const { saveConfig } = await import('./paths.js');
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(configFile(), '{"host":"http://shkills.test"}', { mode: 0o644 });
    expect(mode(configFile())).toBe('644');

    saveConfig({ host: 'http://shkills.test', token: 'shk_secret' });
    expect(mode(configFile())).toBe('600');
  });
});

describe('pointing an installed CLI at a different address', () => {
  it('changes the host and keeps the machine linked', async () => {
    const { saveConfig, loadConfig } = await import('./paths.js');
    const { setHost } = await import('./commands/host.js');
    saveConfig({
      host: 'http://192.168.83.16:31400',
      token: 'shk_secret',
      user: { name: 'Rob', email: 'rob@acme.test' },
    });

    setHost('http://shkills.biyou.internal');

    const config = loadConfig();
    expect(config.host).toBe('http://shkills.biyou.internal');
    expect(config.token).toBe('shk_secret');
    expect(config.user?.email).toBe('rob@acme.test');
  });

  it('works before anyone has ever logged in', async () => {
    const { setHost } = await import('./commands/host.js');
    const { loadConfig } = await import('./paths.js');
    setHost('http://shkills.biyou.internal');
    expect(loadConfig().host).toBe('http://shkills.biyou.internal');
    expect(mode(configFile())).toBe('600');
  });

  it('drops a trailing slash, so URLs do not come out doubled', async () => {
    const { setHost } = await import('./commands/host.js');
    const { loadConfig } = await import('./paths.js');
    setHost('http://shkills.biyou.internal/');
    expect(loadConfig().host).toBe('http://shkills.biyou.internal');
  });

  it('refuses something that is not an http address', async () => {
    const { setHost } = await import('./commands/host.js');
    expect(() => setHost('shkills.biyou.internal')).toThrow(/http/);
  });
});
