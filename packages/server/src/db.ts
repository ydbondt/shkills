import Database from 'better-sqlite3';
import { config } from './config.js';

export const db = new Database(config.dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member',   -- member | curator | admin
  department    TEXT NOT NULL DEFAULT 'engineering',
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS skills (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  slug                 TEXT NOT NULL UNIQUE,
  owner_id             INTEGER NOT NULL REFERENCES users(id),
  published_version_id INTEGER REFERENCES skill_versions(id) DEFERRABLE INITIALLY DEFERRED,
  archived             INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS skill_versions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_id       INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  version        INTEGER NOT NULL,
  title          TEXT NOT NULL,
  description    TEXT NOT NULL,
  category       TEXT NOT NULL DEFAULT 'general',
  audiences      TEXT NOT NULL DEFAULT '[]',       -- JSON array: engineering, sales, product, ...
  tags           TEXT NOT NULL DEFAULT '[]',       -- JSON array
  allowed_tools  TEXT,                             -- optional frontmatter passthrough
  user_invocable INTEGER NOT NULL DEFAULT 0,
  body           TEXT NOT NULL,
  change_note    TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'pending',  -- draft | pending | approved | rejected | superseded
  author_id      INTEGER NOT NULL REFERENCES users(id),
  reviewer_id    INTEGER REFERENCES users(id),
  review_note    TEXT,
  checksum       TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at    TEXT,
  UNIQUE (skill_id, version)
);

CREATE TABLE IF NOT EXISTS collections (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  audience    TEXT NOT NULL DEFAULT 'general',
  is_default  INTEGER NOT NULL DEFAULT 0,          -- auto-subscribed for everyone
  created_by  INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS collection_skills (
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  skill_id      INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, skill_id)
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,                        -- skill | collection
  target_id  INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, kind, target_id)
);

CREATE TABLE IF NOT EXISTS device_tokens (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL DEFAULT 'cli',
  token_hash   TEXT NOT NULL UNIQUE,
  prefix       TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  last_sync_at TEXT,
  revoked_at   TEXT
);

CREATE TABLE IF NOT EXISTS device_auth (
  device_code   TEXT PRIMARY KEY,
  user_code     TEXT NOT NULL UNIQUE,
  hostname      TEXT NOT NULL DEFAULT '',
  user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
  token         TEXT,                              -- issued once, then cleared on pickup
  status        TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | claimed | denied
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS password_resets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  -- how the link reached its owner: email | administrator | console
  delivery   TEXT NOT NULL DEFAULT 'administrator',
  -- who asked. NULL when the person asked for it themselves.
  issued_by  INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  -- set when a newer request, or the reset itself, made this one moot
  voided_at  TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id   INTEGER REFERENCES users(id),
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL,
  entity_id  INTEGER,
  detail     TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_versions_skill  ON skill_versions(skill_id);
CREATE INDEX IF NOT EXISTS idx_versions_status ON skill_versions(status);
CREATE INDEX IF NOT EXISTS idx_subs_user       ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created   ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_resets_user     ON password_resets(user_id);
`);

/**
 * The schema above is created with `IF NOT EXISTS`, which cannot add a column
 * to a table an older release already made. Databases in the field are the only
 * ones that matter here, so new columns are added explicitly and idempotently.
 */
function addColumn(table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (columns.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

/**
 * Sessions are stateless JWTs, so there is nothing to delete when somebody
 * needs every other session gone. Instead each token carries the epoch it was
 * signed in, and a token whose epoch is not the current one is refused.
 *
 * A counter rather than a timestamp on purpose: a cutoff compared against the
 * token's `iat` cannot tell apart two tokens issued in the same second, which
 * is exactly what a reset does — sign a new one at the moment it invalidates
 * the old. The counter has no such window.
 */
addColumn('users', 'session_epoch', 'INTEGER NOT NULL DEFAULT 0');

/**
 * A personal skill belongs to one person: it skips review, syncs to that
 * person's own machines, and is invisible to everybody else. The default is
 * `shared`, so every skill written before this existed keeps meaning what it
 * meant — a company skill.
 *
 * Sharing is a property of the skill rather than of a version, so that a
 * request to share never disturbs the version the owner is already running.
 * That is invariant 3 ("a review in flight never takes the live skill away")
 * holding for free rather than by care.
 */
addColumn('skills', 'visibility', "TEXT NOT NULL DEFAULT 'shared'");
addColumn('skills', 'share_status', "TEXT NOT NULL DEFAULT 'none'");
addColumn('skills', 'share_note', 'TEXT');
addColumn('skills', 'share_asked_at', 'TEXT');

export function audit(
  actorId: number | null,
  action: string,
  entity: string,
  entityId: number | null,
  detail = '',
): void {
  db.prepare(
    'INSERT INTO audit_log (actor_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)',
  ).run(actorId, action, entity, entityId, detail);
}
