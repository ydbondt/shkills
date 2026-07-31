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

export function signSession(userId: number): string {
  const options = { expiresIn: config.sessionTtl } as jwt.SignOptions;
  return jwt.sign({ sub: String(userId) }, config.jwtSecret, options);
}

function loadUser(id: number): AuthUser | undefined {
  const row = db
    .prepare('SELECT id, email, name, role, department FROM users WHERE id = ? AND active = 1')
    .get(id) as AuthUser | undefined;
  return row;
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
      const payload = jwt.verify(raw, config.jwtSecret) as { sub: string };
      req.user = loadUser(Number(payload.sub));
    } catch {
      /* invalid bearer token — stay anonymous */
    }
    return next();
  }

  const cookie = req.cookies?.[SESSION_COOKIE];
  if (cookie) {
    try {
      const payload = jwt.verify(cookie, config.jwtSecret) as { sub: string };
      req.user = loadUser(Number(payload.sub));
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
