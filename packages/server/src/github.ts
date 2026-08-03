import { config } from './config.js';

/**
 * The slice of GitHub's git-data API needed to write a directory of files as
 * one commit.
 *
 * The API rather than the `git` binary on purpose: there is no git in the
 * runtime image, no working copy to keep on the volume, no SSH key or
 * credential helper to arrange, and nothing to merge. What we want to say is
 * "the repository should look like this now", which is exactly a tree plus a
 * commit plus a ref update.
 */

export interface Repo {
  owner: string;
  repo: string;
  branch: string;
}

/** One file the mirror wants in the repository, or wants gone. */
export interface FileChange {
  path: string;
  /** `null` deletes the path. */
  content: string | null;
}

export interface TreeEntry {
  path: string;
  mode: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
}

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const BLOB_MODE = '100644';

function api(): string {
  return config.github.api.replace(/\/$/, '');
}

/**
 * Every call goes through here so the token is applied in one place — and so
 * that no error message can carry it: GitHub echoes the request URL in some
 * failures, and the URL never contains the credential.
 */
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = config.github.token;
  if (!token) throw new GitHubError('no GitHub token is configured on this server', 500);

  const response = await fetch(`${api()}${path}`, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'shkills',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const parsed = JSON.parse(text) as { message?: string };
      if (parsed.message) detail = parsed.message;
    } catch {
      /* not JSON — the status line is all we have */
    }
    throw new GitHubError(`${method} ${path} → ${response.status}: ${detail}`, response.status);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

function base(r: Repo): string {
  return `/repos/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.repo)}`;
}

/** The commit the branch points at, or `null` when the branch does not exist yet. */
export async function headCommit(r: Repo): Promise<string | null> {
  try {
    const ref = await call<{ object: { sha: string } }>(
      'GET',
      `${base(r)}/git/ref/heads/${encodeURIComponent(r.branch)}`,
    );
    return ref.object.sha;
  } catch (err) {
    // A repository with no commits at all, or a branch nobody has pushed yet.
    // Both are ordinary starting states for a mirror, not failures.
    if (err instanceof GitHubError && (err.status === 404 || err.status === 409)) return null;
    throw err;
  }
}

/** Every blob under `prefix`, keyed by path. Empty when the branch is new. */
export async function filesUnder(
  r: Repo,
  commitSha: string | null,
  prefix: string,
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  if (!commitSha) return found;

  const commit = await call<{ tree: { sha: string } }>('GET', `${base(r)}/git/commits/${commitSha}`);
  const tree = await call<{ tree: TreeEntry[]; truncated?: boolean }>(
    'GET',
    `${base(r)}/git/trees/${commit.tree.sha}?recursive=1`,
  );
  if (tree.truncated) {
    throw new GitHubError(
      'the repository tree is too large for one listing, so the mirror cannot tell what is already there',
      422,
    );
  }

  const scope = prefix ? `${prefix}/` : '';
  for (const entry of tree.tree) {
    // Directories come back as their own entries; only blobs are files.
    if (entry.type !== 'blob') continue;
    if (scope && !entry.path.startsWith(scope)) continue;
    found.set(entry.path, entry.sha);
  }
  return found;
}

export async function readBlob(r: Repo, sha: string): Promise<string> {
  const blob = await call<{ content: string; encoding: string }>('GET', `${base(r)}/git/blobs/${sha}`);
  return blob.encoding === 'base64'
    ? Buffer.from(blob.content, 'base64').toString('utf8')
    : blob.content;
}

/**
 * Writes `changes` as a single commit on top of whatever the branch is at.
 *
 * `base_tree` is passed so that files the mirror does not own — a README at the
 * root, a licence, somebody else's directory — survive. Only the paths named
 * here change.
 */
export async function commitChanges(
  r: Repo,
  parent: string | null,
  message: string,
  changes: FileChange[],
): Promise<string> {
  const baseTreeSha = parent
    ? (await call<{ tree: { sha: string } }>('GET', `${base(r)}/git/commits/${parent}`)).tree.sha
    : undefined;

  const tree = await call<{ sha: string }>('POST', `${base(r)}/git/trees`, {
    ...(baseTreeSha ? { base_tree: baseTreeSha } : {}),
    tree: changes.map((change) =>
      change.content === null
        ? { path: change.path, mode: BLOB_MODE, type: 'blob', sha: null }
        : { path: change.path, mode: BLOB_MODE, type: 'blob', content: change.content },
    ),
  });

  const commit = await call<{ sha: string }>('POST', `${base(r)}/git/commits`, {
    message,
    tree: tree.sha,
    parents: parent ? [parent] : [],
  });

  if (parent) {
    await call('PATCH', `${base(r)}/git/refs/heads/${encodeURIComponent(r.branch)}`, {
      sha: commit.sha,
    });
  } else {
    await call('POST', `${base(r)}/git/refs`, {
      ref: `refs/heads/${r.branch}`,
      sha: commit.sha,
    });
  }
  return commit.sha;
}

/** Confirms the repository exists and the token may write to it. */
export async function checkAccess(r: Repo): Promise<void> {
  const repo = await call<{ permissions?: { push?: boolean }; archived?: boolean }>('GET', base(r));
  if (repo.archived) throw new GitHubError('that repository is archived, so nothing can be written to it', 409);
  // Fine-grained tokens can omit `permissions`; a missing block is not a denial.
  if (repo.permissions && !repo.permissions.push) {
    throw new GitHubError('the configured token cannot write to that repository', 403);
  }
}
