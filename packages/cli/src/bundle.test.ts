import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const bundle = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/shkills.mjs');

/**
 * These run the real built artifact from a directory with no package.json —
 * the situation every installed copy is actually in.
 *
 * This is not hypothetical: the bundle shipped as `shkills.js` once, which Node
 * parses as CommonJS outside a `"type": "module"` package. It worked in the
 * repo and crashed on every real machine.
 */
describe('the installed bundle', () => {
  it('has been built', () => {
    expect(fs.existsSync(bundle)).toBe(true);
  });

  it('runs when copied somewhere with no package.json', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shkills-bundle-'));
    const copied = path.join(dir, 'shkills.mjs');
    fs.copyFileSync(bundle, copied);

    try {
      const output = execFileSync(process.execPath, [copied, 'version'], {
        encoding: 'utf8',
        env: { ...process.env, SHKILLS_HOME: path.join(dir, 'home') },
      });
      expect(output.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prints help without a server or a login', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shkills-bundle-'));
    try {
      const output = execFileSync(process.execPath, [bundle, 'help'], {
        encoding: 'utf8',
        env: { ...process.env, SHKILLS_HOME: path.join(dir, 'home'), NO_COLOR: '1' },
      });
      expect(output).toContain('shkills');
      expect(output).toContain('login');
      expect(output).toContain('sync');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('explains itself instead of crashing when no server is configured', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shkills-bundle-'));
    try {
      execFileSync(process.execPath, [bundle, 'list'], {
        encoding: 'utf8',
        env: { ...process.env, SHKILLS_HOME: path.join(dir, 'home'), NO_COLOR: '1' },
        stdio: 'pipe',
      });
      throw new Error('expected a non-zero exit');
    } catch (err) {
      const failure = err as { status?: number; stderr?: string };
      expect(failure.status).toBe(1);
      expect(failure.stderr).toContain('shkills login');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('never breaks a Claude session start when the server is unreachable', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shkills-bundle-'));
    const home = path.join(dir, 'home');
    fs.mkdirSync(home, { recursive: true });
    // A machine that is linked, but to a server that is not answering.
    fs.writeFileSync(
      path.join(home, 'config.json'),
      JSON.stringify({ host: 'http://127.0.0.1:9', token: 'shk_dead_beef' }),
    );

    try {
      const result = execFileSync(process.execPath, [bundle, 'sync', '--quiet'], {
        encoding: 'utf8',
        env: { ...process.env, SHKILLS_HOME: home, NO_COLOR: '1' },
        stdio: 'pipe',
      });
      // Exit 0 is the whole point: the SessionStart hook must not fail the session.
      expect(result).toBe('');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
