import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ErrorNote, Field, Wordmark } from '../components';
import { useSession } from '../state';

export default function SignIn() {
  const { signIn, register } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<'signin' | 'register'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [department, setDepartment] = useState('engineering');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const destination = (location.state as { from?: string } | null)?.from ?? '/';

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'signin') await signIn(email, password);
      else await register({ email, password, name, department });
      navigate(destination, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="mx-auto w-full max-w-6xl px-6 py-6">
        <Wordmark />
      </header>

      <div className="mx-auto grid w-full max-w-7xl flex-1 items-center gap-16 px-6 pb-24 lg:grid-cols-[1.35fr_minmax(21rem,0.75fr)]">
        <div>
          <h1 className="t-hero rise" style={{ '--i': 0 } as React.CSSProperties}>
            Every skill
            <br />
            your company knows.
            <br />
            <span className="text-faint">On every machine.</span>
          </h1>
          <p
            className="t-body-lg mt-8 rise"
            style={{ maxWidth: '46ch', '--i': 1 } as React.CSSProperties}
          >
            Write a skill once. Have it reviewed. Everyone’s Claude picks it up at the start of
            their next session — no copying files, no stale versions, nothing to remember.
          </p>

          <div className="mt-12 rise" style={{ '--i': 2 } as React.CSSProperties}>
            <p className="t-eyebrow mb-3">Set up in one command</p>
            <div className="terminal" style={{ maxWidth: '34rem' }}>
              <span className="text-faint">$ </span>curl -fsSL {window.location.origin}/install.sh | sh
            </div>
          </div>
        </div>

        <div className="card rise p-9" style={{ '--i': 1 } as React.CSSProperties}>
          <h2 className="t-title mb-1">{mode === 'signin' ? 'Sign in' : 'Create your account'}</h2>
          <p className="t-meta mb-7">
            {mode === 'signin'
              ? 'With your work email.'
              : 'The first account on a new Shkills becomes the administrator.'}
          </p>

          <form onSubmit={submit} className="space-y-5">
            {mode === 'register' && (
              <Field label="Name">
                <input
                  className="field"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  required
                />
              </Field>
            )}

            <Field label="Email">
              <input
                className="field"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                autoFocus
              />
            </Field>

            <Field label="Password" hint={mode === 'register' ? 'At least 8 characters.' : undefined}>
              <input
                className="field"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                required
                minLength={8}
              />
            </Field>

            {mode === 'register' && (
              <Field label="Department">
                <select
                  className="field"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                >
                  {['engineering', 'product', 'design', 'sales', 'marketing', 'support'].map((d) => (
                    <option key={d} value={d}>
                      {d[0].toUpperCase() + d.slice(1)}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {error && <ErrorNote message={error} />}

            <button className="btn btn-primary btn-lg w-full" disabled={busy}>
              {busy ? 'One moment…' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <button
            className="btn btn-quiet mt-5 w-full"
            onClick={() => {
              setMode(mode === 'signin' ? 'register' : 'signin');
              setError(null);
            }}
          >
            {mode === 'signin' ? 'Create an account' : 'I already have an account'}
          </button>
        </div>
      </div>
    </div>
  );
}
