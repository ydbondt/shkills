import { Router } from 'express';
import { z } from 'zod';
import { randomBytes, randomInt } from 'node:crypto';
import { audit, db } from '../db.js';
import { config } from '../config.js';
import { newDeviceToken, requireAuth } from '../auth.js';
import { h, parse, param } from '../http.js';
import { DomainError } from '../services/skills.js';

export const deviceRouter: Router = Router();

const DEVICE_CODE_TTL_MINUTES = 15;
/** No vowels and no look-alike glyphs: a code you can read out loud without spelling it. */
const CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ23456789';

function userCode(): string {
  const pick = () =>
    Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
  return `${pick()}-${pick()}`;
}

interface DeviceAuthRow {
  device_code: string;
  user_code: string;
  hostname: string;
  user_id: number | null;
  token: string | null;
  status: string;
  created_at: string;
  expires_at: string;
}

function findByUserCode(code: string): DeviceAuthRow | undefined {
  return db
    .prepare("SELECT * FROM device_auth WHERE user_code = ? AND expires_at > datetime('now')")
    .get(code.toUpperCase().trim()) as DeviceAuthRow | undefined;
}

/** Step 1 — the CLI asks for a code. No authentication yet, by definition. */
deviceRouter.post(
  '/code',
  h((req, res) => {
    const body = parse(
      z.object({ hostname: z.string().max(120).default('') }),
      req.body ?? {},
    );
    db.prepare("DELETE FROM device_auth WHERE expires_at <= datetime('now')").run();

    const deviceCode = randomBytes(32).toString('base64url');
    const code = userCode();
    db.prepare(
      `INSERT INTO device_auth (device_code, user_code, hostname, expires_at)
       VALUES (?, ?, ?, datetime('now', '+${DEVICE_CODE_TTL_MINUTES} minutes'))`,
    ).run(deviceCode, code, body.hostname);

    res.status(201).json({
      deviceCode,
      userCode: code,
      verificationUri: `${config.publicUrl}/link`,
      verificationUriComplete: `${config.publicUrl}/link?code=${encodeURIComponent(code)}`,
      expiresIn: DEVICE_CODE_TTL_MINUTES * 60,
      interval: 2,
    });
  }),
);

/** Step 2 — the CLI polls until a human approves in the browser. */
deviceRouter.post(
  '/token',
  h((req, res) => {
    const body = parse(z.object({ deviceCode: z.string().min(10) }), req.body ?? {});
    const row = db.prepare('SELECT * FROM device_auth WHERE device_code = ?').get(body.deviceCode) as
      | DeviceAuthRow
      | undefined;
    if (!row) throw new DomainError('unknown device code', 404);
    // SQLite stores `YYYY-MM-DD HH:MM:SS` in UTC; make it unambiguous ISO first.
    if (new Date(`${row.expires_at.replace(' ', 'T')}Z`) <= new Date()) {
      throw new DomainError('this login request expired, run `shkills login` again', 410);
    }
    if (row.status === 'denied') throw new DomainError('login request was declined', 403);
    if (row.status === 'claimed') throw new DomainError('this code was already used', 409);
    if (row.status !== 'approved' || !row.token) {
      res.status(202).json({ status: 'pending' });
      return;
    }

    const user = db
      .prepare('SELECT id, name, email, role, department FROM users WHERE id = ?')
      .get(row.user_id!) as { id: number; name: string; email: string };
    // The plaintext token exists in the row for exactly one pickup.
    db.prepare("UPDATE device_auth SET status = 'claimed', token = NULL WHERE device_code = ?").run(
      row.device_code,
    );
    res.json({ status: 'approved', token: row.token, user });
  }),
);

/** Step 3 — the browser, where the user is already signed in, approves the code. */
deviceRouter.post(
  '/approve',
  requireAuth,
  h((req, res) => {
    const body = parse(z.object({ userCode: z.string().min(4).max(20) }), req.body);
    const row = findByUserCode(body.userCode);
    if (!row) throw new DomainError('that code is not valid or has expired', 404);
    if (row.status !== 'pending') throw new DomainError('that code was already used', 409);

    const { token, prefix, hash } = newDeviceToken();
    db.transaction(() => {
      db.prepare(
        'INSERT INTO device_tokens (user_id, name, token_hash, prefix) VALUES (?, ?, ?, ?)',
      ).run(req.user!.id, row.hostname || 'cli', hash, prefix);
      db.prepare(
        "UPDATE device_auth SET status = 'approved', user_id = ?, token = ? WHERE device_code = ?",
      ).run(req.user!.id, token, row.device_code);
    })();

    audit(req.user!.id, 'device.approve', 'device', null, row.hostname);
    res.json({ ok: true, hostname: row.hostname });
  }),
);

deviceRouter.post(
  '/deny',
  requireAuth,
  h((req, res) => {
    const body = parse(z.object({ userCode: z.string().min(4).max(20) }), req.body);
    const row = findByUserCode(body.userCode);
    if (!row) throw new DomainError('that code is not valid or has expired', 404);
    db.prepare("UPDATE device_auth SET status = 'denied' WHERE device_code = ?").run(row.device_code);
    res.json({ ok: true });
  }),
);

/** Lets the approval screen show what is being linked before the user commits. */
deviceRouter.get(
  '/pending/:userCode',
  requireAuth,
  h((req, res) => {
    const row = findByUserCode(param(req, 'userCode'));
    if (!row) throw new DomainError('that code is not valid or has expired', 404);
    res.json({ hostname: row.hostname, status: row.status, createdAt: row.created_at });
  }),
);

export const tokensRouter: Router = Router();

tokensRouter.get(
  '/',
  requireAuth,
  h((req, res) => {
    const rows = db
      .prepare(
        `SELECT id, name, prefix, created_at, last_used_at, last_sync_at, revoked_at
           FROM device_tokens WHERE user_id = ? ORDER BY created_at DESC`,
      )
      .all(req.user!.id);
    res.json({ tokens: rows });
  }),
);

tokensRouter.delete(
  '/:id',
  requireAuth,
  h((req, res) => {
    const result = db
      .prepare(
        "UPDATE device_tokens SET revoked_at = datetime('now') WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
      )
      .run(Number(param(req, 'id')), req.user!.id);
    if (result.changes === 0) throw new DomainError('no such active token', 404);
    audit(req.user!.id, 'device.revoke', 'device', Number(param(req, 'id')));
    res.json({ ok: true });
  }),
);
