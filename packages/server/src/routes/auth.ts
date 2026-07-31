import { Router } from 'express';
import { z } from 'zod';
import { audit, db } from '../db.js';
import { config } from '../config.js';
import {
  SESSION_COOKIE,
  hashPassword,
  requireAuth,
  signSession,
  verifyPassword,
  type AuthUser,
} from '../auth.js';
import { DomainError } from '../services/skills.js';
import { h, parse } from '../http.js';

export const authRouter: Router = Router();

const credentials = z.object({
  email: z.string().email().transform((e) => e.toLowerCase().trim()),
  password: z.string().min(8, 'password must be at least 8 characters'),
});

authRouter.post(
  '/login',
  h((req, res) => {
    const { email, password } = parse(credentials, req.body);
    const row = db
      .prepare('SELECT * FROM users WHERE email = ? AND active = 1')
      .get(email) as (AuthUser & { password_hash: string }) | undefined;
    // Same message either way: never reveal which half of the pair was wrong.
    if (!row || !verifyPassword(password, row.password_hash)) {
      throw new DomainError('incorrect email or password', 401);
    }
    res.cookie(SESSION_COOKIE, signSession(row.id), {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.secureCookies,
      maxAge: 12 * 60 * 60 * 1000,
    });
    audit(row.id, 'auth.login', 'user', row.id);
    res.json({ user: publicUser(row) });
  }),
);

/**
 * Self-service signup for the company portal. The first account ever created
 * becomes the admin, so a fresh deployment is usable without a console.
 */
authRouter.post(
  '/register',
  h((req, res) => {
    const body = parse(
      credentials.extend({
        name: z.string().min(1).max(80),
        department: z.string().min(1).max(40).default('engineering'),
      }),
      req.body,
    );
    const count = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
    const role = count === 0 ? 'admin' : 'member';
    let id: number;
    try {
      id = Number(
        db
          .prepare(
            'INSERT INTO users (email, name, password_hash, role, department) VALUES (?, ?, ?, ?, ?)',
          )
          .run(body.email, body.name, hashPassword(body.password), role, body.department)
          .lastInsertRowid,
      );
    } catch {
      throw new DomainError('an account with that email already exists', 409);
    }
    res.cookie(SESSION_COOKIE, signSession(id), {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.secureCookies,
      maxAge: 12 * 60 * 60 * 1000,
    });
    audit(id, 'auth.register', 'user', id, role);
    res.status(201).json({ user: { id, email: body.email, name: body.name, role, department: body.department } });
  }),
);

authRouter.post(
  '/logout',
  h((_req, res) => {
    res.clearCookie(SESSION_COOKIE);
    res.json({ ok: true });
  }),
);

authRouter.get(
  '/me',
  h((req, res) => {
    if (!req.user) {
      res.status(401).json({ error: 'not signed in' });
      return;
    }
    res.json({ user: req.user });
  }),
);

authRouter.post(
  '/password',
  requireAuth,
  h((req, res) => {
    const body = parse(
      z.object({ current: z.string(), next: z.string().min(8) }),
      req.body,
    );
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user!.id) as {
      password_hash: string;
    };
    if (!verifyPassword(body.current, row.password_hash)) {
      throw new DomainError('current password is incorrect', 403);
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
      hashPassword(body.next),
      req.user!.id,
    );
    audit(req.user!.id, 'auth.password_change', 'user', req.user!.id);
    res.json({ ok: true });
  }),
);

function publicUser(row: AuthUser): AuthUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    department: row.department,
  };
}
