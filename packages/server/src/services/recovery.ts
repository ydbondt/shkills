import { randomBytes } from 'node:crypto';
import { audit, db } from '../db.js';
import { hashToken, invalidateSessions, hashPassword } from '../auth.js';
import { DomainError } from './skills.js';

/**
 * Recovering a lost password.
 *
 * The whole flow hangs off one artefact: a single-use link that expires. How it
 * reaches its owner is a separate question, answered by `mail.ts` and by the
 * administrator queue, because a deployment without a mail server still has to
 * have a way back in.
 */

/** How long a link is good for. Long enough to read an email, short enough to matter. */
export const RESET_TTL_MINUTES = 60;

/**
 * Asking again immediately does not mint a second link. Without this, anyone
 * who knows an address can fill that person's inbox from a signed-out page.
 */
const REQUEST_INTERVAL_SECONDS = 60;

export type Delivery = 'email' | 'administrator' | 'console';

export interface ResetLink {
  /** The secret. Handed over exactly once; only its hash is stored. */
  token: string;
  userId: number;
  email: string;
  name: string;
  expiresAt: string;
}

export interface ResetRequest {
  id: number;
  userId: number;
  email: string;
  name: string;
  createdAt: string;
  expiresAt: string;
  delivery: Delivery;
}

interface UserRow {
  id: number;
  email: string;
  name: string;
}

function activeUser(email: string): UserRow | undefined {
  return db
    .prepare('SELECT id, email, name FROM users WHERE email = ? AND active = 1')
    .get(email.toLowerCase().trim()) as UserRow | undefined;
}

