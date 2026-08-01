# API reference

Everything the portal and the CLI use is a documented endpoint. Nothing is
private.

- [Conventions](#conventions) · [Authentication](#authentication) · [Errors](#errors)
- [Health and install](#health-and-install)
- [Auth](#auth) · [Skills](#skills) · [Collections](#collections)
- [Subscriptions](#subscriptions) · [Sync](#sync)
- [Device login](#device-login) · [Tokens](#tokens) · [Admin](#admin)

---

## Conventions

- Base path: **`/api/v1`**. (`/api/health` is the one exception.)
- Request and response bodies are JSON. Bodies are capped at **2 MB**.
- Timestamps are SQLite `datetime('now')` strings in UTC (`YYYY-MM-DD HH:MM:SS`),
  except `generatedAt` on `/sync`, which is ISO 8601.
- `:slug` segments are lowercase words separated by single hyphens
  (`^[a-z0-9]+(?:-[a-z0-9]+)*$`).
- Role requirements are cumulative: an endpoint marked **curator** also accepts
  an admin.

## Authentication

Two credentials, both accepted everywhere:

**Session cookie** — `shkills_session`, a JWT, `httpOnly`, `sameSite=lax`,
`Secure` when `NODE_ENV=production`, 12-hour lifetime. Set by
`POST /api/v1/auth/login` and `/register`.

**Device token** — `Authorization: Bearer shk_<prefix>_<secret>`. Issued by the
device-login flow, stored server-side only as a SHA-256 hash, revocable
individually.

```bash
curl -H "Authorization: Bearer shk_4ff68dc8_…" \
     https://shkills.yourcompany.com/api/v1/sync
```

A `Bearer` value that is a JWT rather than an `shk_` token is also accepted.

Unauthenticated requests to a protected endpoint get `401`
`{"error":"authentication required"}`. An authenticated request without the
required role gets `403` `{"error":"requires curator role"}`.

## Errors

Every error is `{"error": "<a sentence you could show a user>"}`.

| Status | Meaning |
| ------ | ------- |
| `400` | Domain rule violated |
| `401` | Not signed in, or the token is unknown or revoked |
| `403` | Signed in, but not allowed |
| `404` | No such thing |
| `409` | Conflict — already exists, already used, wrong state |
| `410` | Expired (device-login codes) |
| `422` | Validation failed. The message is `field: what went wrong`. |
| `500` | Unhandled. Logged server-side; the body stays generic. |

---

## Health and install

### `GET /api/health`

No auth. `{"ok": true, "service": "shkills"}`. Used by the container healthcheck.

### `GET /install.sh`

No auth. The POSIX shell installer, with the server's public URL baked in.

### `GET /cli/shkills.mjs`

No auth. The CLI bundle. `503` if the workspace has not been built.

### `GET /cli/version`

No auth. `{ sha256, bytes, builtAt }` for the bundle currently being served.

---

## Auth

### `POST /api/v1/auth/login`

```json
{ "email": "maya@acme.test", "password": "shkills123" }
```

`200` `{ user }` and sets the session cookie. Wrong email and wrong password
return the same message — `incorrect email or password` — on purpose.

### `POST /api/v1/auth/register`

```json
{ "email": "…", "password": "…", "name": "…", "department": "engineering" }
```

`201` `{ user }` and signs you in. Passwords must be at least 8 characters.
**The first account created on a fresh database becomes `admin`;** everyone after
that is a `member`. `409` if the email is taken.

### `POST /api/v1/auth/logout`

Clears the cookie. `{"ok": true}`.

### `GET /api/v1/auth/me`

`{ user }` for the current credential, or `401`. This is how a device token
resolves to a person.

### `POST /api/v1/auth/password` — *auth*

```json
{ "current": "…", "next": "…" }
```

`403` if `current` is wrong. Signs out every other session and returns a fresh
cookie for this one.

### `POST /api/v1/auth/forgot`

```json
{ "email": "…" }
```

`202` `{ "ok": true, "delivery": "email" | "administrator", "expiresInMinutes": 60 }`.

**The answer never depends on whether the account exists** — same status, same
body, and no record is written for an address nobody uses. `delivery` describes
the *deployment*, not the account: `email` when a mail server is configured,
`administrator` when the link has to be handed over by a person. Asking again
within a minute quietly does nothing.

### `GET /api/v1/auth/reset?token=…`

`{ "email": "…", "name": "…" }` — whose account the link opens, so the page can
name it before asking for a password. `410` if the link has been used, replaced
or has expired.

### `POST /api/v1/auth/reset`

```json
{ "token": "…", "password": "…" }
```

`{ user, linkedDevices }` and signs you in. `410` for a link that is no longer
good, `422` for a password under 8 characters — the link survives that, so it can
still be used properly. Every other session is signed out; device tokens are
deliberately left alone, and `linkedDevices` is how many there are. See
[security](./security.md#recovering-a-lost-password).

---

## Skills

### `GET /api/v1/skills` — *auth*

The catalog.

| Query | Default | Meaning |
| ----- | ------- | ------- |
| `q` | — | Substring match over slug, title, description and tags |
| `category` | — | Exact match |
| `audience` | — | Case-insensitive match within the audience list |
| `includeArchived` | `0` | `1` to include archived skills |
| `unpublished` | `1` | `0` to hide skills with no approved version |

```json
{
  "skills": [
    {
      "id": 2, "slug": "code-review", "title": "Code Review Standards",
      "description": "Use when reviewing a pull request or asked to review code, …",
      "category": "engineering", "audiences": ["engineering"],
      "tags": ["review", "quality"],
      "version": 1, "published": true, "archived": false,
      "owner": "Rob Alvarez", "pendingCount": 0,
      "updatedAt": "2026-07-31 11:20:14", "subscribed": true
    }
  ]
}
```

A skill awaiting its first approval falls back to its most recent version for
display, so nothing renders blank. `version` is `0` and `published` is `false`
until something is approved.

### `GET /api/v1/skills/facets` — *auth*

`{ categories: string[], audiences: string[] }` — the distinct values currently
in use across published, non-archived skills. Drives the filter chips.

### `GET /api/v1/skills/pending` — *curator*

The review queue, oldest first.

```json
{
  "proposals": [
    {
      "versionId": 10, "skillId": 7, "slug": "product-brief", "version": 1,
      "title": "Product Briefs", "description": "…", "category": "product",
      "audiences": ["product"], "tags": ["specs"], "body": "…",
      "changeNote": "Initial version", "author": "Dan Whitfield",
      "createdAt": "2026-07-31 11:20:14", "isNewSkill": true
    }
  ]
}
```

### `POST /api/v1/skills` — *auth*

Creates a skill and its first version.

```json
{
  "slug": "product-brief",
  "title": "Product Briefs",
  "description": "Use when starting a new feature or writing a spec, PRD or product brief, …",
  "category": "product",
  "audiences": ["product"],
  "tags": ["specs"],
  "allowedTools": null,
  "userInvocable": false,
  "body": "# …",
  "changeNote": "Initial version",
  "submitForReview": false
}
```

| Field | Rule |
| ----- | ---- |
| `slug` | Required, must match the slug pattern, must be unique |
| `title` | 2–120 characters |
| `description` | **20–1024 characters** — the error tells you why |
| `body` | 20–120 000 characters |
| `category` | 1–40 characters, defaults to `general` |
| `audiences` | Up to 12 entries |
| `tags` | Up to 24 entries |
| `changeNote` | Up to 400 characters |

Curators and admins publish immediately unless `submitForReview` is `true`;
everyone else lands in `pending`.

`201` `{ skill: { id, slug }, version: { id, version, status } }`.

### `GET /api/v1/skills/:slug` — *auth*

The full record: the published version including its **rendered `SKILL.md`**,
every version with author and reviewer names, the owning collections, and whether
you are subscribed.

```json
{
  "skill": {
    "id": 2, "slug": "code-review", "owner": "Rob Alvarez", "archived": false,
    "createdAt": "…", "updatedAt": "…", "subscribed": true,
    "collections": [{ "slug": "engineering", "name": "Engineering" }],
    "published": {
      "id": 4, "version": 1, "title": "Code Review Standards",
      "description": "…", "category": "engineering",
      "audiences": ["engineering"], "tags": ["review", "quality"],
      "allowedTools": null, "userInvocable": false, "body": "…",
      "changeNote": "Initial version", "status": "approved",
      "author": "Rob Alvarez", "reviewer": "Rob Alvarez", "reviewNote": null,
      "checksum": "901d03bb91318b78",
      "createdAt": "…", "reviewedAt": "…",
      "renderedMd": "---\nname: code-review\n…"
    },
    "versions": [ … ]
  }
}
```

### `POST /api/v1/skills/:slug/versions` — *auth*

Proposes a new version. Same body as `POST /skills` minus `slug`. The live
version keeps serving until this one is approved. `409` if the skill is archived.

### `POST /api/v1/skills/versions/:id/approve` — *curator*

```json
{ "note": "optional, up to 400 characters" }
```

Publishes it. The previously live version becomes `superseded`. `409` unless the
version is `pending`.

### `POST /api/v1/skills/versions/:id/reject` — *curator*

```json
{ "note": "required — tell the author why" }
```

`409` unless the version is `pending`.

### `POST /api/v1/skills/versions/:id/rollback` — *curator*

Republishes an older version. Allowed for `superseded` and `approved` versions
only; anything else is `409`. Recorded in the audit log as `skill.rollback`.

### `DELETE /api/v1/skills/:slug` — *owner or curator*

Archives the skill: it stops syncing to every machine, the history stays.
`{"ok": true, "archived": true}`.

Add `?purge=1` — **admin only** — to delete it and its subscriptions
permanently. `{"ok": true, "purged": true}`.

### `POST /api/v1/skills/:slug/restore` — *curator*

Un-archives.

### `GET /api/v1/skills/:slug/raw` — *auth*

`text/markdown` — the exact bytes the CLI would write. `404` if nothing is
published.

---

## Collections

### `GET /api/v1/collections` — *auth*

```json
{
  "collections": [
    {
      "id": 1, "slug": "everyone", "name": "Everyone at Acme",
      "description": "How we write and how we work. …",
      "audience": "general", "isDefault": true, "skillCount": 1,
      "subscribed": true, "locked": true
    }
  ]
}
```

Defaults sort first. `locked` mirrors `isDefault` — locked collections report as
subscribed for everyone, because they are.

### `GET /api/v1/collections/:slug` — *auth*

The same fields plus a `skills` array (id, slug, title, description, category,
version, published, archived), ordered by their position in the collection.

### `POST /api/v1/collections` — *curator*

```json
{ "slug": "backend", "name": "Backend Engineering",
  "description": "…", "audience": "engineering", "isDefault": false }
```

### `PATCH /api/v1/collections/:slug` — *curator*

Any of `name`, `description`, `audience`, `isDefault`. The slug is immutable.

### `DELETE /api/v1/collections/:slug` — *curator*

Deletes the collection and every subscription to it. The skills themselves are
untouched.

### `PUT /api/v1/collections/:slug/skills/:skillSlug` — *curator*

Adds a skill, appended at the end. Idempotent.

### `DELETE /api/v1/collections/:slug/skills/:skillSlug` — *curator*

Removes it from the collection.

---

## Subscriptions

### `GET /api/v1/subscriptions` — *auth*

What you get, and where each skill comes from.

```json
{
  "collections": [
    { "slug": "everyone", "name": "Everyone at Acme", "isDefault": true },
    { "slug": "engineering", "name": "Engineering", "isDefault": false }
  ],
  "skills": [
    {
      "slug": "code-review", "title": "Code Review Standards",
      "category": "engineering", "version": 1,
      "sources": ["Engineering"]
    }
  ]
}
```

`sources` is `"direct"` for a personal subscription, or the collection name —
suffixed with `(company default)` when it is one.

### `POST /api/v1/subscriptions` — *auth*

```json
{ "kind": "skill", "slug": "incident-response" }
```

`kind` is `skill` or `collection`. Subscribing to a company-default collection is
a no-op that returns `200` with an explanatory `note`.

### `DELETE /api/v1/subscriptions/:kind/:slug` — *auth*

Unsubscribes. `409` for a company-default collection —
*"company default collections cannot be unsubscribed"*.

---

## Sync

### `GET /api/v1/sync` — *auth*

The endpoint every installed CLI hits, potentially on every Claude session start.

**Request**

```http
GET /api/v1/sync HTTP/1.1
Authorization: Bearer shk_4ff68dc8_…
If-None-Match: "a1b2c3d4e5f60718"
```

**`304 Not Modified`** when the manifest matches — no body. This is the common
case and the reason sync is cheap enough to run every session.

**`200 OK`** otherwise:

```json
{
  "manifest": "d4e5f6a7b8c90112",
  "generatedAt": "2026-07-31T11:29:24.689Z",
  "user": { "name": "Maya Chen", "email": "maya@acme.test" },
  "skills": [
    {
      "slug": "code-review",
      "title": "Code Review Standards",
      "description": "…",
      "category": "engineering",
      "audiences": ["engineering"],
      "tags": ["review", "quality"],
      "version": 1,
      "checksum": "901d03bb91318b78",
      "content": "---\nname: code-review\ndescription: \"…\"\n---\n\n# Code Review Standards\n…",
      "sources": ["Engineering"],
      "updatedAt": "2026-07-31 11:20:14"
    }
  ]
}
```

`content` is the exact `SKILL.md` bytes to write — the CLI does not assemble
frontmatter. See [How it works](how-it-works.md#why-the-server-renders-skillmd).

The response also sets `ETag: "<manifest>"` and `Cache-Control: no-cache`, and
stamps `last_sync_at` on the calling device token.

---

## Device login

The OAuth device-authorization shape. See the
[full sequence](how-it-works.md#device-login).

### `POST /api/v1/device/code` — *no auth*

```json
{ "hostname": "maya-macbook" }
```

```json
{
  "deviceCode": "…64 url-safe chars…",
  "userCode": "433D-8PFV",
  "verificationUri": "https://shkills.yourcompany.com/link",
  "verificationUriComplete": "https://shkills.yourcompany.com/link?code=433D-8PFV",
  "expiresIn": 900,
  "interval": 2
}
```

Expires in **15 minutes**. Expired rows are swept whenever a new code is issued.

### `POST /api/v1/device/token` — *no auth*

```json
{ "deviceCode": "…" }
```

| Response | Meaning |
| -------- | ------- |
| `202 { "status": "pending" }` | Not approved yet — keep polling every `interval` seconds |
| `200 { "status": "approved", "token", "user" }` | Approved. **The plaintext token is returned exactly once.** |
| `403` | Denied in the browser |
| `409` | Already claimed |
| `410` | Expired |
| `404` | Unknown device code |

### `POST /api/v1/device/approve` — *auth*

```json
{ "userCode": "433D-8PFV" }
```

Mints the token, stores only its SHA-256, and marks the request approved.
`409` if the code was already used.

### `POST /api/v1/device/deny` — *auth*

Same body. Marks it denied.

### `GET /api/v1/device/pending/:userCode` — *auth*

`{ hostname, status, createdAt }`, so the approval screen can name the machine
before you commit.

---

## Tokens

### `GET /api/v1/tokens` — *auth*

Your linked machines: `id`, `name`, `prefix`, `created_at`, `last_used_at`,
`last_sync_at`, `revoked_at`. The token itself is never returned.

### `DELETE /api/v1/tokens/:id` — *auth*

Revokes one of your own tokens. Takes effect on the next request. `404` if it is
not yours or already revoked.

---

## Admin

### `GET /api/v1/admin/users` — *curator*

Everyone, with a live device count and the most recent sync across their
machines.

### `POST /api/v1/admin/users` — *admin*

```json
{ "email": "…", "name": "…", "password": "…",
  "role": "member", "department": "engineering" }
```

### `PATCH /api/v1/admin/users/:id` — *admin*

Any of `role`, `department`, `active`. **Returns `409` if the change would leave
no active admin.**

### `GET /api/v1/admin/password-requests` — *admin*

`{ requests: [{ id, userId, email, name, createdAt, expiresAt, delivery }] }` —
who is waiting to get back in. **Never carries the link itself**: that is minted
and shown once, by the endpoint below.

### `POST /api/v1/admin/users/:id/reset-link` — *admin*

`{ url, email, name, expiresInMinutes }`. Mints a single-use link and shows it
to the administrator **once**, to be handed over out of band. This is how a
deployment with no mail server delivers a reset. Retires that account's other
outstanding links.

### `GET /api/v1/admin/audit` — *curator*

```
?limit=100     max 500
```

`{ events: [{ id, action, entity, entity_id, detail, created_at, actor }] }`,
newest first.

Actions recorded: `auth.login`, `auth.register`, `auth.password_change`,
`skill.propose`, `skill.publish`, `skill.approve`, `skill.reject`,
`skill.rollback`, `skill.archive`, `skill.restore`, `skill.delete`,
`collection.create`, `collection.update`, `collection.delete`,
`collection.add_skill`, `collection.remove_skill`, `device.approve`,
`device.revoke`, `user.create`, `user.update`.

### `GET /api/v1/admin/stats` — *auth*

```json
{
  "stats": {
    "skills": 6, "pending": 3, "collections": 4,
    "people": 5, "linkedDevices": 6, "syncedLastDay": 5
  }
}
```

`skills` counts published, non-archived skills. `syncedLastDay` counts distinct
people, not devices.
