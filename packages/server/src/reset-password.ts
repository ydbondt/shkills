/**
 * The way back in for whoever has nobody to ask.
 *
 * Every other route out of a lost password needs somebody else: a mail server,
 * or an administrator with a working account. On a single-tenant deployment the
 * only account is often the administrator's, so there has to be one door that
 * opens from inside the container.
 *
 *   npm run reset-password -- you@example.com
 *   npm run reset-password -- you@example.com --password 'a new one'
 *
 * On the cluster:
 *   kubectl exec -n shkills deploy/shkills -- node dist/reset-password.js you@…
 */
import { config } from './config.js';
import { audit, db } from './db.js';
import { hashPassword, invalidateSessions } from './auth.js';
import {
  RESET_TTL_MINUTES,
  issueResetForUser,
  resetUrl,
  voidOutstanding,
} from './services/recovery.js';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function main(): void {
  const args = process.argv.slice(2);
  const email = args.find((a) => !a.startsWith('--'));
  const passwordIndex = args.indexOf('--password');
  const password = passwordIndex === -1 ? undefined : args[passwordIndex + 1];

  if (!email) {
    fail(
      [
        'Usage: reset-password <email> [--password <new password>]',
        '',
        'Without --password this prints a single-use link to open in a browser.',
        'With it, the password is set straight away — which is quicker, but the',
        'password ends up in your shell history and in the process list.',
        '',
        `Accounts on this deployment:${accounts()}`,
      ].join('\n'),
    );
  }

  const user = db
    .prepare('SELECT id, email, name, role, active FROM users WHERE email = ?')
    .get(email.toLowerCase().trim()) as
    | { id: number; email: string; name: string; role: string; active: number }
    | undefined;
  if (!user) fail(`No account for "${email}".\n\nAccounts on this deployment:${accounts()}`);
  if (!user.active) fail(`The account for "${email}" is deactivated, so there is nothing to recover.`);

  if (password !== undefined) {
    if (password.length < 8) fail('That password is shorter than eight characters.');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), user.id);
    voidOutstanding(user.id);
    invalidateSessions(user.id);
    audit(null, 'auth.password_reset', 'user', user.id, 'console');
    console.log(`Done. ${user.name} <${user.email}> (${user.role}) can sign in with the new password.`);
    console.log('Every session that was open elsewhere has been signed out.');
    return;
  }

  const link = issueResetForUser(user.id, 'console');
  console.log(`A single-use link for ${user.name} <${user.email}> (${user.role}):`);
  console.log('');
  console.log(`  ${resetUrl(config.publicUrl, link.token)}`);
  console.log('');
  console.log(`It works once, and stops working in ${RESET_TTL_MINUTES} minutes.`);
  console.log('Anyone holding it can set the password, so hand it over the way you');
  console.log('would hand over the password itself.');
}

/** Printed on failure: on a console, being unhelpful is the only real mistake. */
function accounts(): string {
  const rows = db
    .prepare('SELECT email, role, active FROM users ORDER BY role DESC, email')
    .all() as { email: string; role: string; active: number }[];
  if (!rows.length) return '\n  (none yet — the first account to register becomes the admin)';
  return rows
    .map((r) => `\n  ${r.email} — ${r.role}${r.active ? '' : ' (deactivated)'}`)
    .join('');
}

main();
