import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { canCurate, requireAuth, requireRole } from '../auth.js';
import { h, parse, param } from '../http.js';
import { renderSkillMd, SLUG_RE } from '../skill-format.js';
import {
  DomainError,
  approveVersion,
  archiveSkill,
  createSkill,
  deleteSkillPermanently,
  getSkill,
  getSkillBySlug,
  getVersion,
  proposeRevision,
  rejectVersion,
  restoreSkill,
  rollbackTo,
  type SkillVersionRow,
} from '../services/skills.js';

export const skillsRouter: Router = Router();

const draftSchema = z.object({
  title: z.string().min(2).max(120),
  description: z
    .string()
    .min(20, 'a description is what makes Claude pick the skill — write at least a sentence')
    .max(1024),
  category: z.string().min(1).max(40).default('general'),
  audiences: z.array(z.string().min(1).max(40)).max(12).default([]),
  tags: z.array(z.string().min(1).max(40)).max(24).default([]),
  allowedTools: z.string().max(400).nullish(),
  userInvocable: z.boolean().default(false),
  body: z.string().min(20, 'a skill needs instructions').max(120_000),
  changeNote: z.string().max(400).default(''),
});

const createSchema = draftSchema.extend({
  slug: z.string().regex(SLUG_RE, 'use lowercase-words-with-hyphens'),
  submitForReview: z.boolean().optional(),
});

interface ListRow {
  id: number;
  slug: string;
  archived: number;
  updated_at: string;
  owner_name: string;
  title: string | null;
  description: string | null;
  category: string | null;
  audiences: string | null;
  tags: string | null;
  /** Null until a version has been approved. */
  published_version: number | null;
  pending_count: number;
}

function toSummary(r: ListRow, subscribed = false) {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title ?? r.slug,
    description: r.description ?? '',
    category: r.category ?? 'general',
    audiences: r.audiences ? (JSON.parse(r.audiences) as string[]) : [],
    tags: r.tags ? (JSON.parse(r.tags) as string[]) : [],
    version: r.published_version ?? 0,
    published: r.published_version !== null,
    archived: r.archived === 1,
    owner: r.owner_name,
    pendingCount: r.pending_count,
    updatedAt: r.updated_at,
    subscribed,
  };
}

