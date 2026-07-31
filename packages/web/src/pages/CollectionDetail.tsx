import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, canCurate, type SkillSummary } from '../api';
import { Chip, Empty, ErrorNote, Modal, Spinner } from '../components';
import { useAsync, useSession, useToast } from '../state';

interface CollectionDetailData {
  id: number;
  slug: string;
  name: string;
  description: string;
  isDefault: boolean;
  subscribed: boolean;
  locked: boolean;
  skills: {
    id: number;
    slug: string;
    title: string;
    description: string;
    category: string;
    version: number;
    published: boolean;
    archived: boolean;
  }[];
}

export default function CollectionDetail() {
  const { slug = '' } = useParams();
  const { user } = useSession();
  const { notify } = useToast();
  const [adding, setAdding] = useState(false);

  const { data, error, loading, reload } = useAsync(
    () => api.get<{ collection: CollectionDetailData }>(`/v1/collections/${slug}`),
    [slug],
  );

  if (loading) return <Spinner label="Loading collection" />;
  if (error) return <div className="pt-20"><ErrorNote message={error} /></div>;
  if (!data) return null;

  const collection = data.collection;

  async function toggleJoin() {
    try {
      if (collection.subscribed) {
        await api.del(`/v1/subscriptions/collection/${collection.slug}`);
        notify('Left the collection.');
      } else {
        await api.post('/v1/subscriptions', { kind: 'collection', slug: collection.slug });
        notify('Joined. Everything in it arrives on your next Claude session.', 'positive');
      }
      reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'That did not work.', 'negative');
    }
  }

  async function removeSkill(skillSlug: string) {
    try {
      await api.del(`/v1/collections/${collection.slug}/skills/${skillSlug}`);
      notify(`Removed ${skillSlug} from ${collection.name}.`);
      reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'That did not work.', 'negative');
    }
  }

  return (
    <div className="pt-12">
      <Link to="/collections" className="t-meta">
        ← All collections
      </Link>

      <header className="mt-6 flex flex-wrap items-start justify-between gap-6 rise">
        <div style={{ maxWidth: '44rem' }}>
          {collection.isDefault && <Chip>installed for everyone</Chip>}
          <h1 className="t-display mt-3">{collection.name}</h1>
          <p className="t-body-lg mt-4">{collection.description}</p>
          <p className="t-meta mt-4 tnum">
            {collection.skills.length} {collection.skills.length === 1 ? 'skill' : 'skills'}
          </p>
        </div>
        <div className="flex gap-2">
          {!collection.locked && (
            <button
              className={collection.subscribed ? 'btn btn-secondary' : 'btn btn-primary'}
              onClick={() => void toggleJoin()}
            >
              {collection.subscribed ? 'Joined' : 'Join'}
            </button>
          )}
          {canCurate(user) && (
            <button className="btn btn-secondary" onClick={() => setAdding(true)}>
              Add a skill
            </button>
          )}
        </div>
      </header>

      {collection.skills.length === 0 && (
        <Empty
          title="Nothing in here yet."
          detail="Add the skills that belong together, and people join once instead of many times."
        />
      )}

      <div className="mt-12 space-y-3" style={{ maxWidth: '52rem' }}>
        {collection.skills.map((skill, index) => (
          <div
            key={skill.id}
            className="card rise flex items-start gap-5 p-6"
            style={{ '--i': Math.min(index, 8) } as React.CSSProperties}
          >
            <Link to={`/skills/${skill.slug}`} className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="t-subtitle">{skill.title}</h2>
                {!skill.published && <Chip>not published</Chip>}
                {skill.archived && <Chip>archived</Chip>}
              </div>
              <p className="mt-1.5 text-soft" style={{ fontSize: '0.9375rem' }}>
                {skill.description}
              </p>
            </Link>
            {canCurate(user) && (
              <button className="btn btn-danger" onClick={() => void removeSkill(skill.slug)}>
                Remove
              </button>
            )}
          </div>
        ))}
      </div>

      <AddSkill
        open={adding}
        collectionSlug={collection.slug}
        alreadyIn={new Set(collection.skills.map((skill) => skill.slug))}
        onClose={() => setAdding(false)}
        onAdded={() => {
          setAdding(false);
          reload();
        }}
      />
    </div>
  );
}

function AddSkill({
  open,
  collectionSlug,
  alreadyIn,
  onClose,
  onAdded,
}: {
  open: boolean;
  collectionSlug: string;
  alreadyIn: Set<string>;
  onClose: () => void;
  onAdded: () => void;
}) {
  const { notify } = useToast();
  const [query, setQuery] = useState('');
  const { data } = useAsync(() => api.get<{ skills: SkillSummary[] }>('/v1/skills'), [open]);

  const candidates = (data?.skills ?? []).filter(
    (skill) =>
      !alreadyIn.has(skill.slug) &&
      skill.published &&
      !skill.archived &&
      `${skill.slug} ${skill.title}`.toLowerCase().includes(query.toLowerCase().trim()),
  );

  async function add(slug: string) {
    try {
      await api.put(`/v1/collections/${collectionSlug}/skills/${slug}`);
      notify(`Added ${slug}.`, 'positive');
      onAdded();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'That did not work.', 'negative');
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add a skill">
      <input
        className="field"
        placeholder="Search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        autoFocus
      />
      <div className="mt-4 max-h-80 space-y-1 overflow-y-auto">
        {candidates.length === 0 && <p className="t-meta py-6 text-center">Nothing left to add.</p>}
        {candidates.map((skill) => (
          <button
            key={skill.id}
            className="w-full rounded-xl px-4 py-3 text-left"
            style={{ transition: 'background 0.18s var(--ease)' }}
            onMouseEnter={(event) => (event.currentTarget.style.background = 'var(--surface-sunken)')}
            onMouseLeave={(event) => (event.currentTarget.style.background = 'transparent')}
            onClick={() => void add(skill.slug)}
          >
            <span style={{ fontWeight: 600 }}>{skill.title}</span>
            <span className="t-meta block">{skill.slug}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
