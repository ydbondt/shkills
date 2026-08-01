import { Router } from 'express';
import { z } from 'zod';
import { audit, db } from '../db.js';
import {
  SESSION_COOKIE,
  hashPassword,
  invalidateSessions,
  requireAuth,
  setSessionCookie,
  verifyPassword,
  type AuthUser,
} from '../auth.js';
import { DomainError } from '../services/skills.js';
import { h, parse } from '../http.js';
import { originFor } from '../origin.js';
import { canDeliver, resetMessage, send } from '../mail.js';
import {
  RESET_TTL_MINUTES,
  completeReset,
  inspectReset,
  issueReset,
  linkedDeviceCount,
  markDelivery,
  resetUrl,
  voidOutstanding,
} from '../services/recovery.js';

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
    setSessionCookie(res, row.id);
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
    setSessionCookie(res, id);
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
    // Remembering it after asking for a reset link must retire the link.
    voidOutstanding(req.user!.id);
    // Everywhere else is signed out; this browser gets a new token, or changing
    // your own password would sign you out of the page you did it on.
    invalidateSessions(req.user!.id);
    setSessionCookie(res, req.user!.id);
    audit(req.user!.id, 'auth.password_change', 'user', req.user!.id);
    res.json({ ok: true });
  }),
);

// ---- recovering a lost password ------------------------------------------

/**
 * Asks for a reset link.
 *
 * The answer never depends on whether the account exists. This page is reachable
 * without signing in, so an answer that varied would make it a way to ask
 * whether somebody works here — and would do it one address at a time, quietly.
 *
 * `delivery` says how *this deployment* hands links over, which is a property of
 * the server and not of the account, so the page may say it.
 */
authRouter.post(
  '/forgot',
  h(async (req, res) => {
    const { email } = parse(
      z.object({ email: z.string().email().transform((e) => e.toLowerCase().trim()) }),
      req.body,
    );
    let delivery: 'email' | 'administrator' = canDeliver() ? 'email' : 'administrator';
    const link = issueReset(email, delivery);

    if (link && delivery === 'email') {
      const url = resetUrl(originFor(req), link.token);
      const sent = await send(resetMessage(link.email, link.name, url, RESET_TTL_MINUTES));
      // A mail server that is down must not swallow the request: the link is
      // already minted, so fall back to the queue an administrator can see.
      if (!sent) {
        markDelivery(link.userId, 'administrator');
        delivery = 'administrator';
      }
    }

    res.status(202).json({ ok: true, delivery, expiresInMinutes: RESET_TTL_MINUTES });
  }),
);

/** Whether a link is still good, and whose account it opens. */
authRouter.get(
  '/reset',
  h((req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    res.json(inspectReset(token));
  }),
);

/**
 * Spends the link and signs the person in. Making them type the password they
 * have just chosen a second time, on a page they reached by proving they own
 * the account, would be ceremony.
 */
authRouter.post(
  '/reset',
  h((req, res) => {
    const body = parse(
      z.object({
        token: z.string().min(1),
        password: z.string().min(8, 'password must be at least 8 characters'),
      }),
      req.body,
    );
    const { userId } = completeReset(body.token, body.password);
    setSessionCookie(res, userId);
    const user = db
      .prepare('SELECT id, email, name, role, department FROM users WHERE id = ?')
      .get(userId) as AuthUser;
    // Device tokens survive a reset (docs/security.md). Saying how many are
    // linked is what lets somebody notice one they do not recognise.
    res.json({ user: publicUser(user), linkedDevices: linkedDeviceCount(userId) });
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
