import { createHash } from 'node:crypto';
import { audit, db } from '../db.js';
import { renderSkillMd } from '../skill-format.js';
import { commitChanges, filesUnder, headCommit, GitHubError, type FileChange, type Repo } from '../github.js';
import { config } from '../config.js';

/**
 * Mirroring the company skills into a git repository, so that they are not
 * trapped in this database.
 *
 * **One way.** Shkills is the source of truth and the repository is a copy.
 * The problem this solves is leaving — "we want our skills back" — not editing
 * skills in two places, which would need conflict rules, an answer for who
 * wins, and a story for a hand-edited file that no longer parses.
 *
 * **Reconciled, not replayed.** Each run works out what the repository should
 * contain and pushes the difference as one commit, rather than applying a log
 * of events. That is idempotent and self-healing: a mirror that drifted, or a
 * change made while GitHub was unreachable, is repaired by the next run instead
 * of needing its event found and replayed.
 */

export interface MirrorSettings {
  enabled: boolean;
  owner: string;
  repo: string;
  branch: string;
  pathPrefix: string;
  lastRunAt: string | null;
  lastCommit: string | null;
  lastError: string | null;
}

interface MirrorRow {
  enabled: number;
  owner: string;
  repo: string;
  branch: string;
  path_prefix: string;
  last_run_at: string | null;
  last_commit: string | null;
  last_error: string | null;
}

export function getMirror(): MirrorSettings {
  const row = db.prepare('SELECT * FROM git_mirror WHERE id = 1').get() as MirrorRow;
  return {
    enabled: row.enabled === 1,
    owner: row.owner,
    repo: row.repo,
    branch: row.branch,
    pathPrefix: row.path_prefix,
    lastRunAt: row.last_run_at,
    lastCommit: row.last_commit,
    lastError: row.last_error,
  };
}

export function saveMirror(input: {
  enabled: boolean;
  owner: string;
  repo: string;
  branch: string;
  pathPrefix: string;
}): void {
  db.prepare(
    `UPDATE git_mirror
        SET enabled = ?, owner = ?, repo = ?, branch = ?, path_prefix = ?,
            updated_at = datetime('now')
      WHERE id = 1`,
  ).run(
    input.enabled ? 1 : 0,
    input.owner.trim(),
    input.repo.trim(),
    input.branch.trim() || 'main',
    input.pathPrefix.trim().replace(/^\/+|\/+$/g, ''),
  );
}

/** Whether this deployment is set up to mirror anywhere. */
export function isConfigured(): boolean {
  const m = getMirror();
  return m.enabled && Boolean(m.owner && m.repo && config.github.token);
}

function repoOf(m: MirrorSettings): Repo {
  return { owner: m.owner, repo: m.repo, branch: m.branch };
}

// ---- what the repository should contain -----------------------------------

interface MirrorRowSkill {
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
  owner_name: string;
  updated_at: string;
}

/**
 * The files the repository should hold, keyed by path relative to the prefix.
 *
 * **Company skills only.** A personal skill belongs to one person and must
 * never reach a repository other people can read — that would undo the whole
 * point of it in one step, and quietly. Archived skills are absent too, which
 * is how the mirror comes to delete them.
 */
export function desiredFiles(): Map<string, string> {
  const rows = db
    .prepare(
      `SELECT s.slug, v.title, v.description, v.category, v.audiences, v.tags,
              v.allowed_tools, v.user_invocable, v.body, v.version,
              u.name AS owner_name, s.updated_at
         FROM skills s
         JOIN skill_versions v ON v.id = s.published_version_id
         JOIN users u ON u.id = s.owner_id
        WHERE s.archived = 0 AND s.visibility = 'shared'
        ORDER BY s.slug`,
    )
    .all() as MirrorRowSkill[];

  const files = new Map<string, string>();
  for (const r of rows) {
    files.set(
      `${r.slug}/SKILL.md`,
      renderSkillMd({
        slug: r.slug,
        title: r.title,
        description: r.description,
        category: r.category,
        audiences: JSON.parse(r.audiences) as string[],
        tags: JSON.parse(r.tags) as string[],
        allowedTools: r.allowed_tools,
        userInvocable: r.user_invocable === 1,
        body: r.body,
        version: r.version,
      }),
    );
  }

  files.set('README.md', index(rows));
  return files;
}

/**
 * An index, so that somebody who clones this repository without ever having
 * seen Shkills knows what they are holding and what to do with it. That is the
 * situation the ticket is actually about.
 */
