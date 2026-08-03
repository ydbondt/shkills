---
name: roadmap
description: "Use when working the Shkills roadmap — picking up the next ticket, starting the next roadmap item, asking what to work on next, or finishing and closing out a roadmap ticket. Triggers on \"next roadmap ticket\", \"work the roadmap\", \"what's next\", \"pick up the next item\"."
---

# Working the Shkills roadmap

The roadmap is GitHub project [ydbondt/projects/4](https://github.com/users/ydbondt/projects/4).
Tickets are issues in `ydbondt/shkills`. Work them **one at a time, in board
order, top to bottom**.

Statuses: `Proposed` → `Planned` → `In Progress` → `Done`. Only `Planned`
tickets are yours to start. `Proposed` has not been agreed yet — leave it alone.

## Before you touch anything: two things that bite

**Board order is the priority decision — do not re-litigate it.** The top
`Planned` row is the next ticket, full stop. Do not sort by issue number, age or
label. `gh project item-list` returns board order, not issue order (issue #2
currently sorts above #1); trust it.

**Finishing a ticket ships it.** Every push to `main` builds and rolls out to
the homelab cluster, and the Deployment uses `Recreate`, so the rollout is a
short outage. Run the checks before you push, not after. See the
`shkills-operations` skill if the rollout misbehaves.

## 1. Reconcile before picking

Never start a second ticket while one is `In Progress`.

```bash
gh project item-list 4 --owner ydbondt --format json \
  -q '.items[] | select(.status=="In Progress") | {id, number: .content.number, title}'
```

Anything returned? Resume it instead of starting something new — check for a
local branch `issue-<n>-*` and pick up where the last run stopped. Only when
this returns nothing do you move on.

## 2. Pick the top Planned ticket

```bash
gh project item-list 4 --owner ydbondt --format json \
  -q '[.items[] | select(.status=="Planned")][0]
      | {id, number: .content.number, title, url: .content.url}'
```

Empty output means the roadmap is clear. Say so and stop — do not go hunting for
work in `Proposed` or in the issue tracker.

Read the **whole** issue body before doing anything else. These issues carry an
"Invariants" checkbox referring to the seven load-bearing invariants in
`CONTRIBUTING.md`. If the ticket needs one of them broken, that is a
conversation to have with the user, not a decision to make in a diff.

## 3. Move it to In Progress and branch

```bash
gh project item-edit --id <item-id> \
  --project-id     PVT_kwHOAAZyY84BfR-Q \
  --field-id       PVTSSF_lAHOAAZyY84BfR-QzhZl9LA \
  --single-select-option-id 47fc9ee4

git checkout main && git pull
git checkout -b issue-<n>-<slug>          # slug: lowercase, hyphens, ~5 words
gh issue comment <n> --repo ydbondt/shkills --body "Starting work on this."
```

Status option IDs: `Proposed` `80b3729a` · `Planned` `f75ad846` ·
`In Progress` `47fc9ee4` · `Done` `98236657`. If the project is ever rebuilt,
regenerate them with `gh project field-list 4 --owner ydbondt --format json`.

## 4. Implement

Use `superpowers:brainstorming` first, `superpowers:writing-plans` if the ticket
touches more than one file, and `superpowers:test-driven-development` for the
code.

`CONTRIBUTING.md` is the authority on how a change is made here — the house
style, the invariants, which docs must move with the code, and the rule that new
behaviour needs an entry in `docs/acceptance-criteria.md` plus a Cucumber
scenario claiming it. Read it; do not rely on this skill restating it.

## 5. Finish

Run the checks, and read the output rather than assuming:

```bash
npm run typecheck
npm test
npm run test:e2e    # if you touched the portal, the CLI or the sync path
```

Then commit, merge to `main` and push. **This roadmap does not use pull
requests** — a deliberate exception to `CONTRIBUTING.md` step 6, which asks for
one.

```bash
git checkout main && git merge --no-ff issue-<n>-<slug> && git push
gh issue close <n> --repo ydbondt/shkills --reason completed
```

Finally set the ticket to `Done` (option `98236657`, same `item-edit` command as
step 3), and report what shipped.

## Never

- Never start a ticket while another is `In Progress`.
- Never push with a failing or unrun check — the push is a deploy.
- Never mark `Done` before the push lands. `Done` on this board means it is on
  `main` and rolled out, not "finished locally".
