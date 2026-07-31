import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, canCurate, type Collection } from '../api';
import { Chip, Empty, ErrorNote, Field, Modal, Spinner } from '../components';
import { useAsync, useSession, useToast } from '../state';

export default function Collections() {
  const { user } = useSession();
  const { notify } = useToast();
  const { data, error, loading, reload } = useAsync(
    () => api.get<{ collections: Collection[] }>('/v1/collections'),
    [],
  );
  const [creating, setCreating] = useState(false);

  async function toggle(collection: Collection) {
    try {
      if (collection.subscribed) {
        await api.del(`/v1/subscriptions/collection/${collection.slug}`);
        notify(`Removed ${collection.name}.`);
      } else {
        await api.post('/v1/subscriptions', { kind: 'collection', slug: collection.slug });
        notify(`Added ${collection.name}. Arrives on your next Claude session.`, 'positive');
      }
      reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'That did not work.', 'negative');
    }
  }

  const collections = data?.collections ?? [];

  return (
    <div className="pt-16" data-testid="collections-page">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <h1 className="t-display rise">Collections</h1>
          <p
            className="t-body-lg mt-4 rise"
            style={{ maxWidth: '46ch', '--i': 1 } as React.CSSProperties}
          >
            A whole role’s worth of skills in one decision. Join one and everything in it installs
            itself — including whatever gets added later.
          </p>
        </div>
        {canCurate(user) && (
          <button className="btn btn-primary" data-testid="new-collection" onClick={() => setCreating(true)}>
            New collection
          </button>
        )}
      </div>

      {error && <div className="mt-8"><ErrorNote message={error} /></div>}
      {loading && <Spinner label="Loading collections" />}
      {!loading && collections.length === 0 && (
        <Empty
          testId="collections-empty"
          title="No collections yet."
          detail="Group related skills so people join once."
        />
      )}

      <div className="mt-12 grid gap-4 sm:grid-cols-2" data-testid="collections-grid">
        {collections.map((collection, index) => (
          <article
            key={collection.id}
            data-testid={`collection-card-${collection.slug}`}
            className="card card-interactive rise flex flex-col p-7"
            style={{ '--i': Math.min(index, 8) } as React.CSSProperties}
          >
            <Link
              to={`/collections/${collection.slug}`}
              className="flex-1"
              data-testid={`collection-link-${collection.slug}`}
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="t-subtitle">{collection.name}</h2>
                {collection.isDefault && <Chip testId={`collection-default-${collection.slug}`}>everyone</Chip>}
              </div>
              <p className="mt-2 text-soft" style={{ fontSize: '0.9375rem' }}>
                {collection.description || 'No description yet.'}
              </p>
              <p className="t-meta mt-4 tnum" data-testid={`collection-count-${collection.slug}`}>
                {collection.skillCount} {collection.skillCount === 1 ? 'skill' : 'skills'}
              </p>
            </Link>

            <div className="mt-5">
              {collection.locked ? (
                <span className="t-meta" data-testid={`collection-locked-${collection.slug}`}>
                  Installed for everyone automatically
                </span>
              ) : (
                <button
                  className={collection.subscribed ? 'btn btn-secondary' : 'btn btn-primary'}
                  onClick={() => void toggle(collection)}
                  data-testid={`collection-join-${collection.slug}`}
                  data-subscribed={collection.subscribed ? 'true' : 'false'}
                  style={{ fontSize: '0.85rem', padding: '0.42rem 0.95rem' }}
                >
                  {collection.subscribed ? 'Joined' : 'Join'}
                </button>
              )}
            </div>
          </article>
        ))}
      </div>

      <CreateCollection
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          reload();
        }}
      />
    </div>
  );
}

function CreateCollection({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { notify } = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/v1/collections', {
        slug: name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, ''),
        name,
        description,
        isDefault,
      });
      notify('Collection created.', 'positive');
      setName('');
      setDescription('');
      setIsDefault(false);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create it.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New collection" testId="new-collection-dialog">
      <form onSubmit={(event) => void submit(event)} className="space-y-5">
        <Field label="Name">
          <input
            className="field"
            data-testid="collection-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Backend Engineering"
            required
            autoFocus
          />
        </Field>
        <Field label="Description">
          <input
            className="field"
            data-testid="collection-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What every backend engineer is expected to follow."
          />
        </Field>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1"
            data-testid="collection-is-default"
            checked={isDefault}
            onChange={(event) => setIsDefault(event.target.checked)}
          />
          <span>
            <span style={{ fontWeight: 600 }}>Install for everyone</span>
            <span className="t-meta block">
              Every person in the company gets these, and cannot opt out. Use it for the handful of
              things that are genuinely not optional.
            </span>
          </span>
        </label>
        {error && <ErrorNote message={error} testId="collection-error" />}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn btn-secondary" data-testid="collection-cancel" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" data-testid="collection-create" disabled={busy || !name.trim()}>
            Create
          </button>
        </div>
      </form>
    </Modal>
  );
}
