# Writing skills

A skill Claude never reaches for is worth nothing. This is about making it fire,
and making it useful once it does.

- [The description is the whole game](#the-description-is-the-whole-game)
- [One skill, one job](#one-skill-one-job)
- [Writing the instructions](#writing-the-instructions)
- [The SKILL.md format](#the-skillmd-format)
- [Field reference](#field-reference)
- [Proposing and reviewing](#proposing-and-reviewing)
- [A worked example](#a-worked-example)
- [Checklist](#checklist)

---

## The description is the whole game

Claude decides whether to use a skill from its description alone. Not the title,
not the body, not the tags — the description. Everything else only matters after
that decision has already been made.

So write it as a **trigger**, not a summary.

| ✗ | ✓ |
| - | - |
| `Our code review guidelines.` | `Use when reviewing a pull request or asked to review code, to apply the Acme review checklist and comment conventions.` |
| `Helps with commits.` | `Use when writing a git commit message or a pull request title, to follow the Acme conventional-commit format.` |
| `Incident stuff.` | `Use during a production incident or outage, to run the Acme incident process and write the postmortem.` |

The shape that works:

> **Use when** `<the concrete situation>`, **to** `<what it makes Claude do>`.

Name the situation in the words somebody would actually be using at the time —
"reviewing a pull request", "a prospect sends a security questionnaire" — not the
abstract category the skill belongs to.

The server enforces a 20-character minimum and tells you why:

> `description: a description is what makes Claude pick the skill — write at least a sentence`

## One skill, one job

If your description contains "and also", you have two skills.

Two narrow skills each fire reliably in their own situation. One broad skill
fires unpredictably in both and dilutes its own instructions. Split it.

Signs you should split:

- The trigger describes two different moments in time.
- Half the instructions are irrelevant to half the triggers.
- Two different departments would want different halves.

## Writing the instructions

Once Claude has picked the skill, the body is what it follows. Write it as
instructions to a capable colleague who does not know your conventions.

**Be concrete.** "Follow our style" is not actionable. A list of rules with
examples is.

**Show the output you want.** One worked example beats three paragraphs of
description. The seeded `commit-messages` skill spends most of its body on a
single example commit, and that is the right ratio.

**Say what not to do**, where it is a real trap. "Explain *why* in the body, not
*what* — the diff already says what."

**Keep it as short as it can be.** Every sentence competes for attention with
every other sentence.

**Structure it.** Headings, numbered steps, and tables all survive the round trip
to Claude intact. Markdown is fully supported.

## The SKILL.md format

Shkills renders this for you — you never write frontmatter by hand — but knowing
the output helps.

````markdown
---
name: commit-messages
description: "Use when writing a git commit message or a pull request title, to follow the Acme conventional-commit format."
---

# Commit Messages

Write every commit subject as `type(scope): summary`.

**Types** — `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `chore`.

**Rules**
- Keep the subject under 72 characters, in the imperative mood ("add", not "added").
- Scope is the package or service name, lowercase.
- Explain *why* in the body, not *what* — the diff already says what.
- Reference the Jira ticket on its own trailing line: `Refs: ACME-1234`.

**Example**

```
fix(billing): stop double-charging annual renewals

Renewals ran through both the scheduler and the webhook path when a
customer upgraded mid-cycle. Make the webhook the only writer.

Refs: ACME-4821
```

---

<!-- Managed by Shkills. Category: engineering · Version: 1 · Audience: engineering · Tags: git, conventions -->
<!-- Local edits are overwritten on the next sync. Propose changes in the Shkills portal. -->
````

- `name` is the slug, which is also the directory name.
- `user-invocable: true` appears only when the box is ticked.
- `allowed-tools` appears only when set.
- The trailing comments are metadata for humans. Claude ignores them; anyone who
  opens the file learns where it came from.

You can see this for any skill at any time — the **What Claude reads** tab in the
portal, `shkills show <name>` in the terminal, or `GET /api/v1/skills/:slug/raw`.

## Field reference

| Field | Limits | Notes |
| ----- | ------ | ----- |
| **Name** (slug) | `^[a-z0-9]+(?:-[a-z0-9]+)*$`, unique | Fixed after creation. Becomes `~/.claude/skills/<slug>/`. |
| **Title** | 2–120 chars | What people see in the catalog. |
| **Description** | 20–1024 chars | The trigger. Get this right. |
| **Category** | 1–40 chars | One word. Drives the filter chips. |
| **Audiences** | ≤ 12 entries | For finding it, not for access control. |
| **Tags** | ≤ 24 entries | Free-form, searchable. |
| **Instructions** | 20–120 000 chars | Markdown. |
| **User-invocable** | boolean | Adds a `/<slug>` command *as well as* automatic triggering. |
| **Allowed tools** | ≤ 400 chars | Passed through to the `allowed-tools` frontmatter key. |
| **Change note** | ≤ 400 chars | What you changed and why. The reviewer reads this first. |

## Proposing and reviewing

**As an author**

1. Write it in the portal editor. Use **Preview** to check the rendering.
2. Fill in the change note. "Initial version" is fine for v1; after that, say
   what changed and why — it is the first thing a reviewer reads.
3. Submit. Your proposal sits as `pending`; the currently live version keeps
   serving everybody in the meantime.

**As a reviewer**

Read the description first and ask the only question that matters: *would this
fire at the right moment, and only at the right moment?* Then read the body.

- Approve → published to every subscribed machine on their next session.
- Decline → requires a reason, which the author sees. Say what would make it
  approvable.

Curators publish their own work directly. Use *"send for review instead"* when
the change is significant enough to want a second pair of eyes — a shared
convention changing under everyone is exactly that kind of change.

**Rolling something back**

Open the skill, go to **History**, and roll back to a previous version. It
becomes live again and every machine returns to it on the next sync. Nothing is
deleted, and the rollback is recorded in the audit log.

## A worked example

Somebody keeps writing inconsistent incident postmortems. Here is a skill for it.

**Name** `incident-response`

**Description**

> Use during a production incident or outage, to run the Acme incident process
> and write the postmortem.

Note what it does *not* say: nothing about "reliability", "SRE" or "best
practices". It names the moment — a production incident — in the words somebody
in one would use.

**Instructions** — concrete steps, in the order they happen, with the output
format spelled out:

```markdown
## While it is happening

1. Declare it in `#incidents` with severity and a one-line impact statement.
2. Name an incident lead. The lead does not debug — they coordinate.
3. Mitigate before you diagnose. Roll back first, understand later.

## Afterwards, within two working days

Write the postmortem with these headings, in this order:

**Impact** — who was affected, how many, for how long. Numbers, not adjectives.
**Timeline** — UTC, first anomaly to full recovery.
**Cause** — the chain, not the last link.
**What we are changing** — each item with an owner and a date, or it does not go in.

Never name an individual as a cause.
```

**Category** `engineering` · **Audiences** `engineering` ·
**Tags** `oncall`, `postmortem`

**Where it goes** — the *Engineering* collection, so every engineer gets it
without deciding to.

## Checklist

Before you submit:

- [ ] The description starts with **"Use when…"** and names a concrete situation.
- [ ] It contains no "and also".
- [ ] The title reads well in a list next to twenty others.
- [ ] The body has at least one worked example.
- [ ] Someone who has never seen your team's conventions could follow it.
- [ ] The change note says what changed and why.
- [ ] You previewed it.
- [ ] It belongs in a collection — otherwise nobody will find it.
