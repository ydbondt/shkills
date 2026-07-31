# Shkills

**Share skills.** A company-wide home for Claude skills: propose one, have it
reviewed, and it appears on every colleague's machine by itself.

The problem this solves is drift. Skills copied into `~/.claude/skills` by hand
go stale the moment someone improves them, and nobody knows which version they
are running. Shkills makes the skill set something you *subscribe to* rather
than something you *copy*.

---

## How propagation works

Claude Code reads personal skills from `~/.claude/skills/<name>/SKILL.md`. So:

1. `shkills login` links a machine to an account and registers a **`SessionStart`
   hook** in `~/.claude/settings.json`.
2. Claude runs that hook before every session. It calls `shkills sync`, which
   asks the server for the current skill set and writes the files.
3. Publish a change in the portal and it is on every subscribed machine by the
   start of their next Claude session.

There is no daemon, no polling loop, and no second setup step. A sync sends an
`If-None-Match` header, so the common case is a `304` with no payload.

```
   portal                     server                    each machine
  ────────                   ────────                  ──────────────
  propose  ──────────────▶  pending version
  approve  ──────────────▶  published ────┐
                                          │  GET /api/v1/sync (ETag)
                                          └──▶ ~/.claude/skills/<name>/SKILL.md
                                                 ▲
                                        SessionStart hook, every session
```

---

## Quick start

```bash
npm install
npm run seed          # sample company: 5 people, 9 skills, 4 collections
npm run build
npm start             # http://localhost:4000
```

Sign in with any seeded account — password `shkills123`:

| Account           | Role    | Can                                    |
| ----------------- | ------- | -------------------------------------- |
| `maya@acme.test`  | admin   | everything, plus managing people        |
| `rob@acme.test`   | curator | approve, publish, manage collections    |
| `dan@acme.test`   | member  | propose skills, subscribe               |

For development with hot reload, run the API and the web app separately:

```bash
npm run dev -w @shkills/server    # :4000
npm run dev -w @shkills/web       # :5173, proxies /api to :4000
```

---

## Onboarding a person

One command, from the machine they want Claude on:

```bash
curl -fsSL https://shkills.yourcompany.com/install.sh | sh
```

It checks for Node 20+, downloads the CLI, puts it on `PATH`, remembers the
server, and hands over to `shkills login`. Login prints a short code and a URL;
approving it in the browser finishes the setup, including the auto-update hook.

That is the entire onboarding. Put the line in your laptop setup script — it is
idempotent, so re-running it just updates the CLI.

### CLI

| Command                | What it does                                          |
| ---------------------- | ----------------------------------------------------- |
| `shkills login`        | Link this machine (also runs `setup`)                 |
| `shkills setup`        | Turn on automatic updates — `--off` to turn them off  |
| `shkills list`         | What is installed here, and which collection sent it  |
| `shkills browse [q]`   | Search the company catalog                            |
| `shkills collections`  | Ready-made sets of skills                             |
| `shkills add <name>`   | Install one skill · `remove` to drop it               |
| `shkills use <name>`   | Join a collection · `unuse` to leave                  |
| `shkills sync`         | Pull now — `--dry-run` to preview, `--force` to bypass the cache |
| `shkills status`       | Server, account, hook state, last sync                |
| `shkills show <name>`  | Print a skill exactly as Claude sees it               |
| `shkills clean`        | Remove every skill Shkills installed                  |
| `shkills logout`       | Unlink this machine                                   |

**Your own skills are never touched.** Shkills only writes to directories it
created, each marked with a `.shkills.json` file. If a company skill collides
with one you wrote by hand, it is skipped with a warning. Deleting the marker
hands ownership back to you permanently.

---

## Concepts

**Skill** — a name, a trigger description, a category, an audience, and the
instructions. The description is what decides whether Claude reaches for it, so
the editor treats it as the most important field on the page.

**Version** — every change creates one. A skill points at its published version;
proposals sit alongside as `pending`, which means a review in flight never takes
the live skill away from anyone. Rollback republishes an older version.

**Collection** — a set of skills people join in one decision, e.g. "Backend
Engineering" or "Sales". Adding a skill to a collection installs it for everyone
in it. Collections marked **company default** apply to everybody and cannot be
opted out of — that is what makes "everyone uses the same skills" true rather
than aspirational.

**Roles** — `member` proposes and subscribes; `curator` approves, publishes and
manages collections; `admin` also manages people. Curators publish their own
work directly, with an explicit "send for review instead" option.

---

## Deployment

Single container, single SQLite file:

```bash
docker compose up -d
```

Configuration:

| Variable              | Default                 | Notes                                    |
| --------------------- | ----------------------- | ---------------------------------------- |
| `PORT`                | `4000`                  |                                          |
| `SHKILLS_PUBLIC_URL`  | `http://localhost:4000` | Used in install instructions and links   |
| `SHKILLS_DATA_DIR`    | `./data`                | SQLite database lives here               |
| `SHKILLS_JWT_SECRET`  | generated, persisted    | **Set this in production**               |

Put it behind TLS. Sessions are `httpOnly` cookies and set `Secure` when
`NODE_ENV=production`; CLI tokens are bearer tokens stored only as SHA-256
hashes, and every one can be revoked individually from *Your setup*.

The first account created on a fresh deployment becomes the administrator.

### Backup

Everything is in `$SHKILLS_DATA_DIR`. Back it up with:

```bash
sqlite3 data/shkills.sqlite ".backup 'backup.sqlite'"
```

---

## Layout

```
packages/server   Express + SQLite. API, approval workflow, sync, install.sh
packages/cli      The bundled CLI. One file, no runtime dependencies
packages/web      React + Vite portal
```

```bash
npm test          # 57 tests across all three packages
npm run typecheck
```

## API

All endpoints live under `/api/v1` and accept either a session cookie or a
`Bearer shk_…` device token.

| Method   | Path                             | Purpose                        |
| -------- | -------------------------------- | ------------------------------ |
| `GET`    | `/sync`                          | The caller's whole skill set    |
| `GET`    | `/skills`, `/skills/:slug`       | Catalog and detail              |
| `POST`   | `/skills`, `/skills/:slug/versions` | Propose                     |
| `POST`   | `/skills/versions/:id/approve`   | Approve · `reject` · `rollback` |
| `GET`    | `/collections`                   | Collections and membership      |
| `POST`   | `/subscriptions`                 | Subscribe to a skill or set     |
| `POST`   | `/device/code`, `/device/token`  | CLI login                       |
| `GET`    | `/admin/users`, `/admin/audit`   | People and the activity log     |
