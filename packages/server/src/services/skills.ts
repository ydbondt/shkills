import { audit, db } from '../db.js';
import { checksum, renderSkillMd, SLUG_RE } from '../skill-format.js';
import type { AuthUser } from '../auth.js';

export interface SkillVersionRow {
  id: number;
  skill_id: number;
  version: number;
  title: string;
  description: string;
  category: string;
  audiences: string;
  tags: string;
  allowed_tools: string | null;
  user_invocable: number;
  body: string;
  change_note: string;
  status: string;
  author_id: number;
  reviewer_id: number | null;
  review_note: string | null;
  checksum: string;
  created_at: string;
  reviewed_at: string | null;
}

export interface SkillRow {
  id: number;
  slug: string;
  owner_id: number;
  published_version_id: number | null;
  archived: number;
  created_at: string;
  updated_at: string;
}

export interface SkillDraft {
  slug: string;
  title: string;
  description: string;
  category: string;
  audiences: string[];
  tags: string[];
  allowedTools?: string | null;
  userInvocable: boolean;
  body: string;
  changeNote: string;
}

export class DomainError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function versionChecksum(slug: string, d: SkillDraft, version: number): string {
  return checksum(
    renderSkillMd({
      slug,
      title: d.title,
      description: d.description,
      category: d.category,
      audiences: d.audiences,
      tags: d.tags,
      allowedTools: d.allowedTools,
      userInvocable: d.userInvocable,
      body: d.body,
      version,
    }),
  );
}

export function getSkillBySlug(slug: string): SkillRow | undefined {
  return db.prepare('SELECT * FROM skills WHERE slug = ?').get(slug) as SkillRow | undefined;
}

export function getSkill(id: number): SkillRow | undefined {
  return db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as SkillRow | undefined;
}

export function getVersion(id: number): SkillVersionRow | undefined {
  return db.prepare('SELECT * FROM skill_versions WHERE id = ?').get(id) as
    | SkillVersionRow
    | undefined;
}

/**
 * Creates a brand new skill together with its first version.
 *
 * Curators skip the queue: making them submit a proposal only they can approve
 * is ceremony, not review. Anyone else lands in `pending`.
 */
export function createSkill(
  author: AuthUser,
  draft: SkillDraft,
  opts: { submitForReview?: boolean } = {},
): { skill: SkillRow; version: SkillVersionRow } {
  if (!SLUG_RE.test(draft.slug)) {
    throw new DomainError('slug must be lowercase words separated by single hyphens');
  }
  if (getSkillBySlug(draft.slug)) {
    throw new DomainError(`a skill named "${draft.slug}" already exists`, 409);
  }

  const canSelfPublish = (author.role === 'curator' || author.role === 'admin') && !opts.submitForReview;
  const status = canSelfPublish ? 'approved' : 'pending';

  const tx = db.transaction(() => {
    const skillId = Number(
      db.prepare('INSERT INTO skills (slug, owner_id) VALUES (?, ?)').run(draft.slug, author.id)
        .lastInsertRowid,
    );
    const versionId = insertVersion(skillId, draft.slug, 1, draft, author.id, status);
    if (status === 'approved') {
      db.prepare(
        "UPDATE skill_versions SET reviewer_id = ?, reviewed_at = datetime('now') WHERE id = ?",
      ).run(author.id, versionId);
      db.prepare('UPDATE skills SET published_version_id = ? WHERE id = ?').run(versionId, skillId);
    }
    return { skillId, versionId };
  });

  const { skillId, versionId } = tx();
  audit(author.id, status === 'approved' ? 'skill.publish' : 'skill.propose', 'skill', skillId, draft.slug);
  return { skill: getSkill(skillId)!, version: getVersion(versionId)! };
}

