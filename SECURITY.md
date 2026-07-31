# Security policy

## Reporting a vulnerability

**Please do not open a public issue.**

Report privately through GitHub's
[private vulnerability reporting](https://github.com/ydbondt/shkills/security/advisories/new)
for this repository. That gives us a private thread and a coordinated disclosure
path.

Please include:

- What the issue is, and which component (server, CLI, portal).
- How to reproduce it, ideally as concretely as possible.
- What an attacker could achieve, and what they would need to start with.
- The version or commit you tested.

You can expect an acknowledgement within a few days, and an assessment with a
plan shortly after. If a fix ships, you will be credited in the release notes
unless you would rather not be.

## Scope

**In scope**

- Authentication and authorisation bypass.
- Device-token handling — issuing, storing, revoking.
- Anything that lets a non-curator publish a skill.
- Anything that lets the CLI write outside the directories it owns.
- Injection of any kind, or path traversal.
- Session handling.

**Known and documented, not a report**

These are deliberate gaps, listed in
[docs/security.md](docs/security.md#threat-model):

- No rate limiting — put it at your reverse proxy.
- No SSO, MFA or password reset.
- No security headers or CSP — add them at your proxy.
- Device tokens do not expire; they are revoked explicitly.
- Every signed-in user can read every skill. Audiences are for finding things,
  not access control.
- The SQLite file is not encrypted at rest.
- A compromised curator account can publish to every machine. That is what the
  role means; the audit log is the mitigation.

If you can show one of these being *worse* than documented, that is very much
worth reporting.

## Deploying safely

The [hardening checklist](docs/security.md#hardening-checklist) is the short
version. The essentials:

- TLS in front, always. Device tokens are bearer tokens.
- `NODE_ENV=production` so session cookies are `Secure`.
- `SHKILLS_JWT_SECRET` set explicitly, from your secret store.
- Create the first admin account **before** sharing the URL — the first account
  created on a fresh database becomes the administrator.
- Keep the curator list short, and hold company-default collections to a higher
  bar than anything else in the system.

## Supported versions

Shkills is pre-1.0. Fixes land on `main`; please test against `main` before
reporting.