function index(rows: MirrorRowSkill[]): string {
  const lines = [
    '# Skills',
    '',
    'Claude Code skills, mirrored out of Shkills. **Shkills is the source of truth**',
    'and this copy is written from it — an edit made here is overwritten by the next',
    'mirror run, so make changes in the portal.',
    '',
    'Each directory is one skill. To use these without Shkills, copy the directories',
    'you want into `~/.claude/skills/`:',
    '',
    '```bash',
    'cp -r <slug> ~/.claude/skills/',
    '```',
    '',
    `${rows.length} ${rows.length === 1 ? 'skill' : 'skills'}.`,
    '',
    '| Skill | What it is for | Version | Kept by |',
    '| --- | --- | --- | --- |',
  ];
  for (const r of rows) {
    lines.push(
      `| [${escapeCell(r.title)}](${encodeURIComponent(r.slug)}/SKILL.md) | ${escapeCell(
        r.description,
      )} | v${r.version} | ${escapeCell(r.owner_name)} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

/** A table cell cannot hold a pipe or a line break without breaking the table. */
function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim();
}

// ---- pushing the difference ------------------------------------------------

/** Git's own blob id, so a file already in the repo can be recognised without fetching it. */
function blobSha(content: string): string {
  const body = Buffer.from(content, 'utf8');
  return createHash('sha1')
    .update(`blob ${body.length}\0`)
    .update(body)
    .digest('hex');
}

/**
 * Whether a path is one the mirror could have written, and may therefore
 * delete.
 *
 * Being absent from `desiredFiles` is not enough. Point the mirror at the root
 * of a repository that also holds a licence and some documentation, and
 * "delete everything I did not write" deletes them — silently, on the first
 * run, in somebody else's repository. So deletion is limited to the two shapes
 * this file produces, and anything else inside the prefix is left alone.
 */
function mirrorOwns(relative: string): boolean {
  return relative === 'README.md' || /^[^/]+\/SKILL\.md$/.test(relative);
}

export interface MirrorResult {
  ok: boolean;
  /** `null` when nothing needed changing. */
  commit: string | null;
  added: string[];
  updated: string[];
  removed: string[];
  error?: string;
}

const NOTHING: MirrorResult = { ok: true, commit: null, added: [], updated: [], removed: [] };

export async function runMirror(actorId: number | null = null): Promise<MirrorResult> {
  const m = getMirror();
  if (!isConfigured()) return { ...NOTHING, ok: false, error: 'the git mirror is not set up' };

  try {
    const repo = repoOf(m);
    const parent = await headCommit(repo);
    const existing = await filesUnder(repo, parent, m.pathPrefix);
    const desired = desiredFiles();

    const prefixed = (p: string) => (m.pathPrefix ? `${m.pathPrefix}/${p}` : p);

    const added: string[] = [];
    const updated: string[] = [];
    const changes: FileChange[] = [];

    for (const [relative, content] of desired) {
      const path = prefixed(relative);
      const already = existing.get(path);
      if (already === blobSha(content)) continue;
      (already ? updated : added).push(relative);
      changes.push({ path, content });
    }

    const removed: string[] = [];
    for (const path of existing.keys()) {
      const relative = m.pathPrefix ? path.slice(m.pathPrefix.length + 1) : path;
      if (desired.has(relative) || !mirrorOwns(relative)) continue;
      removed.push(relative);
      changes.push({ path, content: null });
    }

    if (changes.length === 0) {
      note(null, null);
      return NOTHING;
    }

    const commit = await commitChanges(repo, parent, message(added, updated, removed), changes);
    note(commit, null);
    audit(actorId, 'mirror.push', 'mirror', null, `${changes.length} files → ${m.owner}/${m.repo}`);
    return { ok: true, commit, added, updated, removed };
  } catch (err) {
    const reason = err instanceof GitHubError || err instanceof Error ? err.message : 'unknown error';
    note(null, reason);
    // Never thrown on: mirroring is a copy, and a copy that is behind must not
    // stop somebody publishing a skill.
    console.error('[shkills] git mirror failed:', reason);
    return { ...NOTHING, ok: false, error: reason };
  }
}

function note(commit: string | null, error: string | null): void {
  db.prepare(
    `UPDATE git_mirror
        SET last_run_at = datetime('now'),
            last_commit = COALESCE(?, last_commit),
            last_error = ?
      WHERE id = 1`,
  ).run(commit, error);
}

/**
 * Describes the diff rather than whatever triggered the run, so the message is
 * true however the run came about — including a catch-up run that covers
 * several changes at once.
 */
function message(added: string[], updated: string[], removed: string[]): string {
  const name = (p: string) => p.replace(/\/SKILL\.md$/, '');
  const parts: string[] = [];
  const only = (list: string[], verb: string) => {
    if (!list.length) return;
    const skills = list.filter((p) => p !== 'README.md').map(name);
    if (!skills.length) return;
    parts.push(
      skills.length <= 3
        ? `${verb} ${skills.join(', ')}`
        : `${verb} ${skills.length} skills`,
    );
  };
  only(added, 'Add');
  only(updated, 'Update');
  only(removed, 'Remove');

  const summary = parts.length ? parts.join('; ') : 'Update the index';
  return `${summary}\n\nMirrored from Shkills.`;
}

// ---- when it runs ----------------------------------------------------------

let pending: NodeJS.Timeout | undefined;

/**
 * Asks for a run shortly after whatever just changed.
 *
 * Deliberately not awaited by the caller and deliberately delayed: approving a
 * skill must not fail, or wait, because GitHub is slow. The delay also collapses
 * a burst of changes — approving three proposals in a row — into one commit.
 */
export function scheduleMirror(delayMs = 2_000): void {
  if (!isConfigured()) return;
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = undefined;
    void runMirror();
  }, delayMs);
  pending.unref?.();
}

/** Stops a scheduled run — for tests, and for a clean shutdown. */
export function cancelScheduledMirror(): void {
  if (pending) clearTimeout(pending);
  pending = undefined;
}
