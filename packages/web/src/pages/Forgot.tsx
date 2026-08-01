import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { ErrorNote, Field, Wordmark } from '../components';

interface Sent {
  delivery: 'email' | 'administrator';
  expiresInMinutes: number;
}

/**
 * Asking for a way back in.
 *
 * The confirmation deliberately says the same thing whether or not the address
 * belongs to anybody — the server answers identically, and a page that read
 * more into it than the server said would give the difference away anyway.
 */
export default function Forgot() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<Sent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setSent(await api.post<Sent>('/v1/auth/forgot', { email }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Frame testId="forgot-page">
      {sent ? (
        <div data-testid="forgot-sent">
          <h2 className="t-title mb-3">Check with {sent.delivery === 'email' ? 'your inbox' : 'an administrator'}</h2>
          {sent.delivery === 'email' ? (
            <p className="text-soft" style={{ lineHeight: 1.6 }}>
              If <strong>{email}</strong> has an account here, a link to choose a new password is on
              its way. It works once, and stops working in {sent.expiresInMinutes} minutes.
            </p>
          ) : (
            <p className="text-soft" style={{ lineHeight: 1.6 }}>
              This Shkills has no mail server, so links are handed over by a person. If{' '}
              <strong>{email}</strong> has an account here, an administrator can now see that you are
              waiting, and will pass you a link that works once.
            </p>
          )}
          <p className="t-meta mt-6">
            Nothing has changed about your account yet, and your old password still works if it comes
            back to you.
          </p>
          <Link className="btn btn-quiet mt-7 w-full" to="/signin" data-testid="forgot-back">
            Back to sign in
          </Link>
        </div>
      ) : (
        <>
          <h2 className="t-title mb-1">Forgotten your password</h2>
          <p className="t-meta mb-7">Tell us the address you sign in with.</p>

          <form onSubmit={submit} className="space-y-5" data-testid="forgot-form">
            <Field label="Email">
              <input
                className="field"
                data-testid="forgot-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                autoFocus
              />
            </Field>

            {error && <ErrorNote message={error} testId="forgot-error" />}

            <button className="btn btn-primary btn-lg w-full" disabled={busy} data-testid="forgot-submit">
              {busy ? 'One moment…' : 'Send me a way back in'}
            </button>
          </form>

          <Link className="btn btn-quiet mt-5 w-full" to="/signin" data-testid="forgot-back">
            I remembered it
          </Link>
        </>
      )}
    </Frame>
  );
}

/** The signed-out pages share one narrow, centred card. */
export function Frame({ children, testId }: { children: React.ReactNode; testId: string }) {
  return (
    <div className="min-h-screen flex flex-col" data-testid={testId}>
      <header className="mx-auto w-full max-w-6xl px-6 py-6">
        <Link to="/signin">
          <Wordmark />
        </Link>
      </header>
      <div className="mx-auto flex w-full max-w-lg flex-1 items-center px-6 pb-24">
        <div className="card rise w-full min-w-0 p-9" style={{ '--i': 0 } as React.CSSProperties}>
          {children}
        </div>
      </div>
    </div>
  );
}
