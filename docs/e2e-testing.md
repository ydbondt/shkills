# End-to-end tests

The unit tests say the parts work. This suite says the product works: it starts
a real server, drives a real browser and runs the real CLI, and it is written in
Cucumber so the scenarios read as the thing being promised rather than as code.

Every scenario is tagged with the acceptance criterion it covers
([`docs/acceptance-criteria.md`](acceptance-criteria.md)), and a check refuses to
run if a criterion has no scenario or a scenario claims one that does not exist.

- [Running it](#running-it) · [How a scenario is built](#how-a-scenario-is-built)
- [The test-id convention](#the-test-id-convention) · [The step vocabulary](#the-step-vocabulary)
- [Adding a scenario](#adding-a-scenario) · [How it is wired](#how-it-is-wired)
- [When one fails](#when-one-fails)

---

## Running it

```bash
npm run test:e2e            # builds everything, then runs all of it (~4 min)
```

From `packages/e2e`, once a build exists:

```bash
npm run test:e2e -w @shkills/e2e                     # the whole suite
npx cucumber-js --tags "@AC-34"                      # one criterion
npx cucumber-js --tags "not @AC-41"                  # everything but one
```

The browser is headless Chromium, installed by Playwright:

```bash
npx playwright install chromium     # once, if it is missing
```

## How a scenario is built

A scenario sets its starting position through the API and then asserts through
the interfaces a person actually uses — the portal, or the terminal. Clicking a
fixture into place would turn every scenario into a page tour and bury the one
thing it is about.

```gherkin
@AC-34
Scenario: A published change reaches the machine at the next Claude session
  Given "rob@acme.test" links the machine "laptop"
  And I note the skill "commit-messages" on the machine "laptop"
  When I open the skill "commit-messages"
  And I click "skill-edit"
  And I type into "editor-body":
    """
    Write every commit subject as type(scope): summary, under 72 characters.
    """
  And I click "editor-submit"
  And Claude starts on the machine "laptop"
  Then the skill "commit-messages" on the machine "laptop" says "under 72 characters"
  And the machine "laptop" knows "commit-messages" as version 2
```

Two things in there are worth pointing at:

- **"Claude starts on the machine"** reads the `SessionStart` hook out of that
  machine's `settings.json` and runs *that literal command*. It is not a stand-in
  for what Claude does — it is what Claude does.
- **"the machine"** is a throwaway HOME with its own `~/.shkills` and
  `~/.claude`, driven by the built CLI bundle. When a step says a skill arrived,
  a file arrived.

## The test-id convention

Steps address the portal through `data-testid` and nothing else — never a CSS
class, never visible text. Copy and layout can then change freely; a scenario
breaks only when behaviour breaks.

| Shape | Example | Used for |
| ----- | ------- | -------- |
| `area-thing` | `signin-email`, `review-queue` | A single thing on a page |
| `thing-{slug}` | `skill-card-code-review` | One row or card in a list |
| `action-{slug}` | `proposal-approve-code-review` | An action on that row |
| `data-*` attributes | `data-subscribed`, `data-status`, `data-role` | State that a label would otherwise have to imply |

The last one matters more than it looks. Asserting on `data-subscribed="true"`
rather than on the word "Installed" means the button can be renamed without a
test edit, and it makes the assertion say what it means.

Shared components (`Chip`, `Empty`, `ErrorNote`, `Modal`, `StatusBadge`,
`Markdown`, `CopyButton`) take an optional `testId` prop, so a caller can label
one without wrapping it in a marked `div`.

## The step vocabulary

All of it is generic — there is no per-page step definition anywhere.

**In the portal** (`src/steps/ui.steps.ts`)

| Step | |
| ---- | --- |
| `Given I am signed in as "maya@acme.test"` | Signs in through the form |
| `When I open the "review" page` | Named pages, not URLs |
| `When I open the skill "code-review"` | Also `the collection "…"` |
| `When I click "…"` | |
| `When I type "…" into "…"` | Also `When I type into "…":` with a doc string |
| `When I choose "…" in "…"` · `When I tick "…"` · `When I untick "…"` | |
| `Then I see "…"` · `Then I do not see "…"` | |
| `Then "…" says "…"` · `Then "…" does not say "…"` | Text contains |
| `Then "…" is marked "subscribed" as "true"` | Any `data-*` attribute |
| `Then I see a message saying "…"` | A toast |
| `Then the page does not scroll sideways` | |
| `Then the text is readable against the background` | Contrast ≥ 4.5:1 |
| `Given I reach the portal at "localhost"` | The same server by another of its names |
| `Given the browser has no clipboard API, as on a plain-HTTP server` | Removes `navigator.clipboard`, as a non-secure context does |
| `Then the clipboard holds what "install-command" shows` | Pastes it back with Ctrl+V — the system clipboard, not a spy |

**On a machine** (`src/steps/cli.steps.ts`)

| Step | |
| ---- | --- |
| `Given a machine called "laptop"` | A fresh HOME |
| `When "rob@acme.test" links the machine "laptop"` | Device code, approved in the browser |
| `When Claude starts on the machine "laptop"` | Runs the real `SessionStart` hook |
| `When the machine "laptop" syncs` · `When the machine "laptop" runs "shkills list"` | |
| `Then the machine "laptop" has the skill "…"` | Also `does not have`, `has exactly N skills` |
| `Then the skill "…" on the machine "laptop" says "…"` | |
| `When I note the skill "…" on the machine "…"` → `Then … is exactly as it was` | Byte-for-byte |
| `Then the command succeeds` · `Then the terminal says "…"` | |
| `When the machine "laptop" installs Shkills from "localhost"` | Runs the real `curl … \| sh`, from that address |
| `Then the machine "laptop" is pointed at "localhost"` | What its `config.json` will sync from |
| `Then the machine "laptop" is still linked` · `Then a new shell on "laptop" finds the installed shkills` | |
| `When "maya@acme.test" links the machine "laptop" from "localhost"` | Links through a different address than the default |
| `Then the link it printed points at the address that machine uses` | The device-link prompt follows the caller |

**Setting the scene** (`src/steps/setup.steps.ts`) — `Given these people:`,
`… has published the skill …`, `… has proposed the skill …`,
`a collection … containing:`, `a company-wide collection … containing:`,
`… has joined the collection …`, `… has added the skill …`.

## Adding a scenario

1. If it is new behaviour, add the criterion to
   [`acceptance-criteria.md`](acceptance-criteria.md) first. The list is the
   specification; the features are the proof.
2. Write the scenario in the feature file it belongs to, tagged `@AC-n`.
3. Add `data-testid` to whatever it needs to address, following the shapes above.
4. Reuse the steps. A new step definition is a small red flag: it usually means
   the scenario is describing mechanics instead of behaviour. Add one when it
   genuinely names something new (`Claude starts on the machine …` earned its
   keep), not to work around a missing test id.

## How it is wired

```
packages/e2e/
├── cucumber.mjs              Config: features, TS step definitions, reports
├── features/                 Gherkin, one file per area
├── scripts/check-coverage.mjs  Criteria ↔ tags, both directions
└── src/
    ├── hooks.ts              Browser once; server, database and HOME per scenario
    ├── world.ts              The scenario's world: server, page, people, machines
    ├── server.ts             Starts the built server on a free port, own SQLite
    ├── machine.ts            A throwaway laptop driven by the built CLI bundle
    ├── api.ts                Signed-in HTTP client, one per person
    └── steps/                ui · cli · setup · service
```

Each scenario gets **its own server process, its own empty database, its own
browser context and its own machines**. That costs a second or two per scenario
and buys the thing that matters at 4am: a failing scenario is failing on its own
terms, not on something the previous one left behind.

The server runs with `SHKILLS_PUBLIC_URL` on plain HTTP, exactly as the homelab
deployment does — which is also what decides whether the session cookie carries
`Secure`. A regression there once made the portal sign people in and out at the
same time; now a scenario would catch it.

## When one fails

A failed scenario attaches the URL it died on, a full-page screenshot and the
server's output to the report:

```bash
open packages/e2e/reports/e2e.html
```

To watch it happen instead:

```bash
cd packages/e2e
PWDEBUG=1 npx cucumber-js --tags "@AC-34"
```

Two habits worth keeping:

- Reproduce with `--tags` before changing anything. Scenarios are independent,
  so one always runs on its own.
- If a step needed a `waitForTimeout` to pass, the fix is almost always a missing
  `data-testid` on the thing you are actually waiting for.
