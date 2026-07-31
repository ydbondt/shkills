import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { ErrorNote } from '../components';
import { useSession } from '../state';

/**
 * The approval screen the CLI sends people to. It is deliberately one decision
 * on an otherwise empty page — this is the moment somebody grants a machine
 * access to their account, and nothing else should compete for attention.
 */
export default function LinkDevice() {
  const [params] = useSearchParams();
  const { user } = useSession();
  const navigate = useNavigate();
  const [code, setCode] = useState(params.get('code') ?? '');
  const [hostname, setHostname] = useState<string | null>(null);
  const [state, setState] = useState<'asking' | 'approved' | 'denied'>('asking');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Look the code up first so the person sees which machine they are approving.
  useEffect(() => {
    const normalised = code.trim().toUpperCase();
    if (normalised.length < 9) {
      setHostname(null);
      return;
    }
    let cancelled = false;
    api
      .get<{ hostname: string }>(`/v1/device/pending/${encodeURIComponent(normalised)}`)
      .then((result) => {
        if (!cancelled) {
          setHostname(result.hostname || 'a computer');
          setError(null);
        }
      })
      .catch(() => {
        if (!cancelled) setHostname(null);
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  async function decide(approve: boolean, event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(`/v1/device/${approve ? 'approve' : 'deny'}`, {
        userCode: code.trim().toUpperCase(),
      });
      setState(approve ? 'approved' : 'denied');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  if (state === 'approved') {
    return (
      <Centered>
        <h1 className="t-display rise">Done.</h1>
        <p className="t-body-lg mt-5 rise" style={{ '--i': 1 } as React.CSSProperties}>
          {hostname ? <><strong>{hostname}</strong> is linked.</> : 'That machine is linked.'} Your
          terminal has already finished setting up — you can close this tab.
        </p>
        <div className="mt-10 rise" style={{ '--i': 2 } as React.CSSProperties}>
          <button className="btn btn-primary btn-lg" onClick={() => navigate('/setup')}>
            See what is installed
          </button>
        </div>
      </Centered>
    );
  }

  if (state === 'denied') {
    return (
      <Centered>
        <h1 className="t-display rise">Declined.</h1>
        <p className="t-body-lg mt-5">Nothing was linked. That request can no longer be used.</p>
      </Centered>
    );
  }

  return (
    <Centered>
      <p className="t-eyebrow rise">Link a machine</p>
      <h1 className="t-display mt-4 rise" style={{ '--i': 1 } as React.CSSProperties}>
        {hostname ? `Is this you on ${hostname}?` : 'Enter the code from your terminal.'}
      </h1>
      <p
        className="t-body-lg mt-5 rise"
        style={{ maxWidth: '42ch', '--i': 2 } as React.CSSProperties}
      >
        {hostname
          ? `Approving lets that computer read the skills you subscribe to, as ${user?.name}.`
          : 'The Shkills installer printed a short code. Type it here.'}
      </p>

      <form
        onSubmit={(event) => void decide(true, event)}
        className="mt-10 rise"
        style={{ '--i': 3 } as React.CSSProperties}
      >
        <input
          className="field"
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          placeholder="XXXX-XXXX"
          maxLength={9}
          autoFocus={!code}
          aria-label="Code from your terminal"
          style={{
            maxWidth: '15rem',
            fontFamily: 'var(--font-mono)',
            fontSize: '1.5rem',
            letterSpacing: '0.14em',
            textAlign: 'center',
            fontWeight: 700,
          }}
        />

        {error && <div className="mt-4"><ErrorNote message={error} /></div>}

        <div className="mt-8 flex flex-wrap gap-3">
          <button className="btn btn-primary btn-lg" disabled={busy || code.trim().length < 9}>
            Yes, link it
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-lg"
            disabled={busy || code.trim().length < 9}
            onClick={() => void decide(false)}
          >
            No, that wasn’t me
          </button>
        </div>
      </form>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-[70vh] place-items-center">
      <div style={{ maxWidth: '34rem' }}>{children}</div>
    </div>
  );
}