function recentlyAsked(userId: number): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM password_resets
        WHERE user_id = ? AND used_at IS NULL AND voided_at IS NULL
          AND created_at > datetime('now', ?)`,
    )
    .get(userId, `-${REQUEST_INTERVAL_SECONDS} seconds`);
  return row !== undefined;
}

/**
 * Anything still outstanding for this person stops working.
 *
 * Every path that sets a password has to call this. A link that survives the
 * password being set by some other route is a way into an account somebody has
 * already taken back.
 */
export function voidOutstanding(userId: number): void {
  db.prepare(
    `UPDATE password_resets SET voided_at = datetime('now')
      WHERE user_id = ? AND used_at IS NULL AND voided_at IS NULL`,
  ).run(userId);
}

/**
 * Mints a link for an account that exists, on behalf of whoever typed the
 * address into the signed-out page.
 *
 * Returns undefined when there is nothing to mint — no such account, or one was
 * minted moments ago — and the caller must answer identically either way, or
 * the page becomes a way to ask whether somebody works here.
 *
 * The throttle is what stops a stranger filling somebody's inbox, or filling
 * the administrators' queue on a deployment that has no mail server.
 */
export function issueReset(email: string, delivery: Delivery): ResetLink | undefined {
  const user = activeUser(email);
  if (!user) return undefined;
  if (recentlyAsked(user.id)) return undefined;
  return mint(user, delivery, null);
}

/**
 * Same, for a caller that already knows which account it means and is
 * deliberately helping a person it can see — an administrator, or an operator
 * at a console. No throttle: they are not a stranger, and being told to wait a
 * minute while somebody stands over your shoulder is just an outage.
 */
export function issueResetForUser(
  userId: number,
  delivery: Delivery,
  issuedBy: number | null = null,
): ResetLink {
  const user = db.prepare('SELECT id, email, name FROM users WHERE id = ? AND active = 1').get(userId) as
    | UserRow
    | undefined;
  if (!user) throw new DomainError('no such user', 404);
  return mint(user, delivery, issuedBy);
}

function mint(user: UserRow, delivery: Delivery, issuedBy: number | null): ResetLink {
  voidOutstanding(user.id);
  const token = randomBytes(32).toString('base64url');
  // Expiry is computed by SQLite, so it is in the same format as every other
  // timestamp in the schema. An ISO string looks equivalent and is not: it
  // sorts *after* `datetime('now')` because of the `T`, so nothing ever expires.
  const id = db
    .prepare(
      `INSERT INTO password_resets (user_id, token_hash, delivery, issued_by, expires_at)
       VALUES (?, ?, ?, ?, datetime('now', ?))`,
    )
    .run(user.id, hashToken(token), delivery, issuedBy, `+${RESET_TTL_MINUTES} minutes`)
    .lastInsertRowid;
  const { expires_at: expiresAt } = db
    .prepare('SELECT expires_at FROM password_resets WHERE id = ?')
    .get(id) as { expires_at: string };
  // Only the unprompted requests: an administrator pressing the button logs
  // `auth.reset_issued` instead, and two lines for one action reads as two.
  // The detail is the address, not the delivery mode — whoever reads the log
  // needs to know *whose* account somebody asked about.
  if (issuedBy === null) audit(null, 'auth.reset_requested', 'user', user.id, user.email);
  return { token, userId: user.id, email: user.email, name: user.name, expiresAt };
}

/**
 * Re-labels an outstanding link. Used when the mail server turns out to be
 * down: the link exists, so it falls back to the administrator queue rather
 * than being thrown away.
 */
export function markDelivery(userId: number, delivery: Delivery): void {
  db.prepare(
    `UPDATE password_resets SET delivery = ?
      WHERE user_id = ? AND used_at IS NULL AND voided_at IS NULL`,
  ).run(delivery, userId);
}

/** The link the person clicks. `origin` is whichever address they reached us on. */
export function resetUrl(origin: string, token: string): string {
  return `${origin}/reset?token=${encodeURIComponent(token)}`;
}

interface ResetRow {
  id: number;
  user_id: number;
  email: string;
  name: string;
  expired: number;
}

function lookup(token: string): ResetRow | undefined {
  return db
    .prepare(
      `SELECT r.id, r.user_id, u.email, u.name,
              (r.expires_at <= datetime('now')) AS expired
         FROM password_resets r JOIN users u ON u.id = r.user_id
        WHERE r.token_hash = ? AND r.used_at IS NULL AND r.voided_at IS NULL
              AND u.active = 1`,
    )
    .get(hashToken(token)) as ResetRow | undefined;
}

/**
 * What the reset page needs before asking for a new password: whether the link
 * is still good, and whose account it opens — so nobody sets a password on an
 * account they did not mean.
 */
export function inspectReset(token: string): { email: string; name: string } {
  const row = lookup(token);
  if (!row || row.expired) {
    throw new DomainError('this link has expired or has already been used', 410);
  }
  return { email: row.email, name: row.name };
}

/**
 * Spends the link. Every other outstanding link for that account dies with it,
 * and so does every session anywhere — a reset that left the old sessions
 * signed in would not actually take the account back.
 *
 * Device tokens are deliberately left alone: see docs/security.md.
 */
export function completeReset(token: string, password: string): { userId: number; email: string } {
  const row = lookup(token);
  if (!row || row.expired) {
    throw new DomainError('this link has expired or has already been used', 410);
  }
  db.transaction(() => {
    db.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE id = ?").run(row.id);
    voidOutstanding(row.user_id);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), row.user_id);
  })();
  invalidateSessions(row.user_id);
  audit(row.user_id, 'auth.password_reset', 'user', row.user_id);
  return { userId: row.user_id, email: row.email };
}

/** Live requests, for the administrator who has to hand the link over by hand. */
export function outstandingRequests(): ResetRequest[] {
  return db
    .prepare(
      `SELECT r.id, r.user_id AS userId, u.email, u.name, r.created_at AS createdAt,
              r.expires_at AS expiresAt, r.delivery
         FROM password_resets r JOIN users u ON u.id = r.user_id
        WHERE r.used_at IS NULL AND r.voided_at IS NULL
              AND r.expires_at > datetime('now') AND u.active = 1
        ORDER BY r.created_at DESC`,
    )
    .all() as ResetRequest[];
}

/** How many machines this person still has linked, for the "was that you?" note. */
export function linkedDeviceCount(userId: number): number {
  return (
    db
      .prepare('SELECT COUNT(*) AS n FROM device_tokens WHERE user_id = ? AND revoked_at IS NULL')
      .get(userId) as { n: number }
  ).n;
}
