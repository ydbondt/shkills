import { Router } from 'express';
import { z } from 'zod';
import { audit, db } from '../db.js';
import { hashPassword, requireAuth, requireRole } from '../auth.js';
import { h, parse, param } from '../http.js';
import { DomainError } from '../services/skills.js';
import { originFor } from '../origin.js';
import {
  RESET_TTL_MINUTES,
  issueResetForUser,
  outstandingRequests,
  resetUrl,
} from '../services/recovery.js';

export const adminRouter: Router = Router();

adminRouter.get(
  '/users',
  requireAuth,
  requireRole('curator'),
  h((_req, res) => {
    const users = db
      .prepare(
        `SELECT u.id, u.email, u.name, u.role, u.department, u.active, u.created_at,
                (SELECT COUNT(*) FROM device_tokens d
                  WHERE d.user_id = u.id AND d.revoked_at IS NULL) AS devices,
                (SELECT MAX(d.last_sync_at) FROM device_tokens d WHERE d.user_id = u.id) AS last_sync
           FROM users u ORDER BY u.name`,
      )
      .all();
    res.json({ users });
  }),
);

adminRouter.post(
  '/users',
  requireAuth,
  requireRole('admin'),
  h((req, res) => {
    const body = parse(
      z.object({
        email: z.string().email().transform((e) => e.toLowerCase()),
        name: z.string().min(1).max(80),
        password: z.string().min(8),
        role: z.enum(['member', 'curator', 'admin']).default('member'),
        department: z.string().min(1).max(40).default('engineering'),
      }),
      req.body,
    );
    const id = Number(
      db
        .prepare(
          'INSERT INTO users (email, name, password_hash, role, department) VALUES (?, ?, ?, ?, ?)',
        )
        .run(body.email, body.name, hashPassword(body.password), body.role, body.department)
        .lastInsertRowid,
    );
    audit(req.user!.id, 'user.create', 'user', id, body.email);
    res.status(201).json({ user: { id, email: body.email, name: body.name, role: body.role } });
  }),
);

adminRouter.patch(
  '/users/:id',
  requireAuth,
  requireRole('admin'),
  h((req, res) => {
    const id = Number(param(req, 'id'));
    const body = parse(
      z.object({
        role: z.enum(['member', 'curator', 'admin']).optional(),
        department: z.string().min(1).max(40).optional(),
        active: z.boolean().optional(),
      }),
      req.body,
    );
    const target = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id) as
      | { id: number; role: string }
      | undefined;
    if (!target) throw new DomainError('no such user', 404);

    // Locking yourself out of the only admin account bricks the deployment.
    if (target.role === 'admin' && (body.role !== undefined || body.active === false)) {
      const admins = (
        db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").get() as {
          n: number;
        }
      ).n;
      const stillAdmin = body.role === 'admin' && body.active !== false;
      if (admins <= 1 && !stillAdmin) throw new DomainError('this is the last admin account', 409);
    }

    db.prepare(
      `UPDATE users SET role = COALESCE(?, role), department = COALESCE(?, department),
              active = COALESCE(?, active) WHERE id = ?`,
    ).run(
      body.role ?? null,
      body.department ?? null,
      body.active === undefined ? null : body.active ? 1 : 0,
      id,
    );
    audit(req.user!.id, 'user.update', 'user', id, JSON.stringify(body));
    res.json({ ok: true });
  }),
);

/**
 * Who is waiting for a way back in.
 *
 * On a deployment with no mail server this queue *is* the delivery mechanism,
 * so it sits on the People page. It names the person, never the link: the link
 * is handed over once, deliberately, by the admin who presses the button below.
 */
adminRouter.get(
  '/password-requests',
  requireAuth,
  requireRole('admin'),
  h((_req, res) => {
    res.json({ requests: outstandingRequests() });
  }),
);

/**
 * Mints a link for somebody and shows it to the administrator exactly once, to
 * be handed over out of band. This is the answer to "the only account is the
 * administrator's and there is no SMTP" for everyone *except* that
 * administrator — who has `npm run reset-password` inside the container.
 */
adminRouter.post(
  '/users/:id/reset-link',
  requireAuth,
  requireRole('admin'),
  h((req, res) => {
    const id = Number(param(req, 'id'));
    const link = issueResetForUser(id, 'administrator', req.user!.id);
    audit(req.user!.id, 'auth.reset_issued', 'user', id, link.email);
    res.json({
      url: resetUrl(originFor(req), link.token),
      email: link.email,
      name: link.name,
      expiresInMinutes: RESET_TTL_MINUTES,
    });
  }),
);

adminRouter.get(
  '/audit',
  requireAuth,
  requireRole('curator'),
  h((req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 100) || 100, 500);
    const rows = db
      .prepare(
        `SELECT a.id, a.action, a.entity, a.entity_id, a.detail, a.created_at, u.name AS actor
           FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
          ORDER BY a.id DESC LIMIT ?`,
      )
      .all(limit);
    res.json({ events: rows });
  }),
);

/** Numbers for the dashboard: adoption is the thing a curator actually cares about. */
adminRouter.get(
  '/stats',
  requireAuth,
  h((_req, res) => {
    const one = <T>(sql: string, ...params: unknown[]): T => db.prepare(sql).get(...params) as T;
    const stats = {
      skills: one<{ n: number }>(
        'SELECT COUNT(*) AS n FROM skills WHERE archived = 0 AND published_version_id IS NOT NULL',
      ).n,
      pending: one<{ n: number }>("SELECT COUNT(*) AS n FROM skill_versions WHERE status = 'pending'").n,
      collections: one<{ n: number }>('SELECT COUNT(*) AS n FROM collections').n,
      people: one<{ n: number }>('SELECT COUNT(*) AS n FROM users WHERE active = 1').n,
      linkedDevices: one<{ n: number }>(
        'SELECT COUNT(*) AS n FROM device_tokens WHERE revoked_at IS NULL',
      ).n,
      syncedLastDay: one<{ n: number }>(
        "SELECT COUNT(DISTINCT user_id) AS n FROM device_tokens WHERE last_sync_at > datetime('now', '-1 day')",
      ).n,
    };
    res.json({ stats });
  }),
);
