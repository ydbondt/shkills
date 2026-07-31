import { api, type Role, type Stats } from '../api';
import { ErrorNote, Spinner, timeAgo } from '../components';
import { useAsync, useSession, useToast } from '../state';

interface Person {
  id: number;
  email: string;
  name: string;
  role: Role;
  department: string;
  active: number;
  created_at: string;
  devices: number;
  last_sync: string | null;
}

interface AuditEvent {
  id: number;
  action: string;
  entity: string;
  entity_id: number | null;
  detail: string;
  created_at: string;
  actor: string | null;
}

export default function People() {
  const { user } = useSession();
  const { notify } = useToast();
  const people = useAsync(() => api.get<{ users: Person[] }>('/v1/admin/users'), []);
  const stats = useAsync(() => api.get<{ stats: Stats }>('/v1/admin/stats'), []);
  const audit = useAsync(() => api.get<{ events: AuditEvent[] }>('/v1/admin/audit?limit=40'), []);

  async function setRole(person: Person, role: Role) {
    try {
      await api.patch(`/v1/admin/users/${person.id}`, { role });
      notify(`${person.name} is now a ${role}.`, 'positive');
      people.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'That did not work.', 'negative');
    }
  }

  const s = stats.data?.stats;

  return (
    <div className="pt-16">
      <h1 className="t-display rise">People</h1>

      {s && (
        <div
          className="mt-10 grid gap-8 rise sm:grid-cols-2 lg:grid-cols-4"
          style={{ '--i': 1 } as React.CSSProperties}
        >
          {(
            [
              [s.people, 'people'],
              [s.linkedDevices, 'machines linked'],
              [s.syncedLastDay, 'synced today'],
              [s.pending, 'waiting on review'],
            ] as const
          ).map(([value, label]) => (
            <div key={label}>
              <p className="t-display tnum" style={{ fontSize: '2.75rem' }}>
                {value}
              </p>
              <p className="t-meta mt-1">{label}</p>
            </div>
          ))}
        </div>
      )}

      <hr className="rule my-14" />

      {people.loading && <Spinner label="Loading people" />}
      {people.error && <ErrorNote message={people.error} />}

      <div className="space-y-1" style={{ maxWidth: '54rem' }}>
        {(people.data?.users ?? []).map((person) => (
          <div
            key={person.id}
            className="flex flex-wrap items-center justify-between gap-4 py-4"
            style={{ borderBottom: '1px solid var(--line)' }}
          >
            <div>
              <p style={{ fontWeight: 600 }}>
                {person.name}
                {person.id === user?.id && <span className="t-meta"> · you</span>}
              </p>
              <p className="t-meta">
                {person.email} · {person.department} · {person.devices}{' '}
                {person.devices === 1 ? 'machine' : 'machines'}
                {person.last_sync ? ` · synced ${timeAgo(person.last_sync)}` : ''}
              </p>
            </div>

            {user?.role === 'admin' ? (
              <select
                className="field"
                style={{ width: 'auto', padding: '0.4rem 0.7rem', fontSize: '0.875rem' }}
                value={person.role}
                onChange={(event) => void setRole(person, event.target.value as Role)}
                aria-label={`Role for ${person.name}`}
              >
                <option value="member">Member — can propose</option>
                <option value="curator">Curator — can approve</option>
                <option value="admin">Admin — can manage people</option>
              </select>
            ) : (
              <span className="chip chip-static">{person.role}</span>
            )}
          </div>
        ))}
      </div>

      <hr className="rule my-14" />

      <section className="pb-10">
        <h2 className="t-title">Recent activity</h2>
        <p className="text-soft mt-1">Every change to a skill, a collection or a person.</p>

        {audit.loading && <Spinner label="Loading activity" />}
        <div className="mt-8 space-y-3" style={{ maxWidth: '54rem' }}>
          {(audit.data?.events ?? []).map((event) => (
            <div key={event.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="t-meta tnum" style={{ minWidth: '5rem' }}>
                {timeAgo(event.created_at)}
              </span>
              <span style={{ fontSize: '0.9375rem' }}>
                <strong style={{ fontWeight: 600 }}>{event.actor ?? 'someone'}</strong>{' '}
                <span className="text-soft">{describe(event.action)}</span>{' '}
                {event.detail && <code style={{ fontSize: '0.85em' }}>{event.detail}</code>}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function describe(action: string): string {
  const phrases: Record<string, string> = {
    'skill.propose': 'proposed',
    'skill.publish': 'published',
    'skill.approve': 'approved',
    'skill.reject': 'declined',
    'skill.archive': 'archived',
    'skill.restore': 'restored',
    'skill.rollback': 'rolled back',
    'skill.delete': 'deleted',
    'collection.create': 'created the collection',
    'collection.update': 'updated the collection',
    'collection.delete': 'deleted the collection',
    'collection.add_skill': 'added to a collection',
    'collection.remove_skill': 'removed from a collection',
    'device.approve': 'linked a machine',
    'device.revoke': 'revoked a machine',
    'user.create': 'added',
    'user.update': 'changed the role of',
    'auth.register': 'joined',
    'auth.login': 'signed in',
    'auth.password_change': 'changed their password',
  };
  return phrases[action] ?? action;
}
