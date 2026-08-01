import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, type User } from '../api';
import { ErrorNote, Field, Spinner } from '../components';
import { useAsync, useSession, useToast } from '../state';
import { Frame } from './Forgot';

/**
 * Choosing a new password, at the end of a link.
 *
 * The link is checked before anything is asked for, so an expired one says so
 * instead of taking a password and then refusing it — and so the page can name
 * the account, which is the only protection against setting a password on
 * somebody else's by following the wrong link out of a chat window.
 */
export default function Reset() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { refresh } = useSession();
  const { notify } = useToast();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const link = useAsync(
    () => api.get<{ email: string; name: string }>(`/v1/auth/reset?token=${encodeURIComponent(token)}`),
    [token],
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { linkedDevices } = await api.post<{ user: User; linkedDevices: number }>(
        '/v1/auth/reset',
        { token, password },
      );
      await refresh();
      notify('Your password is set, and you are signed in.', 'positive');
      // Device tokens survive a reset on purpose (docs/security.md), so say so
      // rather than leave somebody to discover a machine they did not link.
      if (linkedDevices > 0) {
        notify(
          `${linkedDevices} ${linkedDevices === 1 ? 'machine is' : 'machines are'} still linked — check them under Your setup.`,
        );
      }
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.');
      setBusy(false);
    }
  }

  if (link.loading) {
    return (
      <Frame testId="reset-page">
        <Spinner label="Checking your link" />
      </Frame>
    );
  }

  if (link.error) {
    return (
      <Frame testId="reset-page">
        <div data-testid="reset-dead">
          <h2 className="t-title mb-3">That link is no longer good</h2>
          <p className="text-soft" style={{ lineHeight: 1.6 }}>
            {link.error} Links work once and last an hour, so this usually means it has already been
            used, or a newer one replaced it.
          </p>
          <Link className="btn btn-primary btn-lg mt-7 w-full" to="/forgot" data-testid="reset-ask-again">
            Ask for another
          </Link>
        </div>
      </Frame>
    );
  }

  return (
    <Frame testId="reset-page">
      <h2 className="t-title mb-1">Choose a new password</h2>
      <p className="t-meta mb-7" data-testid="reset-account">
        For {link.data?.email}
      </p>

      <form onSubmit={submit} className="space-y-5" data-testid="reset-form">
        <Field label="New password" hint="At least 8 characters.">
          <input
            className="field"
            data-testid="reset-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
            minLength={8}
            autoFocus
          />
        </Field>

        {error && <ErrorNote message={error} testId="reset-error" />}

        <button className="btn btn-primary btn-lg w-full" disabled={busy} data-testid="reset-submit">
          {busy ? 'One moment…' : 'Set it and sign me in'}
        </button>
      </form>

      <p className="t-meta mt-6">
        Every other browser signed in as you will be signed out.
      </p>
    </Frame>
  );
}
