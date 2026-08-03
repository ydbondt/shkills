import { createHash } from 'node:crypto';
import http from 'node:http';

/**
 * A GitHub that is not GitHub, over a real socket.
 *
 * It stores blobs, trees, commits and refs the way the real git-data API does,
 * including returning directory entries in a recursive tree listing — so a
 * client that forgets to skip `type: "tree"` fails here rather than in
 * production. Mocking `fetch` instead would only prove the mock works.
 */

export interface FakeRepo {
  /** Path → content, as the repository currently stands. */
  files(): Map<string, string>;
  commits(): { sha: string; message: string; parent: string | null }[];
  url: string;
  /** Requests seen, so a test can assert what was and was not sent. */
  requests: { method: string; path: string; auth: string }[];
  /** Make the next N calls fail, to exercise the unhappy path. */
  failNext(count: number, status?: number): void;
  stop(): Promise<void>;
}

interface Entry {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
}

function sha1(kind: string, body: Buffer): string {
  return createHash('sha1').update(`${kind} ${body.length}\0`).update(body).digest('hex');
}

export async function startFakeGitHub(
  options: { owner: string; repo: string; empty?: boolean; branch?: string } = {
    owner: 'acme',
    repo: 'skills',
  },
): Promise<FakeRepo> {
  const branch = options.branch ?? 'main';
  const blobs = new Map<string, Buffer>();
  /** Tree sha → flat list of blob paths, which is all this fake needs to model. */
  const trees = new Map<string, Map<string, string>>();
  const commits = new Map<string, { tree: string; message: string; parent: string | null }>();
  const order: { sha: string; message: string; parent: string | null }[] = [];
  const refs = new Map<string, string>();
  const requests: { method: string; path: string; auth: string }[] = [];
  let failures = 0;
  let failureStatus = 500;

  const treeSha = (files: Map<string, string>) =>
    sha1('tree', Buffer.from([...files].sort().map(([p, s]) => `${p}:${s}`).join('\n')));

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://fake');
    const path = url.pathname;
    requests.push({ method: req.method ?? '', path, auth: req.headers.authorization ?? '' });

    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const send = (status: number, body: unknown) => {
        const payload = JSON.stringify(body);
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(payload);
      };

      if (failures > 0) {
        failures -= 1;
        send(failureStatus, { message: 'the fake GitHub was told to fail' });
        return;
      }
      if (!req.headers.authorization?.startsWith('Bearer ')) {
        send(401, { message: 'Requires authentication' });
        return;
      }

      const prefix = `/repos/${options.owner}/${options.repo}`;
      if (!path.startsWith(prefix)) {
        send(404, { message: 'Not Found' });
        return;
      }
      const rest = path.slice(prefix.length);
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};

      // GET /repos/{o}/{r}
      if (rest === '' && req.method === 'GET') {
        send(200, { full_name: `${options.owner}/${options.repo}`, permissions: { push: true } });
        return;
      }

      // GET /git/ref/heads/{branch}
      const refMatch = /^\/git\/ref\/heads\/(.+)$/.exec(rest);
      if (refMatch && req.method === 'GET') {
        const sha = refs.get(decodeURIComponent(refMatch[1]));
        if (!sha) {
          send(404, { message: 'Not Found' });
          return;
        }
        send(200, { object: { sha } });
        return;
      }

      // GET /git/commits/{sha}
      const commitMatch = /^\/git\/commits\/([0-9a-f]+)$/.exec(rest);
      if (commitMatch && req.method === 'GET') {
        const commit = commits.get(commitMatch[1]);
        if (!commit) {
          send(404, { message: 'Not Found' });
          return;
        }
        send(200, { sha: commitMatch[1], tree: { sha: commit.tree }, message: commit.message });
        return;
      }

      // GET /git/trees/{sha}?recursive=1
      const treeMatch = /^\/git\/trees\/([0-9a-f]+)$/.exec(rest);
      if (treeMatch && req.method === 'GET') {
        const files = trees.get(treeMatch[1]);
        if (!files) {
          send(404, { message: 'Not Found' });
          return;
        }
        // Real GitHub lists directories as their own entries. Emit them, so a
        // client that does not skip them is caught here.
        const dirs = new Set<string>();
        for (const p of files.keys()) {
          const parts = p.split('/');
          for (let i = 1; i < parts.length; i += 1) dirs.add(parts.slice(0, i).join('/'));
        }
        const entries: Entry[] = [
          ...[...dirs].map((d) => ({ path: d, mode: '040000', type: 'tree' as const, sha: sha1('tree', Buffer.from(d)) })),
          ...[...files].map(([p, s]) => ({ path: p, mode: '100644', type: 'blob' as const, sha: s })),
        ];
        send(200, { sha: treeMatch[1], tree: entries, truncated: false });
        return;
      }

      // GET /git/blobs/{sha}
      const blobMatch = /^\/git\/blobs\/([0-9a-f]+)$/.exec(rest);
      if (blobMatch && req.method === 'GET') {
        const blob = blobs.get(blobMatch[1]);
        if (!blob) {
          send(404, { message: 'Not Found' });
          return;
        }
        send(200, { sha: blobMatch[1], content: blob.toString('base64'), encoding: 'base64' });
        return;
      }

      // POST /git/trees
      if (rest === '/git/trees' && req.method === 'POST') {
        const files = new Map(trees.get(String(body.base_tree ?? '')) ?? []);
        for (const entry of (body.tree ?? []) as { path: string; content?: string; sha: string | null }[]) {
          if (entry.sha === null && entry.content === undefined) {
            files.delete(entry.path);
            continue;
          }
          const content = Buffer.from(entry.content ?? '', 'utf8');
          const sha = sha1('blob', content);
          blobs.set(sha, content);
          files.set(entry.path, sha);
        }
        const sha = treeSha(files);
        trees.set(sha, files);
        send(201, { sha });
        return;
      }

      // POST /git/commits
      if (rest === '/git/commits' && req.method === 'POST') {
        const parents = (body.parents ?? []) as string[];
        const sha = sha1(
          'commit',
          Buffer.from(`${String(body.tree)}${parents.join('')}${String(body.message)}${order.length}`),
        );
        commits.set(sha, {
          tree: String(body.tree),
          message: String(body.message),
          parent: parents[0] ?? null,
        });
        order.push({ sha, message: String(body.message), parent: parents[0] ?? null });
        send(201, { sha });
        return;
      }

      // POST /git/refs — first push to a branch
      if (rest === '/git/refs' && req.method === 'POST') {
        const name = String(body.ref).replace('refs/heads/', '');
        refs.set(name, String(body.sha));
        send(201, { ref: body.ref, object: { sha: body.sha } });
        return;
      }

      // PATCH /git/refs/heads/{branch}
      const updateMatch = /^\/git\/refs\/heads\/(.+)$/.exec(rest);
      if (updateMatch && req.method === 'PATCH') {
        refs.set(decodeURIComponent(updateMatch[1]), String(body.sha));
        send(200, { object: { sha: body.sha } });
        return;
      }

      send(404, { message: `the fake GitHub has no ${req.method} ${rest}` });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  if (!options.empty) {
    // A repository that already has a commit and a file the mirror does not own,
    // which is the normal case and the one where clobbering would be a bug.
    const readme = Buffer.from('# Not ours\n', 'utf8');
    const sha = sha1('blob', readme);
    blobs.set(sha, readme);
    const files = new Map([['NOTES.md', sha]]);
    const tSha = treeSha(files);
    trees.set(tSha, files);
    const cSha = sha1('commit', Buffer.from('initial'));
    commits.set(cSha, { tree: tSha, message: 'initial', parent: null });
    order.push({ sha: cSha, message: 'initial', parent: null });
    refs.set(branch, cSha);
  }

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    failNext(count, status = 500) {
      failures = count;
      failureStatus = status;
    },
    files() {
      const head = refs.get(branch);
      if (!head) return new Map();
      const tree = trees.get(commits.get(head)!.tree)!;
      return new Map([...tree].map(([p, s]) => [p, blobs.get(s)!.toString('utf8')]));
    },
    commits() {
      return order.filter((c) => c.message !== 'initial');
    },
    async stop() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
