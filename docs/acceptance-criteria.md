# Acceptance criteria

Shkills was specified in prose, not in tickets. This file turns that prose into
numbered, checkable statements so that "it works" means something specific.

Every criterion below is covered by at least one Cucumber scenario in
[`packages/e2e`](../packages/e2e), tagged with its id (`@AC-12`). Running

```bash
npm run test:e2e
```

executes all of them against a real server, a real browser and the real CLI.
See [e2e testing](./e2e-testing.md) for how the suite is put together.

Where a criterion came from is recorded, because the wording of the original
request is the only authority we have:

- **P** — the product brief: *"A web based management portal to manage and share
  skills in a company … the goal is a central skill maintenance platform that is
  one-time config, and then everyone uses the same skills."*
- **D** — the deployment brief: *"Deployed to k3s … no secrets in the public repo."*
- **V** — the verification brief: *"Install shkills on this machine … change
  skills etc to prove that it works."*
- **I** — the installer brief: *"Install script does not work very well. It is
  not referencing to the correct url (IP instead of hostname). And the copy
  button doesnt work. Thoroughly review it."*
- **R** — the recovery brief: *"A user should be able to recover their password
  when lost."*

---

## Accounts and access

| # | Criterion | From |
| --- | --- | --- |
| **AC-1** | A person can create an account with their work email and sign in to the portal. The first account created on a new instance becomes the administrator. | P |
| **AC-2** | The portal is unusable while signed out: any page redirects to sign-in, and the page that was asked for is still reached after signing in. | P |
| **AC-3** | Signing in with the wrong password is refused and says so. | P |
| **AC-4** | A member can propose skills but sees no review queue and no people administration. | P |
| **AC-5** | A curator sees the review queue, and can see who is in the company without being able to change anyone. Only an administrator can change somebody's role. | P |
| **AC-6** | A member cannot approve a proposal even by going straight to the API. | P |

## Writing a skill

| # | Criterion | From |
| --- | --- | --- |
| **AC-7** | A skill carries everything Claude needs — a name, a title, a trigger description, instructions — plus the extra data the company needs: category, audiences, tags, and whether people may invoke it by name. | P |
| **AC-8** | The portal shows the exact file that will be written to `~/.claude/skills/<name>/SKILL.md`, including its frontmatter. | P |
| **AC-9** | A skill's instructions can be previewed as rendered Markdown while writing it. | P |

## Proposal and approval

| # | Criterion | From |
| --- | --- | --- |
| **AC-10** | A member proposes a skill; it lands in the review queue and reaches nobody until it is approved. | P |
| **AC-11** | A curator approves a proposal and it becomes the live version, visible in the catalog. | P |
| **AC-12** | A curator declines a proposal with a note; the skill is not published, and the note is recorded against that version for the author to read. | P |
| **AC-13** | A curator publishes their own change directly, without queueing it. | P |
| **AC-14** | A curator may still send their own change for review instead of publishing it. | P |
| **AC-15** | While a change to an existing skill is in review, the currently published version keeps serving unchanged. | P |

## Updating, rolling back, removing

| # | Criterion | From |
| --- | --- | --- |
| **AC-16** | Editing a published skill creates a new version; the history lists every version with its status and author. | P |
| **AC-17** | A curator can roll back to an earlier version, which becomes live again. | P |
| **AC-18** | A curator can archive a skill after confirming, and restore it afterwards. | P |
| **AC-19** | Every change to a skill, collection or person is recorded in an audit trail. | P |

## Finding and choosing skills

| # | Criterion | From |
| --- | --- | --- |
| **AC-20** | The catalog can be searched by free text and filtered by category. | P |
| **AC-21** | A person can subscribe to a single skill and unsubscribe again. | P |
| **AC-22** | "Mine" filters the catalog down to what that person is subscribed to. | P |

## Collections — a whole role's worth of skills

| # | Criterion | From |
| --- | --- | --- |
| **AC-23** | A curator can create a collection and put skills in it. | P |
| **AC-24** | Joining a collection subscribes the person to everything in it. | P |
| **AC-25** | A skill added to a collection later reaches everyone who already joined it, with no further action from them. | P |
| **AC-26** | A collection marked "install for everyone" is applied to every person and cannot be opted out of. | P |
| **AC-27** | "Your setup" shows the effective skill set — skills and collections combined, de-duplicated, with the reason each skill is there. | P |

## Onboarding: one command, then nothing

