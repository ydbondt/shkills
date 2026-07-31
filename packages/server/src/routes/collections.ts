import { Router } from 'express';
import { z } from 'zod';
import { audit, db } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { h, parse, param } from '../http.js';
import { SLUG_RE } from '../skill-format.js';
import { DomainError, getSkillBySlug } from '../services/skills.js';

export const collectionsRouter: Router = Router();

interface CollectionRow {
  id: number;
  slug: string;
  name: string;
  description: string;
  audience: string;
  is_default: number;
  created_at: string;
  skill_count: number;
}

collectionsRouter.get(
  '/',
  requireAuth,
  h((req, res) => {
    const rows = db
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM collection_skills cs
                       JOIN skills s ON s.id = cs.skill_id
                      WHERE cs.collection_id = c.id AND s.archived = 0) AS skill_count
           FROM collections c
          ORDER BY c.is_default DESC, c.name ASC`,
      )
      .all() as CollectionRow[];

    const subs = new Set(
      (
        db
          .prepare("SELECT target_id FROM subscriptions WHERE user_id = ? AND kind = 'collection'")
          .all(req.user!.id) as { target_id: number }[]
      ).map((s) => s.target_id),
    );

    res.json({
      collections: rows.map((c) => ({
        id: c.id,
        slug: c.slug,
        name: c.name,
        description: c.description,
        audience: c.audience,
        isDefault: c.is_default === 1,
        skillCount: c.skill_count,
        // Company defaults apply to everyone; showing them as "subscribed" keeps
        // the UI honest about what will land on your machine.
        subscribed: c.is_default === 1 || subs.has(c.id),
        locked: c.is_default === 1,
      })),
    });
  }),
);

collectionsRouter.get(
  '/:slug',
  requireAuth,
  h((req, res) => {
    const c = db.prepare('SELECT * FROM collections WHERE slug = ?').get(param(req, 'slug')) as
      | CollectionRow
      | undefined;
    if (!c) throw new DomainError('no such collection', 404);
    const skills = db
      .prepare(
        // Same fallback as the catalog: an unapproved skill still shows its name.
        `SELECT s.id, s.slug, s.archived,
                COALESCE(v.title, latest.title)             AS title,
                COALESCE(v.description, latest.description) AS description,
                COALESCE(v.category, latest.category)       AS category,
                v.version
           FROM collection_skills cs
           JOIN skills s ON s.id = cs.skill_id
           LEFT JOIN skill_versions v ON v.id = s.published_version_id
           LEFT JOIN skill_versions latest
                  ON latest.id = (SELECT id FROM skill_versions
                                   WHERE skill_id = s.id
                                   ORDER BY version DESC LIMIT 1)
          WHERE cs.collection_id = ?
          ORDER BY cs.position, s.slug`,
      )
      .all(c.id) as {
      id: number;
      slug: string;
      archived: number;
      title: string | null;
      description: string | null;
      category: string | null;
      version: number | null;
    }[];
    const subscribed =
      c.is_default === 1 ||
      !!db
        .prepare(
          "SELECT 1 FROM subscriptions WHERE user_id = ? AND kind = 'collection' AND target_id = ?",
        )
        .get(req.user!.id, c.id);

    res.json({
      collection: {
        id: c.id,
        slug: c.slug,
        name: c.name,
        description: c.description,
        audience: c.audience,
        isDefault: c.is_default === 1,
        subscribed,
        locked: c.is_default === 1,
        skills: skills.map((s) => ({
          id: s.id,
          slug: s.slug,
          title: s.title ?? s.slug,
          description: s.description ?? '',
          category: s.category ?? 'general',
          version: s.version ?? 0,
          published: s.version !== null,
          archived: s.archived === 1,
        })),
      },
    });
  }),
);

const collectionInput = z.object({
  slug: z.string().regex(SLUG_RE, 'use lowercase-words-with-hyphens'),
  name: z.string().min(2).max(80),
  description: z.string().max(400).default(''),
  audience: z.string().min(1).max(40).default('general'),
  isDefault: z.boolean().default(false),
});

collectionsRouter.post(
  '/',
  requireAuth,
  requireRole('curator'),
  h((req, res) => {
    const body = parse(collectionInput, req.body);
    const id = Number(
      db
        .prepare(
          'INSERT INTO collections (slug, name, description, audience, is_default, created_by) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(body.slug, body.name, body.description, body.audience, body.isDefault ? 1 : 0, req.user!.id)
        .lastInsertRowid,
    );
    audit(req.user!.id, 'collection.create', 'collection', id, body.slug);
    res.status(201).json({ collection: { id, slug: body.slug } });
  }),
);

collectionsRouter.patch(
  '/:slug',
  requireAuth,
  requireRole('curator'),
  h((req, res) => {
    const c = db.prepare('SELECT * FROM collections WHERE slug = ?').get(param(req, 'slug')) as
      | CollectionRow
      | undefined;
    if (!c) throw new DomainError('no such collection', 404);
    const body = parse(collectionInput.partial().omit({ slug: true }), req.body);
    db.prepare(
      `UPDATE collections SET name = COALESCE(?, name), description = COALESCE(?, description),
              audience = COALESCE(?, audience), is_default = COALESCE(?, is_default)
        WHERE id = ?`,
    ).run(
      body.name ?? null,
      body.description ?? null,
      body.audience ?? null,
      body.isDefault === undefined ? null : body.isDefault ? 1 : 0,
      c.id,
    );
    audit(req.user!.id, 'collection.update', 'collection', c.id, c.slug);
    res.json({ ok: true });
  }),
);

collectionsRouter.delete(
  '/:slug',
  requireAuth,
  requireRole('curator'),
  h((req, res) => {
    const c = db.prepare('SELECT * FROM collections WHERE slug = ?').get(param(req, 'slug')) as
      | CollectionRow
      | undefined;
    if (!c) throw new DomainError('no such collection', 404);
    db.transaction(() => {
      db.prepare('DELETE FROM subscriptions WHERE kind = ? AND target_id = ?').run('collection', c.id);
      db.prepare('DELETE FROM collections WHERE id = ?').run(c.id);
    })();
    audit(req.user!.id, 'collection.delete', 'collection', null, c.slug);
    res.json({ ok: true });
  }),
);

collectionsRouter.put(
  '/:slug/skills/:skillSlug',
  requireAuth,
  requireRole('curator'),
  h((req, res) => {
    const c = db.prepare('SELECT * FROM collections WHERE slug = ?').get(param(req, 'slug')) as
      | CollectionRow
      | undefined;
    if (!c) throw new DomainError('no such collection', 404);
    const skill = getSkillBySlug(param(req, 'skillSlug'));
    if (!skill) throw new DomainError('no such skill', 404);
    const position = (
      db
        .prepare('SELECT COALESCE(MAX(position), 0) AS p FROM collection_skills WHERE collection_id = ?')
        .get(c.id) as { p: number }
    ).p + 1;
    db.prepare(
      'INSERT OR IGNORE INTO collection_skills (collection_id, skill_id, position) VALUES (?, ?, ?)',
    ).run(c.id, skill.id, position);
    audit(req.user!.id, 'collection.add_skill', 'collection', c.id, skill.slug);
    res.json({ ok: true });
  }),
);

collectionsRouter.delete(
  '/:slug/skills/:skillSlug',
  requireAuth,
  requireRole('curator'),
  h((req, res) => {
    const c = db.prepare('SELECT * FROM collections WHERE slug = ?').get(param(req, 'slug')) as
      | CollectionRow
      | undefined;
    if (!c) throw new DomainError('no such collection', 404);
    const skill = getSkillBySlug(param(req, 'skillSlug'));
    if (!skill) throw new DomainError('no such skill', 404);
    db.prepare('DELETE FROM collection_skills WHERE collection_id = ? AND skill_id = ?').run(
      c.id,
      skill.id,
    );
    audit(req.user!.id, 'collection.remove_skill', 'collection', c.id, skill.slug);
    res.json({ ok: true });
  }),
);
