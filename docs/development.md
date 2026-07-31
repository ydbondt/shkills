# Development

How the repo is laid out, how to run it, and how to land a change.

- [Setup](#setup) · [Repo layout](#repo-layout) · [Scripts](#scripts)
- [Tests](#tests) · [Adding an endpoint](#adding-an-endpoint)
- [Working on the CLI](#working-on-the-cli) · [Working on the portal](#working-on-the-portal)
- [House style](#house-style) · [Sending a change](#sending-a-change)

---

## Setup

Node 20+. Nothing else.

```bash
git clone https://github.com/ydbondt/shkills.git
cd shkills
npm install
npm run seed
```

Then run the API and the portal separately so both hot-reload:

```bash
npm run dev -w @shkills/server    # :4000, tsx watch
npm run dev -w @shkills/web       # :5173, proxies /api → :4000
```

Browse to <http://localhost:5173> and sign in as `maya@acme.test` /
`shkills123`.

To exercise the CLI without touching your real Claude setup:

```bash
export SHKILLS_HOME="$PWD/.demo/shkills"
export CLAUDE_CONFIG_DIR="$PWD/.demo/claude"
node packages/cli/dist/shkills.mjs login --host http://localhost:4000
```

## Repo layout

```
packages/
├── server/                  Express + SQLite
│   ├── src/
│   │   ├── app.ts           Route wiring, static SPA, 404 and error handling
│   │   ├── auth.ts          Credentials, roles, password and token hashing
│   │   ├── config.ts        Environment → config, JWT secret resolution
│   │   ├── db.ts            Schema (CREATE TABLE IF NOT EXISTS) + audit()
│   │   ├── http.ts          h(), parse(), param(), errorHandler
│   │   ├── skill-format.ts  renderSkillMd(), checksum(), manifestChecksum()
│   │   ├── seed.ts          The sample company
│   │   ├── routes/          One file per resource
│   │   └── services/        skills.ts (workflow), sync.ts (effective set)
│   └── data/                SQLite lives here (gitignored)
├── cli/
│   └── src/
│       ├── index.ts         Argv parsing and dispatch
│       ├── api.ts           fetch wrapper, ApiError
│       ├── paths.ts         Where config, state and skills live
│       ├── hook.ts          SessionStart hook install/remove
│       ├── sync-engine.ts   The pure function that decides what to write
│       ├── ui.ts            Colour, headings, two-column rows
│       └── commands/        login, setup, sync, catalog
└── web/
    └── src/
        ├── App.tsx          Routes
        ├── Shell.tsx        Nav and layout
        ├── api.ts           Typed fetch client
        ├── state.tsx        Session, useAsync, toasts
        ├── markdown.ts      Small Markdown renderer for skill bodies
        ├── components.tsx   Shared primitives
        └── pages/           One file per screen
```

Two rules worth knowing before you move code around:

- **`renderSkillMd` lives on the server.** The CLI receives finished bytes. That
  is what lets the `SKILL.md` format change without a client upgrade — see
  [How it works](how-it-works.md#why-the-server-renders-skillmd).
- **`sync-engine.ts` is a pure function over a directory listing.** It takes the
  remote skill list and local state and returns an outcome plus the next state.
  That is why it is straightforward to test, and it should stay that way.

## Scripts

From the repo root:

| Command | Does |
| ------- | ---- |
| `npm run build` | CLI → web → server, in that order (the server serves the other two) |
| `npm test` | Every workspace |
| `npm run typecheck` | `tsc --noEmit` across all three |
| `npm run seed` | Sample company. Refuses a non-empty database without `--force` |
| `npm start` | The built server |

Per workspace, add `-w @shkills/server` (or `cli` / `web`).

## Tests

**62 tests** across three packages, all with vitest.

```bash
npm test
npm test -w @shkills/server
npx vitest watch -w @shkills/server
```

| Suite | Covers |
| ----- | ------ |
| `server/src/approval.test.ts` | Propose → approve → reject → rollback, and the state guards on each |
| `server/src/catalog.test.ts` | Search, filters, facets, archive and restore |
| `server/src/device.test.ts` | The whole device-login flow, single-pickup tokens, revocation |
| `server/src/sync.test.ts` | Effective skill set, manifest stability, 304 behaviour |
| `cli/src/sync-engine.test.ts` | Install, update, remove, and **never touching unmarked directories** |
| `cli/src/hook.test.ts` | Hook install, idempotency, removal, malformed settings |
| `cli/src/bundle.test.ts` | The built bundle runs, has no runtime deps, and prints usage |
| `web/src/markdown.test.ts` | The Markdown renderer, including escaping |

Server tests use supertest against a real app instance and a real SQLite file —
`src/test/setup.ts` gives each test file its own database, so files stay
independent under parallel workers. `src/test/helpers.ts` has `resetDb`,
`makeUser`, `login` and a `sampleSkill`.

CLI tests run against the **built bundle**, so `npm test -w @shkills/cli` builds
first. That catches bundling regressions, which is the failure mode that actually
happens.

Anything that changes the sync engine, the hook, or the approval workflow needs a
test. Those three are where a bug reaches every machine in the company.

## Adding an endpoint

The pattern, end to end:

```ts
// packages/server/src/routes/skills.ts
const inputSchema = z.object({
  note: z.string().min(1, 'tell the author why').max(400),
});

skillsRouter.post(
  '/versions/:id/reject',
  requireAuth,
  requireRole('curator'),
  h((req, res) => {
    const version = getVersion(Number(param(req, 'id')));
    if (!version) throw new DomainError('no such version', 404);
    const body = parse(inputSchema, req.body ?? {});
    rejectVersion(req.user!, version, body.note);
    res.json({ ok: true });
  }),
);
```

- `h()` wraps the handler so a rejected promise reaches the error middleware.
- `parse()` turns a zod failure into a `422` whose message reads
  `field: what went wrong`.
- `DomainError(message, status)` is how you return anything else. The message is
  shown to the user, so write it as a sentence.
- `param()` narrows Express 5's `string | string[]` route params.
- Business rules belong in `services/`, not in the route. Routes validate,
  authorise and serialise.
- Call `audit()` for anything that changes state.

Then add a test, and a row in [`docs/api.md`](api.md).

## Working on the CLI

```bash
npm run build -w @shkills/cli      # esbuild → dist/shkills.mjs
node packages/cli/dist/shkills.mjs status
```

The bundle must stay **dependency-free** — it is downloaded and run directly from
a directory with no `package.json`. `bundle.test.ts` enforces this. Node's
standard library only.

Output goes through `ui.ts`. Use `say`, `warn`, `fail`, `heading` and `rows`
rather than `console.log`, so `--quiet` and `NO_COLOR` keep working.

**Sync must never fail loudly.** Every error path in `sync()` warns and returns
`0`. It runs on the critical path of starting Claude; a Shkills problem must not
become a Claude problem.

## Working on the portal

React 19, React Router 7, Tailwind 4, Vite 6.

- `api.ts` is the only place that talks to the server.
- `useAsync` handles the loading / error / data triad; `useToast` for feedback.
- Styling is Tailwind utilities plus a small set of semantic classes in
  `styles.css` (`card`, `chip`, `btn`, `field`, `t-hero`, `t-title`, `t-meta`,
  `terminal`, `rise`). Prefer an existing class over a new pile of utilities.
- Every page should read well at 414 px wide.

## House style

- **TypeScript, strict.** No `any` that a type would fix.
- **Comments explain why, never what.** The existing code is a good sample: they
  justify decisions, name the failure that motivated them, or point at the
  invariant being protected.
- **Error messages are sentences shown to humans.** `'a skill named "x" already
  exists'`, not `'ERR_DUP_SLUG'`.
- **Prepared statements only.** No string interpolation into SQL, ever.
- **Small files, clear names.** One resource per route file, one screen per page
  file.

Run `npm run typecheck && npm test` before you push.

## Sending a change

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the full version. Briefly:

1. Branch off `main`.
2. Make the change, with a test.
3. `npm run typecheck && npm test`.
4. Update the docs in the same commit — `docs/api.md` for an endpoint,
   `docs/cli.md` for a command, `docs/data-model.md` for a schema change.
5. Open a PR that says what changed and why.
