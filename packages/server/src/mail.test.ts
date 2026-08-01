import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';

/**
 * Delivering the one message Shkills sends.
 *
 * `config` reads the environment once at import, so each case re-imports it —
 * the same trick `cookies.test.ts` uses, and the only honest way to test a
 * decision that is made at startup.
 */
async function withEnv<T>(
  env: Record<string, string | undefined>,
  body: () => Promise<T>,
): Promise<T> {
  vi.resetModules();
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await body();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    vi.resetModules();
  }
}

const tmpDirs: string[] = [];
function scratch(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shkills-mail-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe('choosing a transport', () => {
  it('sends nothing when nothing is configured, so the request goes to an administrator', async () => {
    await withEnv({ SHKILLS_SMTP_URL: undefined, SHKILLS_MAIL_TRANSPORT: undefined }, async () => {
      const { config } = await import('./config.js');
      const { canDeliver } = await import('./mail.js');
      expect(config.mail.transport).toBe('none');
      expect(canDeliver()).toBe(false);
    });
  });

  it('uses SMTP as soon as a server is named', async () => {
    await withEnv(
      { SHKILLS_SMTP_URL: 'smtp://mail.example:25', SHKILLS_MAIL_TRANSPORT: undefined },
      async () => {
        const { config } = await import('./config.js');
        expect(config.mail.transport).toBe('smtp');
      },
    );
  });

  it('can be pinned off even when a server is named', async () => {
    await withEnv(
      { SHKILLS_SMTP_URL: 'smtp://mail.example:25', SHKILLS_MAIL_TRANSPORT: 'none' },
      async () => {
        const { config } = await import('./config.js');
        expect(config.mail.transport).toBe('none');
      },
    );
  });
});

describe('the file transport', () => {
  it('writes the message where an operator can read it, readable only by them', async () => {
    const dir = scratch();
    await withEnv({ SHKILLS_MAIL_TRANSPORT: 'file', SHKILLS_MAIL_DIR: dir }, async () => {
      const { send, resetMessage } = await import('./mail.js');
      const sent = await send(
        resetMessage('lost@acme.test', 'Lost Person', 'http://shkills.test/reset?token=abc', 60),
      );
      expect(sent).toBe(true);

      const files = fs.readdirSync(dir);
      expect(files).toHaveLength(1);
      const body = fs.readFileSync(path.join(dir, files[0]), 'utf8');
      expect(body).toContain('To: lost@acme.test');
      expect(body).toContain('http://shkills.test/reset?token=abc');
      // The file holds a working way into somebody's account.
      expect(fs.statSync(path.join(dir, files[0])).mode & 0o077).toBe(0);
    });
  });
});

/**
 * A throwaway SMTP server, so the SMTP path is exercised over a real socket
 * rather than against a mock of the library. It answers just enough of RFC 5321
 * to take one message, and advertises no STARTTLS, like a mail relay on a LAN.
 */
function smtpSink(): Promise<{ port: number; received: Promise<string>; close: () => void }> {
  return new Promise((resolve) => {
    let resolveMessage: (value: string) => void;
    const received = new Promise<string>((r) => (resolveMessage = r));

    const server = net.createServer((socket) => {
      let inData = false;
      let message = '';
      socket.write('220 sink.test ESMTP\r\n');
      socket.on('data', (chunk) => {
        const text = chunk.toString();
        if (inData) {
          message += text;
          if (message.includes('\r\n.\r\n')) {
            inData = false;
            resolveMessage(message);
            socket.write('250 2.0.0 Ok: queued\r\n');
          }
          return;
        }
        for (const line of text.split('\r\n').filter(Boolean)) {
          const verb = line.slice(0, 4).toUpperCase();
          if (verb === 'EHLO' || verb === 'HELO') socket.write('250 sink.test\r\n');
          else if (verb === 'DATA') {
            inData = true;
            socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
          } else if (verb === 'QUIT') {
            socket.write('221 Bye\r\n');
            socket.end();
          } else socket.write('250 Ok\r\n');
        }
      });
      socket.on('error', () => undefined);
    });

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ port, received, close: () => server.close() });
    });
  });
}

