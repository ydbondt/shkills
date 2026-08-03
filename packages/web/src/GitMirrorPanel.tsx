import { useState, type FormEvent } from 'react';
import { api, type GitMirror, type MirrorResult } from './api';
import { ErrorNote, Field, timeAgo } from './components';
import { useAsync, useToast } from './state';

/**
 * Setting up, and watching, the mirror into a git repository.
 *
 * The point of the panel is that somebody can answer "are our skills safe if
 * this box dies?" without leaving the portal — so it shows what will be written,
 * when it last ran, and the reason if it did not.
 */
export default function GitMirrorPanel() {
  const { notify } = useToast();
  const { data, error, reload } = useAsync(() => api.get<{ mirror: GitMirror }>('/v1/admin/mirror'), []);
  const [form, setForm] = useState<null | Pick<
    GitMirror,
    'enabled' | 'owner' | 'repo' | 'branch' | 'pathPrefix'
  >>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MirrorResult | null>(null);

  const mirror = data?.mirror;
  const editing = form ?? mirror;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setBusy(true);
    try {
      await api.put('/v1/admin/mirror', {
        enabled: editing.enabled,
        owner: editing.owner,
        repo: editing.repo,
        branch: editing.branch,
        pathPrefix: editing.pathPrefix,
      });
      notify('Saved.', 'positive');
      setForm(null);
      reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'That did not work.', 'negative');
    } finally {
      setBusy(false);
    }
  }

  async function syncNow() {
    setBusy(true);
    setResult(null);
    try {
      const res = await api.post<{ result: MirrorResult }>('/v1/admin/mirror/sync');
      setResult(res.result);
      notify(
        res.result.ok
          ? res.result.commit
            ? 'Pushed.'
            : 'Already up to date.'
          : 'The push failed — the reason is below.',
        res.result.ok ? 'positive' : 'negative',
      );
      reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'That did not work.', 'negative');
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorNote message={error} testId="mirror-error" />;
  if (!mirror || !editing) return null;

  const change = (patch: Partial<typeof editing>) => setForm({ ...editing, ...patch });

  return (
    <section
      className="mt-14"
      data-testid="mirror-panel"
      data-enabled={mirror.enabled ? 'true' : 'false'}
      data-has-token={mirror.hasToken ? 'true' : 'false'}
    >
      <h2 className="t-title">A copy you can walk away with</h2>
      <p className="text-soft mt-1" style={{ maxWidth: '46rem' }}>
        Company skills are written into a git repository as they change, so they are not only in this
        server’s database. Personal skills are never sent — they belong to the person who wrote them.
      </p>

      <form onSubmit={(event) => void save(event)} className="mt-6" style={{ maxWidth: '46rem' }}>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1"
            data-testid="mirror-enabled"
            checked={editing.enabled}
            onChange={(e) => change({ enabled: e.target.checked })}
          />
          <span>
            <span style={{ fontWeight: 600 }}>Keep a git copy</span>
            <span className="t-meta block">
              {mirror.fileCount} {mirror.fileCount === 1 ? 'file' : 'files'} would be written.
            </span>
          </span>
        </label>

        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <Field label="Owner" hint="The user or organisation on GitHub.">
            <input
              className="field"
              data-testid="mirror-owner"
              value={editing.owner}
              onChange={(e) => change({ owner: e.target.value })}
              placeholder="acme"
            />
          </Field>
          <Field label="Repository">
            <input
              className="field"
              data-testid="mirror-repo"
              value={editing.repo}
              onChange={(e) => change({ repo: e.target.value })}
              placeholder="skills"
            />
          </Field>
          <Field label="Branch">
            <input
              className="field"
              data-testid="mirror-branch"
              value={editing.branch}
              onChange={(e) => change({ branch: e.target.value })}
              placeholder="main"
            />
          </Field>
          <Field label="Directory" hint="Leave empty to write to the root of the repository.">
            <input
              className="field"
              data-testid="mirror-prefix"
              value={editing.pathPrefix}
              onChange={(e) => change({ pathPrefix: e.target.value })}
              placeholder="skills"
            />
          </Field>
        </div>

        {!mirror.hasToken && (
          <p className="t-meta mt-5" data-testid="mirror-no-token" style={{ color: 'var(--caution)' }}>
            This server has no GitHub token, so nothing can be written yet. Set
            <code> SHKILLS_GITHUB_TOKEN</code> on the deployment and restart it. It is kept out of the
            database on purpose, so nobody can read it back out of the portal.
          </p>
        )}

        <div className="mt-7 flex flex-wrap items-center gap-2">
          <button className="btn btn-primary" disabled={busy} data-testid="mirror-save">
            {busy ? 'Working…' : 'Save'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            data-testid="mirror-sync"
            disabled={busy || !mirror.enabled || !mirror.hasToken}
            onClick={() => void syncNow()}
          >
            Push now
          </button>
          {mirror.enabled && mirror.owner && mirror.repo && (
            <span className="t-meta" data-testid="mirror-target">
              {mirror.owner}/{mirror.repo} · {mirror.branch}
            </span>
          )}
        </div>
      </form>

      <div className="mt-6" style={{ maxWidth: '46rem' }}>
        {mirror.lastError ? (
          <p className="t-meta" data-testid="mirror-last-error" style={{ color: 'var(--danger)' }}>
            Last run failed: {mirror.lastError}
          </p>
        ) : (
          mirror.lastRunAt && (
            <p className="t-meta" data-testid="mirror-last-run">
              Last pushed {timeAgo(mirror.lastRunAt)}
              {mirror.lastCommit ? ` · ${mirror.lastCommit.slice(0, 7)}` : ''}
            </p>
          )
        )}

        {result?.ok && (
          <p className="t-meta mt-2" data-testid="mirror-result">
            {result.commit
              ? `${result.added.length} added, ${result.updated.length} updated, ${result.removed.length} removed.`
              : 'Nothing to do — the repository already matches.'}
          </p>
        )}
      </div>
    </section>
  );
}
