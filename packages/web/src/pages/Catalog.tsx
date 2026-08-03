import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, canCurate, type SkillSummary, type Stats } from '../api';
import { Chip, Empty, ErrorNote, Spinner, timeAgo } from '../components';
import { useAsync, useSession, useToast } from '../state';

interface Facets {
  categories: string[];
  audiences: string[];
}

export default function Catalog() {
  const { user } = useSession();
  const { notify } = useToast();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [mineOnly, setMineOnly] = useState(false);
  const [personalOnly, setPersonalOnly] = useState(false);

  const skills = useAsync(() => api.get<{ skills: SkillSummary[] }>('/v1/skills'), []);
  const facets = useAsync(() => api.get<Facets>('/v1/skills/facets'), []);
  const stats = useAsync(() => api.get<{ stats: Stats }>('/v1/admin/stats'), []);

  const visible = useMemo(() => {
    const all = skills.data?.skills ?? [];
    const needle = query.toLowerCase().trim();
    return all.filter((skill) => {
      if (category && skill.category !== category) return false;
      // A personal skill is on your machines without being subscribed to, so
      // "Mine" has to mean both, or your own drafts would fall out of it.
      if (mineOnly && !skill.subscribed && skill.visibility !== 'personal') return false;
      if (personalOnly && skill.visibility !== 'personal') return false;
      if (!needle) return true;
      return `${skill.slug} ${skill.title} ${skill.description} ${skill.tags.join(' ')}`
        .toLowerCase()
        .includes(needle);
    });
  }, [skills.data, query, category, mineOnly, personalOnly]);

  async function toggle(skill: SkillSummary) {
    try {
      if (skill.subscribed) {
        await api.del(`/v1/subscriptions/skill/${skill.slug}`);
        notify(`Removed ${skill.slug}.`);
      } else {
        await api.post('/v1/subscriptions', { kind: 'skill', slug: skill.slug });
        notify(`Added ${skill.slug}. It arrives on your next Claude session.`, 'positive');
      }
      skills.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'That did not work.', 'negative');
    }
  }

  return (
    <div data-testid="catalog-page">
      <section className="pt-16 pb-10">
        <h1 className="t-display rise" style={{ maxWidth: '18ch' }}>
          The skills your company runs on.
        </h1>
        {stats.data && (
          <p
            className="t-body-lg mt-5 rise"
            data-testid="catalog-stats"
            style={{ '--i': 1 } as React.CSSProperties}
          >
            {stats.data.stats.skills} live · {stats.data.stats.collections} collections ·{' '}
            {stats.data.stats.linkedDevices}{' '}
            {stats.data.stats.linkedDevices === 1 ? 'machine' : 'machines'} in sync
          </p>
        )}
      </section>

      <div
        className="sticky top-14 z-30 -mx-6 mb-8 px-6 py-4 rise"
        style={{
          background: 'color-mix(in srgb, var(--surface) 88%, transparent)',
          backdropFilter: 'saturate(180%) blur(16px)',
          '--i': 2,
        } as React.CSSProperties}
      >
        <div className="flex flex-wrap items-center gap-3">
          <input
            className="field"
            data-testid="catalog-search"
            style={{ maxWidth: '22rem' }}
            placeholder="Search skills"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search skills"
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip
              testId="filter-all"
              active={!category && !mineOnly && !personalOnly}
              onClick={() => {
                setCategory(null);
                setMineOnly(false);
                setPersonalOnly(false);
              }}
            >
              All
            </Chip>
            <Chip testId="filter-mine" active={mineOnly} onClick={() => setMineOnly((value) => !value)}>
              Mine
            </Chip>
            <Chip
              testId="filter-personal"
              active={personalOnly}
              onClick={() => setPersonalOnly((value) => !value)}
            >
              Only mine to see
            </Chip>
            {(facets.data?.categories ?? []).map((name) => (
              <Chip
                key={name}
                testId={`filter-category-${name}`}
                active={category === name}
                onClick={() => setCategory(category === name ? null : name)}
              >
                {name}
              </Chip>
            ))}
          </div>
        </div>
      </div>

      {skills.error && <ErrorNote message={skills.error} />}
      {skills.loading && <Spinner label="Loading skills" />}

      {!skills.loading && visible.length === 0 && (
        <Empty
          testId="catalog-empty"
          title={query || category || mineOnly ? 'Nothing matches that.' : 'No skills yet.'}
          detail={
            query || category || mineOnly
              ? 'Try a different search, or clear the filters.'
              : 'Write the first one. It takes about five minutes.'
          }
          action={
            <button className="btn btn-primary" onClick={() => navigate('/skills/new')}>
              Propose a skill
            </button>
          }
        />
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="catalog-grid">
        {visible.map((skill, index) => (
          <article
            key={skill.id}
            data-testid={`skill-card-${skill.slug}`}
            data-visibility={skill.visibility}
            className="card card-interactive rise flex flex-col p-6"
            style={{ '--i': Math.min(index, 8) } as React.CSSProperties}
          >
            <Link to={`/skills/${skill.slug}`} className="flex-1" data-testid={`skill-link-${skill.slug}`}>
              <div className="flex items-start justify-between gap-3">
                <h2 className="t-subtitle">{skill.title}</h2>
                {skill.pendingCount > 0 && canCurate(user) && (
                  <span
                    className="t-meta shrink-0"
                    data-testid={`skill-in-review-${skill.slug}`}
                    style={{ color: 'var(--caution)', fontWeight: 700 }}
                  >
                    {skill.pendingCount} in review
                  </span>
                )}
              </div>
              <p
                className="mt-2 text-soft"
                style={{
                  fontSize: '0.9375rem',
                  display: '-webkit-box',
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {skill.description}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-1.5">
                <Chip testId={`skill-category-${skill.slug}`}>{skill.category}</Chip>
                {skill.visibility === 'personal' && (
                  <Chip testId={`skill-personal-${skill.slug}`}>only you can see this</Chip>
                )}
                {skill.shareStatus === 'pending' && (
                  <Chip testId={`skill-share-pending-${skill.slug}`}>waiting to be shared</Chip>
                )}
                {!skill.published && <Chip testId={`skill-unpublished-${skill.slug}`}>not published</Chip>}
                {skill.archived && <Chip testId={`skill-archived-${skill.slug}`}>archived</Chip>}
              </div>
            </Link>

            <div className="mt-5 flex items-center justify-between gap-2">
              <span className="t-meta tnum" data-testid={`skill-version-${skill.slug}`}>
                {skill.published ? `v${skill.version}` : 'draft'} · {timeAgo(skill.updatedAt)}
              </span>
              {/* Your own skill is on your machines already; there is nothing
                  to subscribe to. */}
              {skill.visibility === 'personal' && !skill.archived && (
                <span className="t-meta" data-testid={`skill-yours-${skill.slug}`}>
                  on your machines
                </span>
              )}
              {skill.visibility === 'shared' && skill.published && !skill.archived && (
                <button
                  className={skill.subscribed ? 'btn btn-secondary' : 'btn btn-primary'}
                  onClick={() => void toggle(skill)}
                  data-testid={`skill-subscribe-${skill.slug}`}
                  data-subscribed={skill.subscribed ? 'true' : 'false'}
                  style={{ fontSize: '0.85rem', padding: '0.42rem 0.95rem' }}
                >
                  {skill.subscribed ? 'Installed' : 'Add'}
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
