import { describe, expect, it, beforeEach, vi } from 'vitest';
import request from 'supertest';

/**
 * Loads a fresh copy of the config + app with a given environment.
 *
 * `config` is a module-level singleton, so the only honest way to test how it
 * reacts to the environment is to re-import it.
 */
async function withEnv(env: Record<string, string | undefined>) {
  vi.resetModules();
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const { config } = await import('./config.js');
  const restore = () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  return { config, restore };
}

describe('session cookie Secure flag', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('is off when the deployment is reached over plain HTTP', async () => {
    const { config, restore } = await withEnv({
      SHKILLS_PUBLIC_URL: 'http://192.168.83.16:31400',
      NODE_ENV: 'production',
      SHKILLS_SECURE_COOKIES: undefined,
    });
    expect(config.secureCookies).toBe(false);
    restore();
  });

  it('is on when the public URL is https, even outside production', async () => {
    const { config, restore } = await withEnv({
      SHKILLS_PUBLIC_URL: 'https://shkills.example.com',
      NODE_ENV: 'development',
      SHKILLS_SECURE_COOKIES: undefined,
    });
    expect(config.secureCookies).toBe(true);
    restore();
  });

  it('can be forced on for a setup the URL cannot describe', async () => {
    const { config, restore } = await withEnv({
      SHKILLS_PUBLIC_URL: 'http://internal-name',
      SHKILLS_SECURE_COOKIES: 'true',
    });
    expect(config.secureCookies).toBe(true);
    restore();
  });

  it('can be forced off behind a proxy that terminates TLS elsewhere', async () => {
    const { config, restore } = await withEnv({
      SHKILLS_PUBLIC_URL: 'https://shkills.example.com',
      SHKILLS_SECURE_COOKIES: 'false',
    });
    expect(config.secureCookies).toBe(false);
    restore();
  });

  /**
   * The one that matters: a browser silently drops a `Secure` cookie served
   * over http, so this exact header is the difference between a portal you can
   * sign into and one that forgets you the moment you navigate.
   */
  it('login over an http deployment sets a cookie the browser will keep', async () => {
    const { restore } = await withEnv({
      SHKILLS_PUBLIC_URL: 'http://192.168.83.16:31400',
      NODE_ENV: 'production',
      SHKILLS_SECURE_COOKIES: undefined,
    });
    const { createApp } = await import('./app.js');
    const { db } = await import('./db.js');
    const { hashPassword } = await import('./auth.js');
    const app = createApp();

    db.prepare('DELETE FROM users WHERE email = ?').run('cookie-test@example.com');
    db.prepare('INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)').run(
      'cookie-test@example.com',
      'Cookie Test',
      hashPassword('password123'),
      'member',
    );

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'cookie-test@example.com', password: 'password123' })
      .expect(200);

    const setCookie = res.headers['set-cookie'] as unknown as string[];
    const session = setCookie.find((c) => c.startsWith('shkills_session='))!;
    expect(session).toBeDefined();
    expect(session).not.toMatch(/;\s*Secure/i);
    expect(session).toMatch(/HttpOnly/i);
    restore();
  });
});
