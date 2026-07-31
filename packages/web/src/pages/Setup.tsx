import { api } from '../api';
import { CopyButton, Empty, ErrorNote, Spinner, timeAgo } from '../components';
import { useAsync, useSession, useToast } from '../state';

interface DeviceToken {
  id: number;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  last_sync_at: string | null;
  revoked_at: string | null;
}

interface MySkills {
  collections: { slug: string; name: string; isDefault: boolean }[];
  skills: { slug: string; title: string; category: string; version: number; sources: string[] }[];
}

export default function Setup() {
  const { user } = useSession();
  const { notify } = useToast();
  const origin = window.location.origin;

  const tokens = useAsync(() => api.get<{ tokens: DeviceToken[] }>('/v1/tokens'), []);
  const mine = useAsync(() => api.get<MySkills>('/v1/subscriptions'), []);

  async function revoke(id: number) {
    try {
      await api.del(`/v1/tokens/${id}`);
      notify('That machine can no longer sync.');
      tokens.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'That did not work.', 'negative');
    }
  }

  const active = (tokens.data?.tokens ?? []).filter((token) => !token.revoked_at);
  const installCommand = `curl -fsSL ${origin}/install.sh | sh`;

  return (
    <div className="pt-16" data-testid="setup-page">
      <h1 className="t-display rise" style={{ maxWidth: '16ch' }}>
        Set it up once.
      </h1>
      <p className="t-body-lg mt-5 rise" style={{ maxWidth: '48ch', '--i': 1 } as React.CSSProperties}>
        One command on each machine. After that, every Claude session you start picks up the
        current skills on its own — there is no second step and nothing to remember.
      </p>

      <section className="mt-16 rise" style={{ '--i': 2 } as React.CSSProperties}>
        <div className="flex items-baseline gap-4">
          <span className="t-hero text-faint" style={{ fontSize: '3rem', lineHeight: 1 }}>
            1
          </span>
          <div className="flex-1">
            <h2 className="t-title">Install</h2>
            <p className="text-soft mt-1">Paste this into a terminal. It needs Node 20 or newer.</p>
          </div>
        </div>
        {/* The step number's indent and the command's minimum width are both
            dropped on a phone — together they were wider than the screen. */}
        <div className="mt-5 flex flex-wrap items-center gap-3 sm:pl-[4.4rem]">
          <code
            className="terminal min-w-0"
            data-testid="install-command"
            style={{ maxWidth: '34rem', flex: '1 1 auto' }}
          >
            {installCommand}
          </code>
          <CopyButton text={installCommand} label="Copy command" testId="copy-install-command" />
        </div>
      </section>

      <section className="mt-14 rise" style={{ '--i': 3 } as React.CSSProperties}>
        <div className="flex items-baseline gap-4">
          <span className="t-hero text-faint" style={{ fontSize: '3rem', lineHeight: 1 }}>
            2
          </span>
          <div className="flex-1">
            <h2 className="t-title">Approve the machine</h2>
            <p className="text-soft mt-1">
              The installer shows a short code and opens this site. Confirm it is you — that is the
              last thing you ever have to do.
            </p>
          </div>
        </div>
      </section>

      <section className="mt-14 rise" style={{ '--i': 4 } as React.CSSProperties}>
        <div className="flex items-baseline gap-4">
          <span className="t-hero text-faint" style={{ fontSize: '3rem', lineHeight: 1 }}>
            3
          </span>
          <div className="flex-1">
            <h2 className="t-title">There is no step three</h2>
            <p className="text-soft mt-1" style={{ maxWidth: '46ch' }}>
              Shkills adds a <code>SessionStart</code> hook to your Claude settings. Every new
              session refreshes your skills before it starts. Publish a change here and it is on
              every machine within one session.
            </p>
          </div>
        </div>
      </section>

      <hr className="rule my-16" />

      <section>
        <h2 className="t-title">What you get today</h2>
        {mine.loading && <Spinner label="Loading" />}
        {mine.error && <ErrorNote message={mine.error} />}
        {mine.data && (
          <>
            {mine.data.collections.length > 0 && (
              <div className="mt-6 flex flex-wrap gap-2" data-testid="my-collections">
                {mine.data.collections.map((collection) => (
                  <span
                    key={collection.slug}
                    className="chip chip-static"
                    data-testid={`my-collection-${collection.slug}`}
                  >
                    {collection.name}
                    {collection.isDefault && ' · everyone'}
                  </span>
                ))}
              </div>
            )}
            {mine.data.skills.length === 0 ? (
              <Empty
                testId="my-skills-empty"
                title="No skills yet."
                detail="Add a few from the catalog, or join a collection."
              />
            ) : (
              <div className="mt-6 space-y-1" style={{ maxWidth: '46rem' }} data-testid="my-skills">
                {mine.data.skills.map((skill) => (
                  <div
                    key={skill.slug}
                    data-testid={`my-skill-${skill.slug}`}
                    className="flex flex-wrap items-baseline justify-between gap-3 py-3"
                    style={{ borderBottom: '1px solid var(--line)' }}
                  >
                    <span style={{ fontWeight: 600 }}>{skill.title}</span>
                    <span className="t-meta tnum" data-testid={`my-skill-source-${skill.slug}`}>
                      v{skill.version} · via {skill.sources.join(', ')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      <hr className="rule my-16" />

      <section>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="t-title">Your machines</h2>
            <p className="text-soft mt-1">
              Every computer you have linked. Revoking one stops it syncing immediately.
            </p>
          </div>
        </div>

        {tokens.loading && <Spinner label="Loading machines" />}
        {tokens.error && <ErrorNote message={tokens.error} />}

        {tokens.data && active.length === 0 && (
          <Empty testId="machines-empty" title="No machines linked yet." detail="Run the install command above." />
        )}

        <div className="mt-6 space-y-1" style={{ maxWidth: '46rem' }} data-testid="machines">
          {active.map((token) => (
            <div
              key={token.id}
              data-testid={`machine-${token.name}`}
              className="flex flex-wrap items-center justify-between gap-4 py-4"
              style={{ borderBottom: '1px solid var(--line)' }}
            >
              <div>
                <p style={{ fontWeight: 600 }}>{token.name}</p>
                <p className="t-meta">
                  Linked {timeAgo(token.created_at)}
                  {token.last_sync_at ? ` · last synced ${timeAgo(token.last_sync_at)}` : ' · never synced'}
                </p>
              </div>
              <button
                className="btn btn-danger"
                data-testid={`machine-revoke-${token.name}`}
                onClick={() => void revoke(token.id)}
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      </section>

      <hr className="rule my-16" />

      <section className="pb-10">
        <h2 className="t-title">Useful commands</h2>
        <div className="mt-6 space-y-3" style={{ maxWidth: '46rem' }}>
          {(
            [
              ['shkills list', 'What is installed on this machine, and why'],
              ['shkills browse', 'Search the company catalog from the terminal'],
              ['shkills add <name>', 'Install a single skill'],
              ['shkills use <name>', 'Join a collection'],
              ['shkills sync', 'Pull the latest right now, without waiting for a session'],
              ['shkills status', 'Check the link, the hook and the last sync'],
            ] as const
          ).map(([command, description]) => (
            <div key={command} className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
              <code
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.875rem',
                  minWidth: '13rem',
                  fontWeight: 600,
                }}
              >
                {command}
              </code>
              <span className="t-meta">{description}</span>
            </div>
          ))}
        </div>

        {user?.role === 'admin' && (
          <p className="t-meta mt-10" style={{ maxWidth: '46rem' }}>
            Rolling this out to a team? The install command is the whole onboarding — put it in your
            laptop setup script. It is idempotent, so running it again just updates the CLI.
          </p>
        )}
      </section>
    </div>
  );
}
