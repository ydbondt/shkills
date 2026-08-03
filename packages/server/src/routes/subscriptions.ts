import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { h, parse } from '../http.js';
import { DomainError } from '../services/skills.js';
import { effectiveSkills } from '../services/sync.js';

export const subscriptionsRouter: Router = Router();

const target = z.object({
  kind: z.enum(['skill', 'collection']),
  slug: z.string().min(1).max(120),
});

function resolve(kind: 'skill' | 'collection', slug: string): { id: number; isDefault: boolean } {
  if (kind === 'skill') {
    // A personal skill is nobody else's to subscribe to, and answering 404
    // rather than 403 keeps its existence private.
    const row = db.prepare("SELECT id FROM skills WHERE slug = ? AND visibility = 'shared'").get(slug) as
      | { id: number }
      | undefined;
    if (!row) throw new DomainError('no such skill', 404);
    return { id: row.id, isDefault: false };
  }
  const row = db.prepare('SELECT id, is_default FROM collections WHERE slug = ?').get(slug) as
    | { id: number; is_default: number }
    | undefined;
  if (!row) throw new DomainError('no such collection', 404);
  return { id: row.id, isDefault: row.is_default === 1 };
}

/** What this user currently gets, and where each skill comes from. */
subscriptionsRouter.get(
  '/',
  requireAuth,
  h((req, res) => {
    const skills = effectiveSkills(req.user!.id);
    const collections = db
      .prepare(
        `SELECT c.slug, c.name, c.is_default FROM collections c
          WHERE c.is_default = 1
             OR c.id IN (SELECT target_id FROM subscriptions WHERE user_id = ? AND kind = 'collection')
          ORDER BY c.is_default DESC, c.name`,
      )
      .all(req.user!.id) as { slug: string; name: string; is_default: number }[];

    res.json({
      collections: collections.map((c) => ({
        slug: c.slug,
        name: c.name,
        isDefault: c.is_default === 1,
      })),
      skills: skills.map((s) => ({
        slug: s.slug,
        title: s.title,
        category: s.category,
        version: s.version,
        sources: s.sources,
      })),
    });
  }),
);

subscriptionsRouter.post(
  '/',
  requireAuth,
  h((req, res) => {
    const body = parse(target, req.body);
    const { id, isDefault } = resolve(body.kind, body.slug);
    if (isDefault) {
      res.json({ ok: true, note: 'company defaults are already active for everyone' });
      return;
    }
    db.prepare(
      'INSERT OR IGNORE INTO subscriptions (user_id, kind, target_id) VALUES (?, ?, ?)',
    ).run(req.user!.id, body.kind, id);
    res.status(201).json({ ok: true });
  }),
);

subscriptionsRouter.delete(
  '/:kind/:slug',
  requireAuth,
  h((req, res) => {
    const body = parse(target, { kind: req.params.kind, slug: req.params.slug });
    const { id, isDefault } = resolve(body.kind, body.slug);
    if (isDefault) {
      throw new DomainError('company default collections cannot be unsubscribed', 409);
    }
    db.prepare('DELETE FROM subscriptions WHERE user_id = ? AND kind = ? AND target_id = ?').run(
      req.user!.id,
      body.kind,
      id,
    );
    res.json({ ok: true });
  }),
);