function insertVersion(
  skillId: number,
  slug: string,
  version: number,
  draft: SkillDraft,
  authorId: number,
  status: string,
): number {
  return Number(
    db
      .prepare(
        `INSERT INTO skill_versions
           (skill_id, version, title, description, category, audiences, tags, allowed_tools,
            user_invocable, body, change_note, status, author_id, checksum)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        skillId,
        version,
        draft.title,
        draft.description,
        draft.category,
        JSON.stringify(draft.audiences),
        JSON.stringify(draft.tags),
        draft.allowedTools ?? null,
        draft.userInvocable ? 1 : 0,
        draft.body,
        draft.changeNote,
        status,
        authorId,
        versionChecksum(slug, draft, version),
      ).lastInsertRowid,
  );
}

/** Proposes a new version of an existing skill. The live version keeps serving until approval. */
export function proposeRevision(
  author: AuthUser,
  skill: SkillRow,
  draft: Omit<SkillDraft, 'slug'>,
  opts: { submitForReview?: boolean } = {},
): SkillVersionRow {
  if (skill.archived) throw new DomainError('skill is archived; restore it first', 409);

  const nextVersion =
    (
      db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM skill_versions WHERE skill_id = ?').get(
        skill.id,
      ) as { v: number }
    ).v + 1;

  const canSelfPublish = (author.role === 'curator' || author.role === 'admin') && !opts.submitForReview;
  const status = canSelfPublish ? 'approved' : 'pending';
  const full: SkillDraft = { ...draft, slug: skill.slug };

  const tx = db.transaction(() => {
    const versionId = insertVersion(skill.id, skill.slug, nextVersion, full, author.id, status);
    if (status === 'approved') publishVersionInternal(skill.id, versionId, author.id, null);
    db.prepare("UPDATE skills SET updated_at = datetime('now') WHERE id = ?").run(skill.id);
    return versionId;
  });

  const versionId = tx();
  audit(
    author.id,
    status === 'approved' ? 'skill.publish' : 'skill.propose',
    'skill',
    skill.id,
    `${skill.slug} v${nextVersion}`,
  );
  return getVersion(versionId)!;
}

function publishVersionInternal(
  skillId: number,
  versionId: number,
  reviewerId: number,
  note: string | null,
): void {
  const current = db.prepare('SELECT published_version_id FROM skills WHERE id = ?').get(skillId) as {
    published_version_id: number | null;
  };
  if (current.published_version_id && current.published_version_id !== versionId) {
    db.prepare("UPDATE skill_versions SET status = 'superseded' WHERE id = ?").run(
      current.published_version_id,
    );
  }
  db.prepare(
    `UPDATE skill_versions
        SET status = 'approved', reviewer_id = ?, review_note = ?, reviewed_at = datetime('now')
      WHERE id = ?`,
  ).run(reviewerId, note, versionId);
  db.prepare("UPDATE skills SET published_version_id = ?, updated_at = datetime('now') WHERE id = ?").run(
    versionId,
    skillId,
  );
}

export function approveVersion(reviewer: AuthUser, version: SkillVersionRow, note?: string): void {
  if (version.status !== 'pending') {
    throw new DomainError(`version is ${version.status}, only pending versions can be approved`, 409);
  }
  db.transaction(() => publishVersionInternal(version.skill_id, version.id, reviewer.id, note ?? null))();
  audit(reviewer.id, 'skill.approve', 'skill', version.skill_id, `v${version.version}`);
}

export function rejectVersion(reviewer: AuthUser, version: SkillVersionRow, note: string): void {
  if (version.status !== 'pending') {
    throw new DomainError(`version is ${version.status}, only pending versions can be rejected`, 409);
  }
  db.prepare(
    `UPDATE skill_versions
        SET status = 'rejected', reviewer_id = ?, review_note = ?, reviewed_at = datetime('now')
      WHERE id = ?`,
  ).run(reviewer.id, note, version.id);
  audit(reviewer.id, 'skill.reject', 'skill', version.skill_id, `v${version.version}: ${note}`);
}

/**
 * Archiving is the delete users actually want: the skill stops being served to
 * every machine on the next sync, but its history stays auditable.
 */
export function archiveSkill(actor: AuthUser, skill: SkillRow): void {
  db.prepare("UPDATE skills SET archived = 1, updated_at = datetime('now') WHERE id = ?").run(skill.id);
  audit(actor.id, 'skill.archive', 'skill', skill.id, skill.slug);
}

export function restoreSkill(actor: AuthUser, skill: SkillRow): void {
  db.prepare("UPDATE skills SET archived = 0, updated_at = datetime('now') WHERE id = ?").run(skill.id);
  audit(actor.id, 'skill.restore', 'skill', skill.id, skill.slug);
}

export function deleteSkillPermanently(actor: AuthUser, skill: SkillRow): void {
  db.transaction(() => {
    db.prepare('UPDATE skills SET published_version_id = NULL WHERE id = ?').run(skill.id);
    db.prepare('DELETE FROM subscriptions WHERE kind = ? AND target_id = ?').run('skill', skill.id);
    db.prepare('DELETE FROM skills WHERE id = ?').run(skill.id);
  })();
  audit(actor.id, 'skill.delete', 'skill', null, skill.slug);
}

export function rollbackTo(actor: AuthUser, version: SkillVersionRow): void {
  if (version.status !== 'superseded' && version.status !== 'approved') {
    throw new DomainError('only previously approved versions can be rolled back to', 409);
  }
  db.transaction(() => publishVersionInternal(version.skill_id, version.id, actor.id, 'rollback'))();
  audit(actor.id, 'skill.rollback', 'skill', version.skill_id, `to v${version.version}`);
}
