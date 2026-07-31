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
- **Documentation** — twelve guides in [`docs/`](docs/), covering getting
  started, concepts, architecture, the portal, the CLI, skill authoring,
  deployment, security, the API, the data model, troubleshooting and
  development.
- **Tests** — 62 across the three packages, including the sync engine's
  ownership rules, the hook's idempotency, and the approval workflow's state
  guards.
