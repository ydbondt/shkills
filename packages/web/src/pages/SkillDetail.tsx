import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, canCurate, type SkillDetail as Detail } from '../api';
import {
  Chip,
  CopyButton,
  ErrorNote,
  Markdown,
  Modal,
  Spinner,
  StatusBadge,
  timeAgo,
} from '../components';
import { useAsync, useSession, useToast } from '../state';

export default function SkillDetail() {
  const { slug = '' } = useParams();
  const { user } = useSession();
  const { notify } = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'skill' | 'file' | 'history'>('skill');
  const [confirmArchive, setConfirmArchive] = useState(false);

  const { data, error, loading, reload } = useAsync(
    () => api.get<{ skill: Detail }>(`/v1/skills/${slug}`),
    [slug],
  );

  if (loading) return <Spinner label="Loading skill" />;
  if (error) return <div className="pt-20"><ErrorNote message={error} /></div>;
  if (!data) return null;

  const skill = data.skill;
  const live = skill.published;

  async function toggleSubscription() {
    try {
      if (skill.subscribed) {
        await api.del(`/v1/subscriptions/skill/${skill.slug}`);
        notify('Removed from your machines.');
      } else {
        await api.post('/v1/subscriptions', { kind: 'skill', slug: skill.slug });
        notify('Added. It arrives on your next Claude session.', 'positive');
      }
      reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'That did not work.', 'negative');
    }
  }

  async function archive() {
    try {
      await api.del(`/v1/skills/${skill.slug}`);
      notify('Archived. It will be removed from every machine on the next sync.');
      setConfirmArchive(false);
      navigate('/');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'That did not work.', 'negative');
    }
  }

  async function restore() {
    await api.post(`/v1/skills/${skill.slug}/restore`);
    notify('Restored.', 'positive');
    reload();
  }

  async function rollback(versionId: number, version: number) {
    try {
      await api.post(`/v1/skills/versions/${versionId}/rollback`);
      notify(`Rolled back to v${version}.`, 'positive');
      reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'That did not work.', 'negative');
    }
  }

  return (
    <div className="pt-12">
      <Link to="/" className="t-meta">
        ← All skills
      </Link>

      <header className="mt-6 flex flex-wrap items-start justify-between gap-6 rise">
        <div style={{ maxWidth: '44rem' }}>
          <div className="flex flex-wrap items-center gap-2">
            <Chip>{live?.category ?? 'unpublished'}</Chip>
            {skill.archived && <Chip>archived</Chip>}
            {live && <StatusBadge status="approved" />}
          </div>
          <h1 className="t-display mt-4">{live?.title ?? skill.slug}</h1>
          <p className="t-body-lg mt-4">{live?.description}</p>
          <p className="t-meta mt-5">
            <code style={{ fontFamily: 'var(--font-mono)' }}>{skill.slug}</code> · kept by{' '}
            {skill.owner} · updated {timeAgo(skill.updatedAt)}
            {live && ` · v${live.version}`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {live && !skill.archived && (
            <button
              className={skill.subscribed ? 'btn btn-secondary' : 'btn btn-primary'}
              onClick={() => void toggleSubscription()}
            >
              {skill.subscribed ? 'Installed' : 'Add to my Claude'}
            </button>
          )}
          <button className="btn btn-secondary" onClick={() => navigate(`/skills/${skill.slug}/edit`)}>
            {canCurate(user) ? 'Edit' : 'Propose a change'}
          </button>
          {canCurate(user) &&
            (skill.archived ? (
              <button className="btn btn-quiet" onClick={() => void restore()}>
                Restore
              </button>
            ) : (
              <button className="btn btn-danger" onClick={() => setConfirmArchive(true)}>
                Archive
              </button>
            ))}
        </div>
      </header>

      {skill.collections.length > 0 && (
        <p className="t-meta mt-6">
          In{' '}
          {skill.collections.map((collection, index) => (
            <span key={collection.slug}>
              {index > 0 && ', '}
              <Link to={`/collections/${collection.slug}`} className="accent">
                {collection.name}
              </Link>
            </span>
          ))}
        </p>
      )}

      <nav className="mt-10 flex gap-1 border-b" style={{ borderColor: 'var(--line)' }}>
        {(
          [
            ['skill', 'The skill'],
            ['file', 'What Claude reads'],
            ['history', `History (${skill.versions.length})`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className="px-4 py-3"
            style={{
              fontSize: '0.9375rem',
              fontWeight: 600,
              color: tab === key ? 'var(--ink)' : 'var(--ink-faint)',
              boxShadow: tab === key ? 'inset 0 -2px 0 var(--ink)' : 'none',
              transition: 'color 0.2s var(--ease)',
            }}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="py-10">
        {tab === 'skill' &&
          (live ? (
            <Markdown source={live.body} />
          ) : (
            <p className="t-body-lg">
              Nothing is published yet. The first version is still in review.
            </p>
          ))}

        {tab === 'file' && live && (
          <div style={{ maxWidth: '52rem' }}>
            <div className="mb-4 flex items-center justify-between gap-4">
              <p className="t-meta">
                Written to <code>~/.claude/skills/{skill.slug}/SKILL.md</code> on every machine that
                has this skill.
              </p>
              <CopyButton text={live.renderedMd} />
            </div>
            <pre className="terminal" style={{ whiteSpace: 'pre-wrap' }}>
              {live.renderedMd}
            </pre>
          </div>
        )}

        {tab === 'history' && (
          <ol className="space-y-3" style={{ maxWidth: '52rem' }}>
            {skill.versions.map((version, index) => (
              <li
                key={version.id}
                className="card rise p-6"
                style={{ '--i': Math.min(index, 8) } as React.CSSProperties}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="t-subtitle tnum">v{version.version}</span>
                    <StatusBadge status={version.status} />
                  </div>
                  <span className="t-meta">
                    {version.author} · {timeAgo(version.createdAt)}
                  </span>
                </div>

                {version.changeNote && <p className="mt-3 text-soft">{version.changeNote}</p>}

                {version.reviewNote && (
                  <p className="t-meta mt-2">
                    {version.status === 'rejected' ? 'Declined' : 'Reviewed'} by {version.reviewer}:{' '}
                    {version.reviewNote}
                  </p>
                )}

                {canCurate(user) &&
                  version.status === 'superseded' &&
                  !skill.archived && (
                    <button
                      className="btn btn-quiet mt-3"
                      style={{ paddingLeft: 0 }}
                      onClick={() => void rollback(version.id, version.version)}
                    >
                      Roll back to this version
                    </button>
                  )}
              </li>
            ))}
          </ol>
        )}
      </div>

      <Modal open={confirmArchive} onClose={() => setConfirmArchive(false)} title="Archive this skill?">
        <p className="text-soft">
          It disappears from every machine that has it, at the start of their next Claude session.
          The history stays here, and a curator can restore it.
        </p>
        <div className="mt-7 flex justify-end gap-2">
          <button className="btn btn-secondary" onClick={() => setConfirmArchive(false)}>
            Keep it
          </button>
          <button className="btn btn-primary" onClick={() => void archive()}>
            Archive
          </button>
        </div>
      </Modal>
    </div>
  );
}
