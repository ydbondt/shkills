import { db } from '../db.js';
import { manifestChecksum, renderSkillMd } from '../skill-format.js';

export interface SyncSkill {
  slug: string;
  title: string;
  description: string;
  category: string;
  audiences: string[];
  tags: string[];
  version: number;
  checksum: string;
  /** The exact SKILL.md bytes the CLI should write. */
  content: string;
  /** Why this user gets it — shown by `shkills list`. */
  sources: string[];
  updatedAt: string;
}

interface Row {
  slug: string;
  title: string;
  description: string;
  category: string;
  audiences: string;
  tags: string;
  allowed_tools: string | null;
  user_invocable: number;
  body: string;
  version: number;
  checksum: string;
  updated_at: string;
}

/**
 * Everything a user is entitled to: their own personal skills, their direct
 * skill subscriptions, the collections they picked, plus every collection
 * marked as a company default.
 *
 * Default collections are deliberately not opt-out — they are the mechanism by
 * which "everyone uses the same skills" is actually true.
 *
 * The `visibility` clause is the one that has to be right: somebody else's
 * personal skill must not reach this machine by any of the routes below, even
 * if a stale subscription row somehow points at it.
 */
export function effectiveSkills(userId: number): SyncSkill[] {
  const rows = db
    .prepare(
      `SELECT s.slug, v.title, v.description, v.category, v.audiences, v.tags,
              v.allowed_tools, v.user_invocable, v.body, v.version, v.checksum, s.updated_at
         FROM skills s
         JOIN skill_versions v ON v.id = s.published_version_id
        WHERE s.archived = 0
          AND (s.visibility = 'shared' OR s.owner_id = @uid)
          AND (
            -- Your own drafts arrive without asking: syncing them between your
            -- machines is why they exist.
            (s.visibility = 'personal' AND s.owner_id = @uid)
            OR s.id IN (SELECT target_id FROM subscriptions WHERE user_id = @uid AND kind = 'skill')
            OR s.id IN (
              SELECT cs.skill_id FROM collection_skills cs
                JOIN collections c ON c.id = cs.collection_id
               WHERE c.is_default = 1
                  OR c.id IN (SELECT target_id FROM subscriptions
                               WHERE user_id = @uid AND kind = 'collection')
            )
          )
        ORDER BY s.slug`,
    )
    .all({ uid: userId }) as Row[];

  const sources = sourcesByslug(userId);

  return rows.map((r) => {
    const audiences = JSON.parse(r.audiences) as string[];
    const tags = JSON.parse(r.tags) as string[];
    return {
      slug: r.slug,
      title: r.title,
      description: r.description,
      category: r.category,
      audiences,
      tags,
      version: r.version,
      checksum: r.checksum,
      content: renderSkillMd({
        slug: r.slug,
        title: r.title,
        description: r.description,
        category: r.category,
        audiences,
        tags,
        allowedTools: r.allowed_tools,
        userInvocable: r.user_invocable === 1,
        body: r.body,
        version: r.version,
      }),
      sources: sources.get(r.slug) ?? [],
      updatedAt: r.updated_at,
    };
  });
}

function sourcesByslug(userId: number): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const push = (slug: string, source: string) => {
    const list = map.get(slug) ?? [];
    if (!list.includes(source)) list.push(source);
    map.set(slug, list);
  };

  const own = db
    .prepare("SELECT slug FROM skills WHERE owner_id = ? AND visibility = 'personal'")
    .all(userId) as { slug: string }[];
  for (const o of own) push(o.slug, 'yours');

  const direct = db
    .prepare(
      `SELECT s.slug FROM skills s
         JOIN subscriptions sub ON sub.target_id = s.id AND sub.kind = 'skill'
        WHERE sub.user_id = ?`,
    )
    .all(userId) as { slug: string }[];
  for (const d of direct) push(d.slug, 'direct');

  const viaCollections = db
    .prepare(
      `SELECT s.slug, c.name, c.is_default FROM collections c
         JOIN collection_skills cs ON cs.collection_id = c.id
         JOIN skills s ON s.id = cs.skill_id
        WHERE c.is_default = 1
           OR c.id IN (SELECT target_id FROM subscriptions WHERE user_id = ? AND kind = 'collection')`,
    )
    .all(userId) as { slug: string; name: string; is_default: number }[];
  for (const c of viaCollections) push(c.slug, c.is_default ? `${c.name} (company default)` : c.name);

  return map;
}

export interface SyncManifest {
  manifest: string;
  generatedAt: string;
  skills: SyncSkill[];
}

export function buildManifest(userId: number): SyncManifest {
  const skills = effectiveSkills(userId);
  return {
    manifest: manifestChecksum(skills),
    generatedAt: new Date().toISOString(),
    skills,
  };
}
