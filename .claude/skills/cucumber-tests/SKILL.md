---
name: cucumber-tests
description: "Use when writing, changing or debugging an acceptance test in this repo — Cucumber scenarios, Gherkin, .feature files, step definitions, @AC- tags, acceptance criteria, or a failing npm run test:e2e. Also use before adding new user-visible behaviour, which needs a criterion and a scenario before it is done."
---

# The Cucumber suite

Unit tests say the parts work. This suite says the product works: real server,
real browser, real CLI. Scenarios are written to read as the promise being made,
not as the code being called.

[`docs/e2e-testing.md`](../../../docs/e2e-testing.md) is the reference — the full
step vocabulary, the wiring, the debugging recipes. Read it when you need a step.
What follows is only the part that is easy to get wrong.

## The criterion comes first

`docs/acceptance-criteria.md` is the specification; the features are the proof.
New user-visible behaviour is not done until both exist.

1. Add the criterion to `docs/acceptance-criteria.md`, in the right section's
   table, as **`| **AC-n** | … | P |`**. The id must be **bold** — the coverage
   check greps for `\*\*(AC-\d+)\*\*` and will not see it otherwise.
2. Tag the scenario `@AC-n` in the feature file for its area.

`npm run test:e2e -w @shkills/e2e` runs `check-coverage.mjs` *before* Cucumber,
so an unclaimed criterion or a tag pointing at a criterion that does not exist
fails the run without executing a single scenario. It checks both directions on
purpose: a mapping that has rotted quietly is worse than no mapping.

## Writing the scenario

**Set up through the API, assert through the interface a person uses.** `Given
these people:`, `… has published the skill …`, `a collection … containing:` put
the world in position. The portal and the terminal are for the thing the
scenario is actually about. Clicking a fixture into place turns every scenario
into a page tour and buries the point.

**Reuse the existing steps.** All of them are generic; there is not one
per-page step definition in the suite. Needing a new one is a red flag that
usually means the scenario is describing mechanics instead of behaviour. Earn it
the way `Claude starts on the machine "laptop"` did — by naming something real —
never to work around a test id you did not want to add.

**Address the portal through `data-testid` and nothing else.** Never a CSS
class, never visible text. Shapes: `area-thing`, `thing-{slug}`,
`action-{slug}`, and `data-*` for state. Prefer
`Then "…" is marked "subscribed" as "true"` over asserting on the word
"Installed" — the button can then be renamed without a test edit, and the
assertion says what it means. Shared components (`Chip`, `Empty`, `ErrorNote`,
`Modal`, `StatusBadge`, `Markdown`, `CopyButton`) take a `testId` prop, so
labelling one needs no wrapper `div`.

**Tag `@with-a-mail-server` if the scenario needs email.** It is a tag and not a
`Given` because the transport is chosen when the server process starts.
Untagged means a Shkills that cannot send mail — which is what a freshly
stood-up deployment is, and the case the administrator queue exists for.

## Running and debugging

```bash
npm run test:e2e                      # builds everything first, ~4 min
cd packages/e2e
npx cucumber-js --tags "@AC-34"       # one criterion, once a build exists
PWDEBUG=1 npx cucumber-js --tags "@AC-34"   # watch it happen
open packages/e2e/reports/e2e.html    # URL, screenshot and server output
```

Reproduce with `--tags` before changing anything — every scenario gets its own
server, database, browser context and machines, so one always runs alone.

If a step needed `waitForTimeout` to pass, do not keep it. The fix is almost
always a missing `data-testid` on the thing you are really waiting for.

## Never

- Never add user-visible behaviour without a criterion and a scenario claiming it.
- Never assert on visible text or a CSS class where a `data-testid` would do.
- Never add a step definition to avoid adding a test id.
- Never delete or retag a criterion to make the coverage check pass.