describe('the SMTP transport', () => {
  it('really puts the link on the wire', async () => {
    const sink = await smtpSink();
    try {
      await withEnv(
        {
          SHKILLS_MAIL_TRANSPORT: 'smtp',
          SHKILLS_SMTP_URL: `smtp://127.0.0.1:${sink.port}`,
          SHKILLS_MAIL_FROM: 'shkills@acme.test',
        },
        async () => {
          const { send, resetMessage } = await import('./mail.js');
          const sent = await send(
            resetMessage('lost@acme.test', 'Lost Person', 'http://shkills.test/reset?token=abc', 60),
          );
          expect(sent).toBe(true);
          const message = await sink.received;
          expect(message).toContain('lost@acme.test');
          expect(message).toContain('http://shkills.test/reset?token=abc');
        },
      );
    } finally {
      sink.close();
    }
  });

  /**
   * A mail server that is down must not turn "I have forgotten my password"
   * into a 500 — and must not change the answer, which has to look the same
   * whether or not the account exists.
   */
  it('a mail server that refuses the connection is reported, not thrown', async () => {
    const dead = await smtpSink();
    dead.close();
    await withEnv(
      { SHKILLS_MAIL_TRANSPORT: 'smtp', SHKILLS_SMTP_URL: `smtp://127.0.0.1:${dead.port}` },
      async () => {
        const { send, resetMessage } = await import('./mail.js');
        await expect(
          send(resetMessage('lost@acme.test', 'Lost Person', 'http://shkills.test/reset', 60)),
        ).resolves.toBe(false);
      },
    );
  });
});

describe('what the person actually receives', () => {
  it('the link in the email is the one that works, and names the address they used', async () => {
    const dir = scratch();
    await withEnv(
      {
        SHKILLS_MAIL_TRANSPORT: 'file',
        SHKILLS_MAIL_DIR: dir,
        SHKILLS_DATA_DIR: scratch(),
        SHKILLS_DB: path.join(scratch(), 'mail-test.sqlite'),
      },
      async () => {
        const { createApp } = await import('./app.js');
        const { db } = await import('./db.js');
        const { hashPassword } = await import('./auth.js');
        const app = createApp();
        db.prepare('INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)').run(
          'lost@acme.test',
          'Lost Person',
          hashPassword('password123'),
          'member',
        );

        const res = await request(app)
          .post('/api/v1/auth/forgot')
          .set('Host', 'shkills.biyou.internal')
          .send({ email: 'lost@acme.test' })
          .expect(202);
        expect(res.body.delivery).toBe('email');

        const file = fs.readdirSync(dir)[0];
        const body = fs.readFileSync(path.join(dir, file), 'utf8');
        const url = body.match(/http:\/\/\S+\/reset\?token=\S+/)?.[0];
        expect(url).toBeDefined();
        // Whichever address they reached the portal on is the one that has to
        // be in the mail — the other ones may not resolve where they are.
        expect(url).toContain('http://shkills.biyou.internal/reset?token=');

        const token = new URL(url!).searchParams.get('token')!;
        await request(app)
          .post('/api/v1/auth/reset')
          .send({ token, password: 'a-brand-new-password' })
          .expect(200);
      },
    );
  });

  /** The link is minted before the send is attempted, so it must not be lost. */
  it('when the mail server is down the request falls back to the administrators', async () => {
    const dead = await smtpSink();
    dead.close();
    const dataDir = scratch();
    await withEnv(
      {
        SHKILLS_MAIL_TRANSPORT: 'smtp',
        SHKILLS_SMTP_URL: `smtp://127.0.0.1:${dead.port}`,
        SHKILLS_DATA_DIR: dataDir,
        SHKILLS_DB: path.join(dataDir, 'fallback-test.sqlite'),
      },
      async () => {
        const { createApp } = await import('./app.js');
        const { db } = await import('./db.js');
        const { hashPassword } = await import('./auth.js');
        const app = createApp();
        db.prepare('INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)').run(
          'boss@acme.test',
          'Boss',
          hashPassword('password123'),
          'admin',
        );
        db.prepare('INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)').run(
          'lost@acme.test',
          'Lost Person',
          hashPassword('password123'),
          'member',
        );

        const res = await request(app)
          .post('/api/v1/auth/forgot')
          .send({ email: 'lost@acme.test' })
          .expect(202);
        expect(res.body.delivery).toBe('administrator');

        const signIn = await request(app)
          .post('/api/v1/auth/login')
          .send({ email: 'boss@acme.test', password: 'password123' });
        const cookie = (signIn.headers['set-cookie'] as unknown as string[])
          .map((c) => c.split(';')[0])
          .join('; ');
        const queue = await request(app)
          .get('/api/v1/admin/password-requests')
          .set('Cookie', cookie)
          .expect(200);
        expect(queue.body.requests).toHaveLength(1);
        expect(queue.body.requests[0].email).toBe('lost@acme.test');
      },
    );
  });
});
