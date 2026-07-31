import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { api, canCurate, type Stats } from './api';
import { Wordmark } from './components';
import { useSession } from './state';

interface NavItem {
  to: string;
  label: string;
  /** Stable handle for tests — see docs/e2e-testing.md. */
  id: string;
  badge?: number;
}

export function Shell({ children }: { children: ReactNode }) {
  const { user, signOut } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [pending, setPending] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);

  // The review count is the one number worth interrupting someone for, so it
  // lives in the nav and refreshes as you move around the app.
  useEffect(() => {
    if (!canCurate(user)) return;
    api
      .get<{ stats: Stats }>('/v1/admin/stats')
      .then(({ stats }) => setPending(stats.pending))
      .catch(() => setPending(0));
  }, [user, location.pathname]);

  useEffect(() => setMenuOpen(false), [location.pathname]);

  const items: NavItem[] = [
    { to: '/', label: 'Skills', id: 'skills' },
    { to: '/collections', label: 'Collections', id: 'collections' },
    ...(canCurate(user) ? [{ to: '/review', label: 'Review', id: 'review', badge: pending }] : []),
    { to: '/setup', label: 'Your setup', id: 'setup' },
    ...(canCurate(user) ? [{ to: '/people', label: 'People', id: 'people' }] : []),
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <header
        data-testid="app-header"
        className="sticky top-0 z-40"
        style={{
          background: 'color-mix(in srgb, var(--surface) 78%, transparent)',
          backdropFilter: 'saturate(180%) blur(20px)',
          borderBottom: '1px solid var(--line)',
        }}
      >
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-1 px-6">
          <button
            onClick={() => navigate('/')}
            className="mr-6 shrink-0"
            style={{ fontWeight: 800, letterSpacing: '-0.03em' }}
            data-testid="nav-home"
          >
            <Wordmark />
          </button>

          <nav className="hidden md:flex items-center gap-1" data-testid="nav">
            {items.map((item) => (
              <NavItemLink key={item.to} item={item} />
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <button
              className="btn btn-primary hidden sm:inline-flex"
              onClick={() => navigate('/skills/new')}
              data-testid="propose-skill"
            >
              Propose a skill
            </button>
            <div className="relative">
              <button
                className="grid h-9 w-9 place-items-center rounded-full"
                style={{ background: 'var(--surface-sunken)', fontWeight: 700, fontSize: '0.8rem' }}
                onClick={() => setMenuOpen((open) => !open)}
                aria-label="Account"
                aria-expanded={menuOpen}
                data-testid="account-button"
              >
                {initials(user?.name ?? '')}
              </button>
              {menuOpen && (
                <div
                  className="card absolute right-0 mt-2 w-60 p-2 rise"
                  style={{ animationDelay: '0ms' }}
                  data-testid="account-menu"
                >
                  <div className="px-3 py-2">
                    <p style={{ fontWeight: 700 }} data-testid="account-name">
                      {user?.name}
                    </p>
                    <p className="t-meta" data-testid="account-email">
                      {user?.email}
                    </p>
                    <p
                      className="t-meta mt-1"
                      style={{ textTransform: 'capitalize' }}
                      data-testid="account-role"
                    >
                      {user?.role} · {user?.department}
                    </p>
                  </div>
                  <hr className="rule my-1" />
                  <div className="md:hidden">
                    {items.map((item) => (
                      <MenuLink key={item.to} to={item.to} label={item.label} testId={`menu-${item.id}`} />
                    ))}
                    <hr className="rule my-1" />
                  </div>
                  <MenuLink to="/setup" label="Install on a new machine" testId="menu-install" />
                  <button
                    className="w-full rounded-lg px-3 py-2 text-left"
                    style={{ fontSize: '0.9375rem' }}
                    data-testid="sign-out"
                    onClick={() => {
                      void signOut();
                      navigate('/signin');
                    }}
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 pb-32">{children}</main>

      <footer className="mx-auto w-full max-w-6xl px-6 pb-10">
        <hr className="rule mb-5" />
        <p className="t-meta">
          Shkills — one place to keep every Claude the same. Changes reach every machine on the
          next Claude session.
        </p>
      </footer>
    </div>
  );
}

function NavItemLink({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      data-testid={`nav-${item.id}`}
      className="rounded-full px-3 py-1.5"
      style={({ isActive }) => ({
        fontSize: '0.9375rem',
        fontWeight: 600,
        color: isActive ? 'var(--ink)' : 'var(--ink-faint)',
        background: isActive ? 'var(--surface-sunken)' : 'transparent',
        transition: 'color 0.2s var(--ease), background 0.2s var(--ease)',
      })}
    >
      {item.label}
      {item.badge ? (
        <span
          className="ml-1.5 tnum"
          data-testid={`nav-${item.id}-badge`}
          style={{ color: 'var(--caution)', fontWeight: 700, fontSize: '0.8rem' }}
        >
          {item.badge}
        </span>
      ) : null}
    </NavLink>
  );
}

function MenuLink({ to, label, testId }: { to: string; label: string; testId?: string }) {
  return (
    <NavLink
      to={to}
      className="block rounded-lg px-3 py-2"
      style={{ fontSize: '0.9375rem' }}
      data-testid={testId}
    >
      {label}
    </NavLink>
  );
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || '?'
  );
}