| # | Criterion | From |
| --- | --- | --- |
| **AC-28** | The portal shows a single install command, and the server actually serves that installer and the CLI bundle it downloads. | P, D |
| **AC-29** | A machine is linked by approving a short code in the portal, which names the machine asking. | P |
| **AC-30** | The approval can be refused, and a refused code cannot then be used. | P |
| **AC-31** | Linking a machine installs a `SessionStart` hook into the Claude settings, so skills refresh on their own from then on. Existing settings are left intact. | P |
| **AC-32** | Linked machines are listed, and revoking one stops it syncing immediately. | P |

## Propagation — the central claim

| # | Criterion | From |
| --- | --- | --- |
| **AC-33** | Linking a machine writes the person's skills to `~/.claude/skills/<name>/SKILL.md`. | P, V |
| **AC-34** | Publishing a new version centrally rewrites the file on the machine at the next sync. | P, V |
| **AC-35** | When nothing has changed, a sync is a cheap no-op (the server answers 304 and no file is touched). | P |
| **AC-36** | Subscribing to a skill or joining a collection in the portal puts it on the machine at the next sync. | P, V |
| **AC-37** | Rolling a skill back centrally restores the earlier file on the machine. | V |
| **AC-38** | Archiving a skill centrally removes it from the machine; restoring it brings it back. | V |
| **AC-39** | A hand-written skill of the same name is never overwritten or deleted — the sync skips it, warns, and still succeeds. | P, V |
| **AC-40** | Deleting the Shkills marker from a directory hands ownership back: Shkills stops touching it. | V |
| **AC-41** | A Shkills server that is down or unreachable never blocks a Claude session — the hook command still exits 0. | P |
| **AC-42** | Revoking a machine in the portal stops that machine syncing, without touching anyone else's. | P |

## The portal itself

| # | Criterion | From |
| --- | --- | --- |
| **AC-43** | Every page works at phone width without the page scrolling sideways. | P |
| **AC-44** | The portal is usable in both light and dark colour schemes. | P |
| **AC-45** | The service reports its health, so a container orchestrator can tell whether it is up. | D |
| **AC-46** | Copying the install command works on a plain-HTTP deployment, where the browser offers no clipboard API — and if a browser refuses outright, the button says so instead of doing nothing. | I |

## Naming the right address

One deployment is reachable at several addresses — a NodePort IP, a hostname
through an ingress, a port-forward to localhost. Naming the wrong one back is
not cosmetic: it is what an installed machine will talk to for ever after.

| # | Criterion | From |
| --- | --- | --- |
| **AC-47** | The install command shown in the portal, the script it serves, and the device-link prompt the CLI prints all name the address the person actually reached, not a hard-coded one. | I |
| **AC-48** | A Host header that is not a plain host cannot get into the served script; the configured URL is used instead. | I |
| **AC-49** | Re-running the installer re-points a machine that is still talking to an older address, without unlinking it. | I |
| **AC-50** | The installer leaves a machine that can run `shkills` — the CLI it downloaded executes, and the launcher is on the PATH of a new shell, even on an account with no shell rc files. | I |

## Getting back in

A password is lost from a signed-out browser, which is the one state in which
the portal can do nothing for you. So recovery has to work without an account,
without giving a stranger anything, and — on a deployment with no mail server,
which is the normal state of a homelab — without email.

| # | Criterion | From |
| --- | --- | --- |
| **AC-51** | Somebody who has forgotten their password can ask for a way back in from the sign-in page, without being signed in. | R |
| **AC-52** | The answer to that request is the same whether or not the address belongs to an account, so it cannot be used to ask who works here. | R |
| **AC-53** | The link sets a new password, signs the person in, and the old password stops working. | R |
| **AC-54** | A link that has been used, replaced or has expired is refused, and says so rather than failing silently. | R |
| **AC-55** | Resetting a password signs out every other session, so recovering an account actually takes it back. | R |
| **AC-56** | Where a mail server is configured, the link is emailed, and it names the address the person actually reached the portal on. | R |
| **AC-57** | Where none is, an administrator can see who is waiting and hand over a link that works. | R |
| **AC-58** | There is a way back in that needs neither a mail server nor a second account, for the administrator of a one-person deployment. | R |

---

## Deliberately not covered here

Some of what the project promises cannot honestly be asserted by an automated
test, and pretending otherwise would be worse than leaving it out:

- **"Steve Jobs" design quality.** AC-43 and AC-44 pin the two things that
  break objectively (overflow and colour scheme). Taste is reviewed by a human
  looking at [the screenshots](./portal.md).
- **The k3s deployment and its GitHub Actions pipeline.** They are verified by
  the pipeline running (`.github/workflows/deploy.yml`) and by the drills
  recorded in `deploy/k8s/README.md`, not from a test suite that would need a
  cluster to exist.
- **That the repo holds no secrets.** Checked at review time, and by the repo
  having no configured Actions secrets at all.
