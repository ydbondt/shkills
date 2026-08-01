import type { NextFunction, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createHash, randomBytes } from 'node:crypto';
import { config } from './config.js';
import { db } from './db.js';

export type Role = 'member' | 'curator' | 'admin';

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: Role;
  department: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      /** Set when the caller authenticated with a CLI device token. */
      deviceTokenId?: number;
    }
  }
}

export const SESSION_COOKIE = 'shkills_session';

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, 10);
}

export function verifyPassword(plain: string, hash: string): boolean {
  return bcrypt.compareSync(plain, hash);
}

function sessionEpoch(userId: number): number {
  const row = db.prepare('SELECT session_epoch FROM users WHERE id = ?').get(userId) as
    | { session_epoch: number }
    | undefined;
  return row?.session_epoch ?? 0;
}

export function signSession(userId: number): string {
  const options = { expiresIn: config.sessionTtl } as jwt.SignOptions;
  return jwt.sign({ sub: String(userId), se: sessionEpoch(userId) }, config.jwtSecret, options);
}

/** The one place that decides what a browser session cookie looks like. */
export function setSessionCookie(res: Response, userId: number): void {
  res.cookie(SESSION_COOKIE, signSession(userId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
    maxAge: 12 * 60 * 60 * 1000,
  });
}

function loadUser(id: number): AuthUser | undefined {
  const row = db
    .prepare('SELECT id, email, name, role, department FROM users WHERE id = ? AND active = 1')
    .get(id) as AuthUser | undefined;
  return row;
}

/**
 * Ends every session this person has anywhere, by moving the account on to the
 * next epoch. Whoever asked for it needs a freshly signed token afterwards, or
 * they have just signed themselves out too.
 */
export function invalidateSessions(userId: number): void {
  db.prepare('UPDATE users SET session_epoch = session_epoch + 1 WHERE id = ?').run(userId);
}

/**
 * A session token is only good for the epoch it was signed in. Without this a
 * password reset would leave whoever knew the old password signed in for up to
 * twelve hours, which would make recovery cosmetic.
 */
function userFromSession(raw: string): AuthUser | undefined {
  const payload = jwt.verify(raw, config.jwtSecret) as { sub: string; se?: number };
  const id = Number(payload.sub);
  if ((payload.se ?? 0) !== sessionEpoch(id)) return undefined;
  return loadUser(id);
}

/** Device tokens look like `shk_<prefix>_<secret>` and are stored only as a hash. */
export function newDeviceToken(): { token: string; prefix: string; hash: string } {
  const prefix = randomBytes(4).toString('hex');
  const secret = randomBytes(24).toString('base64url');
  const token = `shk_${prefix}_${secret}`;
  return { token, prefix, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function userFromDeviceToken(token: string): { user: AuthUser; tokenId: number } | undefined {
  const row = db
    .prepare('SELECT id, user_id FROM device_tokens WHERE token_hash = ? AND revoked_at IS NULL')
    .get(hashToken(token)) as { id: number; user_id: number } | undefined;
  if (!row) return undefined;
  const user = loadUser(row.user_id);
  if (!user) return undefined;
  db.prepare("UPDATE device_tokens SET last_used_at = datetime('now') WHERE id = ?").run(row.id);
  return { user, tokenId: row.id };
}

/**
 * Populates `req.user` from either a browser session cookie or a CLI device
 * token. Never rejects on its own — `requireAuth` does that — so that public
 * endpoints can still tailor their response to a signed-in caller.
 */
export function attachUser(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header('authorization');
  if (header?.startsWith('Bearer ')) {
    const raw = header.slice(7).trim();
    if (raw.startsWith('shk_')) {
      const found = userFromDeviceToken(raw);
      if (found) {
        req.user = found.user;
        req.deviceTokenId = found.tokenId;
      }
      return next();
    }
    try {
      req.user = userFromSession(raw);
    } catch {
      /* invalid bearer token — stay anonymous */
    }
    return next();
  }

  const cookie = req.cookies?.[SESSION_COOKIE];
  if (cookie) {
    try {
      req.user = userFromSession(cookie);
    } catch {
      /* expired or tampered cookie — stay anonymous */
    }
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'authentication required' });
    return;
  }
  next();
}

const RANK: Record<Role, number> = { member: 0, curator: 1, admin: 2 };

export function requireRole(minimum: Role) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    if (RANK[req.user.role] < RANK[minimum]) {
      res.status(403).json({ error: `requires ${minimum} role` });
      return;
    }
    next();
  };
}

export function canCurate(user: AuthUser): boolean {
  return user.role === 'curator' || user.role === 'admin';
}
