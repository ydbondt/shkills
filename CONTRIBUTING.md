# Contributing to Shkills

Thanks for taking a look. Issues and pull requests are both welcome.

## Before you start

For anything larger than a bug fix, open an issue first and say what you have in
mind. It is much cheaper to disagree about an approach in a paragraph than in a
diff.

Good first contributions:

- Fixing something in the docs that is wrong or unclear.
- A test for an edge case that is not covered.
- A troubleshooting entry for a problem you actually hit.

## Setup

Node 20+. Nothing else.

```bash
git clone https://github.com/ydbondt/shkills.git
cd shkills
npm install
npm run seed

npm run dev -w @shkills/server    # :4000
npm run dev -w @shkills/web       # :5173
```

Sign in at <http://localhost:5173> as `maya@acme.test` / `shkills123`.

See [docs/development.md](docs/development.md) for the repo layout and how the
pieces fit together.

## Making a change

1. **Branch off `main`.**
2. **Write a test.** Not optional for anything touching the sync engine, the
   `SessionStart` hook, or the approval workflow — those three are where a bug
   reaches every machine in the company.
3. **Run the checks.**
   ```bash
   npm run typecheck
   npm test
   ```
4. **Update the docs in the same commit.**
   - A new or changed endpoint → [`docs/api.md`](docs/api.md)
   - A new or changed command → [`docs/cli.md`](docs/cli.md)
   - A schema change → [`docs/data-model.md`](docs/data-model.md)
   - A new screen → [`docs/portal.md`](docs/portal.md)
5. **Open a pull request** that says what changed and why.

## House style

The existing code is the specification. A few things worth stating explicitly:

- **TypeScript, strict.** No `any` that a type would fix.
- **Comments explain *why*, never *what*.** Justify a decision, name the failure
  that motivated it, or point at the invariant being protected. If a comment
  restates the line below it, delete the comment.
- **Error messages are sentences you could show a user.**
  `'a skill named "x" already exists'`, not `'ERR_DUP_SLUG'`.
- **Prepared statements only.** No string interpolation into SQL, ever.
- **Business rules live in `services/`.** Routes validate, authorise and
  serialise.
- **Call `audit()`** for anything that changes state.
- **CLI output goes through `ui.ts`** — `say`, `warn`, `fail`, `heading`, `rows`
  — so `--quiet` and `NO_COLOR` keep working.
- **The CLI bundle stays dependency-free.** It is downloaded and run from a
  directory with no `package.json`. `bundle.test.ts` enforces this.

## Invariants — please do not break these

These are load-bearing. If a change requires breaking one, that is the
conversation to have in the issue, not in the PR.

1. **Sync never modifies or deletes a directory Shkills did not create.**
   Marker-file ownership, checked on every write and every delete. Losing
   somebody's hand-written skill to a name collision is worse than a company
   skill failing to install.

2. **Sync never fails loudly.** Every error path warns and exits `0`. It runs on
   the critical path of starting Claude; a Shkills outage must not become a
   Claude outage.

3. **A review in flight never takes the live skill away from anyone.** Proposing
   v4 leaves v3 published until somebody approves.

4. **The server renders `SKILL.md`.** The CLI writes bytes it was given. This is
   what lets the format evolve without a client upgrade.

5. **The last active admin cannot be demoted or deactivated.**

6. **Only SHA-256 hashes of device tokens are stored.**

## Reporting bugs

Include:

- What you did, what you expected, what happened.
- `shkills status` output if it is CLI-side.
- Server logs if it is server-side.
- Node version and OS.

## Reporting security issues

Please **do not** open a public issue. See [SECURITY.md](SECURITY.md).

## Code of conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

Contributions are accepted under the [MIT License](LICENSE).
