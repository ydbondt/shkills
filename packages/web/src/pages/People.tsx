import { useState } from 'react';
import { api, type Role, type Stats } from '../api';
import { CopyButton, ErrorNote, Modal, Spinner, timeAgo } from '../components';
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

interface PasswordRequest {
  id: number;
  userId: number;
  email: string;
  name: string;
  createdAt: string;
}

interface HandOver {
  url: string;
  email: string;
  expiresInMinutes: number;
}

export default function People() {
  const { user } = useSession();
  const { notify } = useToast();
  const isAdmin = user?.role === 'admin';
  const people = useAsync(() => api.get<{ users: Person[] }>('/v1/admin/users'), []);
  const stats = useAsync(() => api.get<{ stats: Stats }>('/v1/admin/stats'), []);
  const audit = useAsync(() => api.get<{ events: AuditEvent[] }>('/v1/admin/audit?limit=40'), []);
  const waiting = useAsync(
    () =>
      isAdmin
        ? api.get<{ requests: PasswordRequest[] }>('/v1/admin/password-requests')
        : Promise.resolve({ requests: [] }),
    [isAdmin],
  );
  const [handOver, setHandOver] = useState<HandOver | null>(null);

  async function setRole(person: Person, role: Role) {
    try {
      await api.patch(`/v1/admin/users/${person.id}`, { role });
      notify(`${person.name} is now a ${role}.`, 'positive');
      people.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'That did not work.', 'negative');
    }
  }

  /**
   * On a deployment with no mail server this is the delivery mechanism: the
   * link is shown once, to an administrator, to be handed over deliberately.
   */
  async function issueLink(person: { id: number; name: string }) {
    try {
      setHandOver(await api.post<HandOver>(`/v1/admin/users/${person.id}/reset-link`, {}));
      waiting.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'That did not work.', 'negative');
    }
  }

  const s = stats.data?.stats;
  const requests = waiting.data?.requests ?? [];

  return (
    <div className="pt-16" data-testid="people-page">
      <h1 className="t-display rise">People</h1>

      {s && (
        <div
          className="mt-10 grid gap-8 rise sm:grid-cols-2 lg:grid-cols-4"
          data-testid="stats"
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
            <div key={label} data-testid={`stat-${label.replace(/\s+/g, '-')}`}>
              <p className="t-display tnum" style={{ fontSize: '2.75rem' }}>
                {value}
              </p>
              <p className="t-meta mt-1">{label}</p>
            </div>
          ))}
        </div>
      )}

      {requests.length > 0 && (
        <section className="mt-14" data-testid="password-requests">
          <h2 className="t-title">Waiting to get back in</h2>
          <p className="text-soft mt-1" style={{ maxWidth: '46rem' }}>
            This Shkills has no mail server, so a link has to be handed over by a person. Give it to
            them the way you would give them a password — anyone holding it can set theirs.
          </p>
          <div className="mt-6 space-y-1" style={{ maxWidth: '54rem' }}>
            {requests.map((req) => (
              <div
                key={req.id}
                data-testid={`password-request-${req.email}`}
                className="flex flex-wrap items-center justify-between gap-4 py-4"
                style={{ borderBottom: '1px solid var(--line)' }}
              >
                <div>
                  <p style={{ fontWeight: 600 }}>{req.name}</p>
                  <p className="t-meta">
                    {req.email} · asked {timeAgo(req.createdAt)}
                  </p>
                </div>
                <button
                  className="btn btn-primary"
                  data-testid={`password-link-${req.email}`}
                  onClick={() => void issueLink({ id: req.userId, name: req.name })}
                >
                  Make a link
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <hr className="rule my-14" />

      {people.loading && <Spinner label="Loading people" />}
      {people.error && <ErrorNote message={people.error} />}

      <div className="space-y-1" style={{ maxWidth: '54rem' }} data-testid="people">
        {(people.data?.users ?? []).map((person) => (
          <div
            key={person.id}
            data-testid={`person-${person.email}`}
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

            {/* Wraps rather than pushing the row wider: at phone width the
                button and the role picker do not fit on one line. */}
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
              {isAdmin && (
                <button
                  className="btn btn-quiet"
                  data-testid={`person-reset-${person.email}`}
                  onClick={() => void issueLink(person)}
                  title={`Make a single-use link so ${person.name} can set a new password`}
                >
                  Reset password
                </button>
              )}
              {user?.role === 'admin' ? (
                <select
                  className="field"
                  data-testid={`person-role-${person.email}`}
                  data-role={person.role}
                  data-editable="true"
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
                <span
                  className="chip chip-static"
                  data-testid={`person-role-${person.email}`}
                  data-role={person.role}
                  data-editable="false"
                >
                  {person.role}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Shown once, on purpose: it is not stored anywhere it can be read back. */}
      <Modal
        open={handOver !== null}
        onClose={() => setHandOver(null)}
        title="Hand this over"
        testId="password-link-modal"
      >
        <p className="text-soft" style={{ lineHeight: 1.6 }}>
          A single-use link for <strong>{handOver?.email}</strong>. It stops working in{' '}
          {handOver?.expiresInMinutes} minutes, or as soon as it is used. You will not be shown it
          again.
        </p>
        {/* `.terminal` is `white-space: pre` so commands never wrap; a link is
            the opposite case — it has to be readable in one look to be checked
            before it is handed over. */}
        <div
          className="terminal mt-5"
          data-testid="password-link-url"
          style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
        >
          {handOver?.url}
        </div>
        <div className="mt-6 flex gap-3">
          <CopyButton text={handOver?.url ?? ''} label="Copy the link" testId="password-link-copy" />
          <button
            className="btn btn-quiet"
            onClick={() => setHandOver(null)}
            data-testid="password-link-done"
          >
            Done
          </button>
        </div>
      </Modal>

      <hr className="rule my-14" />

      <section className="pb-10">
        <h2 className="t-title">Recent activity</h2>
        <p className="text-soft mt-1">Every change to a skill, a collection or a person.</p>

        {audit.loading && <Spinner label="Loading activity" />}
        <div className="mt-8 space-y-3" style={{ maxWidth: '54rem' }} data-testid="audit-log">
          {(audit.data?.events ?? []).map((event) => (
            <div
              key={event.id}
              data-testid={`audit-event-${event.action}`}
              className="flex flex-wrap items-baseline gap-x-4 gap-y-1"
            >
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
    'auth.reset_requested': 'asked for a way back into the account',
    'auth.reset_issued': 'made a password link for',
    'auth.password_reset': 'recovered their password',
  };
  return phrases[action] ?? action;
}