skillsRouter.get(
  '/',
  requireAuth,
  h((req, res) => {
    const q = parse(
      z.object({
        q: z.string().max(120).optional(),
        category: z.string().max(40).optional(),
        audience: z.string().max(40).optional(),
        includeArchived: z.enum(['0', '1']).default('0'),
        unpublished: z.enum(['0', '1']).default('1'),
      }),
      req.query,
    );

    const rows = db
      .prepare(
        // A skill awaiting its first approval has no published version, but it
        // still needs a name and a description to show — fall back to its most
        // recent version so nothing renders as a blank card.
        `SELECT s.id, s.slug, s.archived, s.updated_at, u.name AS owner_name,
                COALESCE(v.title, latest.title)             AS title,
                COALESCE(v.description, latest.description) AS description,
                COALESCE(v.category, latest.category)       AS category,
                COALESCE(v.audiences, latest.audiences)     AS audiences,
                COALESCE(v.tags, latest.tags)               AS tags,
                v.version                                   AS published_version,
                (SELECT COUNT(*) FROM skill_versions p
                  WHERE p.skill_id = s.id AND p.status = 'pending') AS pending_count
           FROM skills s
           JOIN users u ON u.id = s.owner_id
           LEFT JOIN skill_versions v ON v.id = s.published_version_id
           LEFT JOIN skill_versions latest
                  ON latest.id = (SELECT id FROM skill_versions
                                   WHERE skill_id = s.id
                                   ORDER BY version DESC LIMIT 1)
          ORDER BY s.updated_at DESC`,
      )
      .all() as ListRow[];

    const subs = new Set(
      (
        db
          .prepare("SELECT target_id FROM subscriptions WHERE user_id = ? AND kind = 'skill'")
          .all(req.user!.id) as { target_id: number }[]
      ).map((s) => s.target_id),
    );

    const needle = q.q?.toLowerCase().trim();
    const filtered = rows.filter((r) => {
      if (q.includeArchived === '0' && r.archived === 1) return false;
      if (q.unpublished === '0' && r.published_version === null) return false;
      if (q.category && r.category !== q.category) return false;
      if (q.audience && !(r.audiences ?? '[]').toLowerCase().includes(q.audience.toLowerCase())) {
        return false;
      }
      if (needle) {
        const haystack = `${r.slug} ${r.title ?? ''} ${r.description ?? ''} ${r.tags ?? ''}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });

    res.json({ skills: filtered.map((r) => toSummary(r, subs.has(r.id))) });
  }),
);

/** Distinct categories and audiences currently in use — drives the filter chips. */
skillsRouter.get(
  '/facets',
  requireAuth,
  h((_req, res) => {
    const versions = db
      .prepare(
        `SELECT v.category, v.audiences FROM skills s
           JOIN skill_versions v ON v.id = s.published_version_id WHERE s.archived = 0`,
      )
      .all() as { category: string; audiences: string }[];
    const categories = new Set<string>();
    const audiences = new Set<string>();
    for (const v of versions) {
      categories.add(v.category);
      for (const a of JSON.parse(v.audiences) as string[]) audiences.add(a);
    }
    res.json({
      categories: [...categories].sort(),
      audiences: [...audiences].sort(),
    });
  }),
);

/** The curator's review queue. */
skillsRouter.get(
  '/pending',
  requireAuth,
  requireRole('curator'),
  h((_req, res) => {
    const rows = db
      .prepare(
        `SELECT v.*, s.slug, u.name AS author_name, s.published_version_id
           FROM skill_versions v
           JOIN skills s ON s.id = v.skill_id
           JOIN users u ON u.id = v.author_id
          WHERE v.status = 'pending'
          ORDER BY v.created_at ASC`,
      )
      .all() as (SkillVersionRow & {
      slug: string;
      author_name: string;
      published_version_id: number | null;
    })[];

    res.json({
      proposals: rows.map((r) => ({
        versionId: r.id,
        skillId: r.skill_id,
        slug: r.slug,
        version: r.version,
        title: r.title,
        description: r.description,
        category: r.category,
        audiences: JSON.parse(r.audiences),
        tags: JSON.parse(r.tags),
        body: r.body,
        changeNote: r.change_note,
        author: r.author_name,
        createdAt: r.created_at,
        isNewSkill: r.version === 1 && r.published_version_id === null,
      })),
    });
  }),
);

skillsRouter.post(
  '/',
  requireAuth,
  h((req, res) => {
    const body = parse(createSchema, req.body);
    const { skill, version } = createSkill(req.user!, body, {
      submitForReview: body.submitForReview,
    });
    res.status(201).json({
      skill: { id: skill.id, slug: skill.slug },
      version: { id: version.id, version: version.version, status: version.status },
    });
  }),
);

skillsRouter.get(
  '/:slug',
  requireAuth,
  h((req, res) => {
    const skill = getSkillBySlug(param(req, 'slug'));
    if (!skill) throw new DomainError('no such skill', 404);

    const versions = db
      .prepare(
        `SELECT v.*, a.name AS author_name, r.name AS reviewer_name
           FROM skill_versions v
           JOIN users a ON a.id = v.author_id
           LEFT JOIN users r ON r.id = v.reviewer_id
          WHERE v.skill_id = ? ORDER BY v.version DESC`,
      )
      .all(skill.id) as (SkillVersionRow & { author_name: string; reviewer_name: string | null })[];

    const published = versions.find((v) => v.id === skill.published_version_id) ?? null;
    const owner = db.prepare('SELECT name FROM users WHERE id = ?').get(skill.owner_id) as {
      name: string;
    };
    const subscribed = !!db
      .prepare("SELECT 1 FROM subscriptions WHERE user_id = ? AND kind = 'skill' AND target_id = ?")
      .get(req.user!.id, skill.id);
    const collections = db
      .prepare(
        `SELECT c.slug, c.name FROM collections c
           JOIN collection_skills cs ON cs.collection_id = c.id WHERE cs.skill_id = ?`,
      )
      .all(skill.id);

    res.json({
      skill: {
        id: skill.id,
        slug: skill.slug,
        owner: owner.name,
        archived: skill.archived === 1,
        createdAt: skill.created_at,
        updatedAt: skill.updated_at,
        subscribed,
        collections,
        published: published && {
          ...serializeVersion(published),
          renderedMd: renderSkillMd({
            slug: skill.slug,
            title: published.title,
            description: published.description,
            category: published.category,
            audiences: JSON.parse(published.audiences),
            tags: JSON.parse(published.tags),
            allowedTools: published.allowed_tools,
            userInvocable: published.user_invocable === 1,
            body: published.body,
            version: published.version,
          }),
        },
        versions: versions.map(serializeVersion),
      },
    });
  }),
);

function serializeVersion(v: SkillVersionRow & { author_name?: string; reviewer_name?: string | null }) {
  return {
    id: v.id,
    version: v.version,
    title: v.title,
    description: v.description,
    category: v.category,
    audiences: JSON.parse(v.audiences) as string[],
    tags: JSON.parse(v.tags) as string[],
    allowedTools: v.allowed_tools,
    userInvocable: v.user_invocable === 1,
    body: v.body,
    changeNote: v.change_note,
    status: v.status,
    author: v.author_name ?? null,
    reviewer: v.reviewer_name ?? null,
    reviewNote: v.review_note,
    checksum: v.checksum,
    createdAt: v.created_at,
    reviewedAt: v.reviewed_at,
  };
}

/** Proposes a new version. Curators publish immediately unless they ask for review. */
skillsRouter.post(
  '/:slug/versions',
  requireAuth,
  h((req, res) => {
    const skill = getSkillBySlug(param(req, 'slug'));
    if (!skill) throw new DomainError('no such skill', 404);
    const body = parse(draftSchema.extend({ submitForReview: z.boolean().optional() }), req.body);
    const version = proposeRevision(req.user!, skill, body, {
      submitForReview: body.submitForReview,
    });
    res.status(201).json({ version: { id: version.id, version: version.version, status: version.status } });
  }),
);

skillsRouter.post(
  '/versions/:id/approve',
  requireAuth,
  requireRole('curator'),
  h((req, res) => {
    const version = getVersion(Number(param(req, 'id')));
    if (!version) throw new DomainError('no such version', 404);
    const note = parse(z.object({ note: z.string().max(400).optional() }), req.body ?? {});
    approveVersion(req.user!, version, note.note);
    res.json({ ok: true });
  }),
);

skillsRouter.post(
  '/versions/:id/reject',
  requireAuth,
  requireRole('curator'),
  h((req, res) => {
    const version = getVersion(Number(param(req, 'id')));
    if (!version) throw new DomainError('no such version', 404);
    const body = parse(
      z.object({ note: z.string().min(1, 'tell the author why').max(400) }),
      req.body ?? {},
    );
    rejectVersion(req.user!, version, body.note);
    res.json({ ok: true });
  }),
);

skillsRouter.post(
  '/versions/:id/rollback',
  requireAuth,
  requireRole('curator'),
  h((req, res) => {
    const version = getVersion(Number(param(req, 'id')));
    if (!version) throw new DomainError('no such version', 404);
    rollbackTo(req.user!, version);
    res.json({ ok: true });
  }),
);

skillsRouter.delete(
  '/:slug',
  requireAuth,
  h((req, res) => {
    const skill = getSkillBySlug(param(req, 'slug'));
    if (!skill) throw new DomainError('no such skill', 404);
    const purge = req.query.purge === '1';
    // Owners can retire their own skill; taking it away from everyone else's
    // machines permanently is a curator decision.
    if (!canCurate(req.user!) && skill.owner_id !== req.user!.id) {
      throw new DomainError('only the owner or a curator can remove this skill', 403);
    }
    if (purge) {
      if (req.user!.role !== 'admin') throw new DomainError('only an admin can purge a skill', 403);
      deleteSkillPermanently(req.user!, skill);
      res.json({ ok: true, purged: true });
      return;
    }
    archiveSkill(req.user!, skill);
    res.json({ ok: true, archived: true });
  }),
);

skillsRouter.post(
  '/:slug/restore',
  requireAuth,
  requireRole('curator'),
  h((req, res) => {
    const skill = getSkillBySlug(param(req, 'slug'));
    if (!skill) throw new DomainError('no such skill', 404);
    restoreSkill(req.user!, skill);
    res.json({ ok: true });
  }),
);

skillsRouter.get(
  '/:slug/raw',
  requireAuth,
  h((req, res) => {
    const skill = getSkillBySlug(param(req, 'slug'));
    if (!skill?.published_version_id) throw new DomainError('no published version', 404);
    const v = getVersion(skill.published_version_id)!;
    res.type('text/markdown').send(
      renderSkillMd({
        slug: skill.slug,
        title: v.title,
        description: v.description,
        category: v.category,
        audiences: JSON.parse(v.audiences),
        tags: JSON.parse(v.tags),
        allowedTools: v.allowed_tools,
        userInvocable: v.user_invocable === 1,
        body: v.body,
        version: v.version,
      }),
    );
  }),
);

export { getSkill };
