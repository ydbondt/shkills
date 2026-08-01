# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Server** — skills with full version history, an approval workflow
  (propose → approve / reject → rollback), collections, subscriptions, roles,
  device tokens and an append-only audit log.
- **Sync API** — `GET /api/v1/sync` returns a user's whole effective skill set
  with the exact `SKILL.md` bytes to write, fingerprinted by a manifest checksum
  served as an `ETag` so unchanged syncs are a `304` with no body.
- **CLI** — `login`, `setup`, `sync`, `status`, `list`, `browse`, `collections`,
  `add`, `remove`, `use`, `unuse`, `show`, `clean`, `logout`. Bundled with
  esbuild into one dependency-free `.mjs` file.
- **Automatic propagation** — `shkills login` registers a `SessionStart` hook in
  `~/.claude/settings.json`, so every Claude session refreshes the skill set
  before it starts.
- **Ownership safety** — a `.shkills.json` marker in every managed directory.
  Sync never modifies or deletes a directory it did not create; collisions with
  hand-written skills are skipped with a warning.
- **Device login** — OAuth device-authorization flow with readable codes, a
  15-minute TTL, single-pickup tokens, and per-machine revocation.
- **Portal** — catalog with search and facets, skill detail with a "what Claude
  reads" view and full history, editor with preview, review queue, collections,
  people and adoption stats, and a setup page with per-machine revocation.
- **Onboarding** — a self-hosted `/install.sh` that installs the CLI, records the
  server and hands over to `shkills login`. Idempotent.
- **Deployment** — a two-stage Dockerfile and a Compose file. One container, one
  SQLite file.
- **Seed data** — a sample company with 5 people, 9 skills, 4 collections,
  linked machines and 3 proposals waiting in the review queue.
- **Documentation** — fourteen guides in [`docs/`](docs/), covering getting
  started, concepts, architecture, the portal, the CLI, skill authoring,
  deployment, security, the API, the data model, troubleshooting,
  development, the acceptance criteria and how they are tested.
- **Tests** — 119 across the three packages, including the sync engine's
  ownership rules, the hook's idempotency, and the approval workflow's state
  guards.
- **Acceptance criteria** — [58 numbered statements](docs/acceptance-criteria.md)
  of what Shkills promises, derived from the original brief, each recording
  where it came from.
- **Acceptance suite** — `packages/e2e`: 73 Cucumber scenarios covering every
  one of those criteria, tagged `@AC-n`, run by `npm run test:e2e`. Each
  scenario owns a server, a database, a browser context and a throwaway machine;
  the portal is addressed only through `data-testid`, and the propagation
  scenarios run the real CLI bundle and the literal `SessionStart` hook command
  out of the machine's own `settings.json`. A check fails the build if a
  criterion has no scenario, or a scenario claims one that does not exist.

### Fixed

- **Portal on a phone** — the sign-in page and the setup page scrolled sideways
  at 390 px, because a grid child and the install command could not shrink below
  their content. Found by the acceptance suite, which now checks every page.
- **The Copy button did nothing on a deployment without TLS.**
  `navigator.clipboard` exists only in a secure context, so on plain HTTP it is
  `undefined` and `writeText` threw into an empty `catch`. Copying now falls
  back to a selection copy, and says so instead of failing silently when a
  browser refuses both.
- **The installer named a hard-coded address, whichever one you used.**
  `/install.sh`, the install command in the portal and the device-link URL now
  answer with the address the caller actually reached, so a deployment with a
  NodePort *and* an ingress hostname works from either. `SHKILLS_PUBLIC_URL`
  remains the canonical fallback; `SHKILLS_PIN_PUBLIC_URL=true` restores the old
  behaviour. A Host header that is not a plain `host[:port]` is refused, because
  the value ends up inside a shell script.
- **`~/.shkills/config.json` was world-readable** on any machine set up by the
  installer, and it holds the device token: Node applies a `mode` only when it
  creates a file, so the CLI's `0600` never took effect on a file the installer
  had already written. It is now chmod-ed explicitly on every save.
- **Re-running the installer could not re-point a machine at a moved server**,
  despite being documented as the way to update. It writes the address on every
  run now, keeping the machine linked.
- **A fresh account got no `PATH` at all** — with no `.zshrc`, `.bashrc` or
  `.profile` to append to, the installer wrote nothing and then told you to open
  a new terminal. It creates `.profile`. A custom `SHKILLS_HOME` also got a
  `PATH` line pointing at `~/.shkills/bin` regardless.

### Added (installer)

- **`shkills set-host <url>`** — move a machine to a different Shkills address
  without unlinking it.
- **`SHKILLS_TRUST_PROXY`** — honour `X-Forwarded-Proto`/`-Host`, so generated
  URLs are `https://` when a proxy terminates TLS in front.
- The installer **runs the CLI it just downloaded** before trusting it, catching
  a truncated download or an error page saved as a script at install time.

### Added (recovering a lost password)

- **Password recovery**, built on one artefact: a single-use link that expires
  in an hour and is stored only as a SHA-256. Setting a password by any route
  retires that account's outstanding links.
- **Three ways the link reaches its owner**, so that a deployment is never
  without one. Emailed where `SHKILLS_SMTP_URL` is set; handed over by an
  administrator from a queue on the **People** page where it is not; and
  `reset-password` run inside the container for the administrator of a
  one-account deployment, who has nobody to ask.
- **Asking reveals nothing.** `POST /api/v1/auth/forgot` answers identically
  whether or not the address belongs to an account, and writes no record for one
  that does not. One request per account per minute.
- **Every session can now be ended at once**, by a per-account session epoch
  carried in the session token. A password reset and a password change both use
  it, and both re-issue a token for the browser doing it. Device tokens are
  deliberately unaffected — see
  [security](docs/security.md#recovering-a-lost-password).
- **A mail sender** with three transports: `smtp` (via nodemailer), `file` for
  trying the flow out, and `none`. A mail server that is down downgrades the
  request to the administrators' queue rather than losing the link.

