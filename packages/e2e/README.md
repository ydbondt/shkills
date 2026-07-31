# @shkills/e2e

The acceptance suite: one Cucumber scenario for every criterion in
[`docs/acceptance-criteria.md`](../../docs/acceptance-criteria.md), run against a
real server, a real browser and the real CLI bundle.

```bash
npm run test:e2e                       # from the repo root: builds, then runs everything
npx cucumber-js --tags "@AC-34"        # from here, once a build exists
```

Read [`docs/e2e-testing.md`](../../docs/e2e-testing.md) before adding one — it
covers the `data-testid` conventions, the whole step vocabulary, and how to read
a failure. The short version:

- Scenarios address the portal **only** through `data-testid`, never through
  visible text or CSS classes.
- Setup goes through the API; assertions go through the portal or the terminal.
- Each scenario owns its own server, database, browser context and machine.
- `Claude starts on the machine "x"` runs the literal `SessionStart` hook
  command out of that machine's `settings.json`.
