# Deployment

One container, one SQLite file, one URL. Shkills is deliberately boring to run.

- [Docker Compose](#docker-compose) · [Configuration](#configuration)
- [Behind a reverse proxy](#behind-a-reverse-proxy)
- [First run](#first-run) · [Rolling it out](#rolling-it-out)
- [Backups](#backups) · [Upgrades](#upgrades) · [Monitoring](#monitoring)
- [Running without Docker](#running-without-docker) · [Sizing](#sizing)
- [Kubernetes](#kubernetes)

---

## Docker Compose

```bash
cp .env.example .env
$EDITOR .env          # set SHKILLS_PUBLIC_URL and SHKILLS_JWT_SECRET
docker compose up -d
```

The compose file builds the image, mounts a named volume at `/data`, and restarts
unless stopped. `SHKILLS_JWT_SECRET` is marked required — compose refuses to
start without it, which is better than silently generating one that changes on
every rebuild.

```yaml
services:
  shkills:
    build: .
    ports: ['4000:4000']
    environment:
      SHKILLS_PUBLIC_URL: ${SHKILLS_PUBLIC_URL:-http://localhost:4000}
      SHKILLS_JWT_SECRET: ${SHKILLS_JWT_SECRET:?set a long random value}
      NODE_ENV: production
    volumes: [shkills-data:/data]
    restart: unless-stopped

volumes:
  shkills-data:
```

The image is a two-stage build on `node:20-bookworm-slim`. The runtime stage
installs production dependencies for the server workspace only and copies three
build outputs: the server, the portal, and the CLI bundle the installer hands
out.

## Configuration

Everything is an environment variable. There is no config file.

| Variable | Default | Notes |
| -------- | ------- | ----- |
| `PORT` | `4000` | |
| `SHKILLS_PUBLIC_URL` | `http://localhost:<PORT>` | The canonical address, and the fallback when a request cannot say. See [About addresses](#about-addresses). |
| `SHKILLS_PIN_PUBLIC_URL` | off | Always answer with `SHKILLS_PUBLIC_URL`, never with the address in the request. |
| `SHKILLS_TRUST_PROXY` | off | Honour `X-Forwarded-Proto` / `X-Forwarded-Host`. Turn on **only** with a proxy in front. |
| `SHKILLS_DATA_DIR` | `./data` (`/data` in the image) | Where the database and the generated secret live. |
| `SHKILLS_DB` | `<data dir>/shkills.sqlite` | Override only if you want the file elsewhere. |
| `SHKILLS_JWT_SECRET` | generated and persisted | **Set this in production.** |
| `SHKILLS_SECURE_COOKIES` | derived from `SHKILLS_PUBLIC_URL` | Whether the session cookie carries `Secure`. Set it only if the URL cannot describe your setup. |
| `SHKILLS_SMTP_URL` | — | `smtp://user:pass@host:587`. Setting it is what turns emailed password-reset links on. |
| `SHKILLS_MAIL_FROM` | `shkills@<public host>` | The envelope sender. |
| `SHKILLS_MAIL_TRANSPORT` | `smtp` if a URL is set, else `none` | Force it: `smtp`, `file` (write messages to a directory) or `none`. |
| `SHKILLS_MAIL_DIR` | `<data dir>/mail` | Where the `file` transport writes. |
| `NODE_ENV` | — | `production` tightens error output. It does **not** control cookie flags. |

### About addresses

`/install.sh`, the install command shown in the portal, and the device-link URL
the CLI prints all name back **the address the caller actually reached**.

That is not a detail. One deployment usually answers to several addresses — a
NodePort IP, a hostname through an ingress, a port-forward to a laptop — and
whichever one somebody used is the one that provably works for them. What gets
named back is what an installed machine will sync from for ever after, so a
single hard-coded address is wrong for every door but one.

`SHKILLS_PUBLIC_URL` is the canonical address: it is what a request that cannot
say gets, what the startup banner prints, and what decides the `Secure` cookie
flag. Only the Host header of the request can influence the rest, and only if it
is a plain `host[:port]` — anything else falls back to the configured URL, since
the value ends up inside a shell script.

Set `SHKILLS_PIN_PUBLIC_URL=true` to switch that off and funnel everybody onto
the canonical address whatever they typed. The case for it: once you have TLS,
so nobody can onboard over plain HTTP by reaching a container directly.

Behind a proxy, set `SHKILLS_TRUST_PROXY=true` so `X-Forwarded-Proto` is
honoured — otherwise a TLS-terminating proxy makes every generated URL `http://`.
Never set it without a proxy: it is a header any client can send.

Machines already installed keep talking to the address they were installed from.
`shkills set-host <url>` moves one, keeping it linked, and re-running the
installer does the same thing.

### About `SHKILLS_SECURE_COOKIES`

The `Secure` flag follows the scheme of `SHKILLS_PUBLIC_URL`, because that is
the address the browser actually uses — including when TLS is terminated by a
proxy in front of this process.

It deliberately does *not* follow `NODE_ENV`. A browser silently discards a
`Secure` cookie delivered over plain HTTP, so a production deployment that has
not got TLS yet would accept your password and then act as though you had never
signed in — with no error anywhere to explain it.

### About sending mail

Shkills sends exactly one kind of message: a link for somebody who has lost
their password. Set `SHKILLS_SMTP_URL` and it is emailed; leave it unset and the
request goes to a queue on the **People** page instead, for an administrator to
hand over by hand. Both work — the second is simply what a deployment without a
mail server can do.

To see what a message looks like before pointing it at a real relay:

```bash
SHKILLS_MAIL_TRANSPORT=file SHKILLS_MAIL_DIR=/tmp/shkills-mail  # then read the files
```

If the mail server is unreachable when somebody asks, the link is not thrown
away: the request falls back to the administrators' queue and the person is told
so. Nothing about this ever changes the answer given to the person asking, which
has to look the same whether or not the address belongs to an account.

**Whoever holds the link holds the account until it is used**, so on a
plain-HTTP deployment it is one more reason to get TLS in front. See
[security](./security.md#recovering-a-lost-password).

### About `SHKILLS_JWT_SECRET`

It signs browser session cookies. If it changes, **everybody is signed out** —
device tokens are unaffected, since those are random values checked against a
hash, so machines keep syncing.

When the variable is absent, the server generates a secret once and persists it
at `<data dir>/.jwt-secret` with mode `0600`, so `npm run dev` just works and a
restart does not log you out. That fallback is a development convenience: in
production, set the variable so the secret lives with your other secrets rather
than in the data volume.

```bash
openssl rand -hex 48
```

## Behind a reverse proxy

**Put it behind TLS.** Device tokens are bearer tokens; plain HTTP puts them on
the wire.

nginx:

```nginx
server {
  listen 443 ssl http2;
  server_name shkills.yourcompany.com;

  ssl_certificate     /etc/letsencrypt/live/shkills.yourcompany.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/shkills.yourcompany.com/privkey.pem;

  # The CLI bundle is ~24 KB and the sync payload grows with your catalogue.
  client_max_body_size 4m;

  location / {
    proxy_pass         http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
  }
}
```

Caddy:

```
shkills.yourcompany.com {
  reverse_proxy 127.0.0.1:4000
}
```

Then set `SHKILLS_PUBLIC_URL=https://shkills.yourcompany.com` and
`NODE_ENV=production`, and restart.

> **Warning**
> Do not strip the `If-None-Match` request header or the `ETag` response header
> at the proxy. They are what make sync a `304` in the common case; without
> them every Claude session start downloads the whole skill set.

### Do I need to expose it to the internet?

Only if people work off the VPN. Everything the CLI does is an outbound HTTPS
request to this one host, so a VPN-only or Tailscale deployment works with no
changes — as long as `SHKILLS_PUBLIC_URL` matches the address people actually
reach it on.

## First run

1. Open the portal.
2. Create your account — **the first account on a fresh database becomes the
   administrator.** Do this before you share the URL.
3. Create a collection, mark it **company default**, and put the two or three
   skills you actually want everyone to have in it.
4. Send colleagues the *Your setup* page.

There is no console, no admin bootstrap command, and no seed step required in
production.

## Rolling it out

The install command is the entire onboarding, and it is idempotent:

```bash
curl -fsSL https://shkills.yourcompany.com/install.sh | sh
```

- Put it in your laptop provisioning script — re-running it updates the CLI.
- For CI images, mint a device token by linking once, then
  `shkills login --token "$SHKILLS_TOKEN"` or set `SHKILLS_HOST` and
  `SHKILLS_TOKEN` and call `shkills sync --quiet` directly.
- Start with one **company default** collection holding a small number of skills.
  Defaults cannot be opted out of, so a bad skill in a default collection is on
  every machine — which is the point, and the reason to keep the bar high.

## Backups

Everything is in `$SHKILLS_DATA_DIR`. One file matters.

```bash
sqlite3 /data/shkills.sqlite ".backup '/backups/shkills-$(date +%F).sqlite'"
```

Use `.backup`, not `cp`. The database runs in WAL mode; copying the `.sqlite`
file alone while the server is writing can give you a torn snapshot.

From the host, against a running container:

```bash
docker compose exec shkills node -e "
  const Database = require('better-sqlite3');
  new Database('/data/shkills.sqlite', { readonly: true })
    .backup('/data/backup.sqlite')
    .then(() => console.log('ok'), (e) => { console.error(e); process.exit(1); });
"
docker compose cp shkills:/data/backup.sqlite ./shkills-$(date +%F).sqlite
```

Also back up `SHKILLS_JWT_SECRET` if you let the server generate it — restoring
the database without it signs everyone out.

**Restore** is: stop the container, drop the file in place as
`/data/shkills.sqlite` (removing any `-wal` and `-shm` siblings), start it again.

## Upgrades

```bash
git pull
docker compose up -d --build
```

The schema is created with `CREATE TABLE IF NOT EXISTS` at startup, so a new
version adds what it needs on boot. Take a backup first anyway — it costs a
second.

Existing CLIs do not need upgrading to benefit. Because the server renders
`SKILL.md`, a format change reaches every machine on its next sync with no client
update. When you do want to push a new CLI, re-running the install command
replaces the bundle.

## Monitoring

| Check | How |
| ----- | --- |
| Liveness | `GET /api/health` → `{"ok":true,"service":"shkills"}`. The image has a `HEALTHCHECK` on it already. |
| Adoption | `GET /api/v1/admin/stats` → `linkedDevices` and `syncedLastDay`. Also on the **People** page. |
| Who did what | `GET /api/v1/admin/audit`, or read `audit_log` directly. |
| Errors | Unhandled errors log to stdout as `[shkills] unhandled error: …`. |

A useful alert: `syncedLastDay` dropping sharply usually means the hook stopped
working, not that people stopped working.

## Running without Docker

```bash
npm ci
npm run build
NODE_ENV=production \
SHKILLS_PUBLIC_URL=https://shkills.yourcompany.com \
SHKILLS_JWT_SECRET="$(openssl rand -hex 48)" \
SHKILLS_DATA_DIR=/var/lib/shkills \
node packages/server/dist/index.js
```

As a systemd unit:

```ini
[Unit]
Description=Shkills
After=network.target

[Service]
Type=simple
User=shkills
WorkingDirectory=/opt/shkills
EnvironmentFile=/etc/shkills.env
ExecStart=/usr/bin/node packages/server/dist/index.js
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/shkills

[Install]
WantedBy=multi-user.target
```

The server finds the built portal at `packages/web/dist` or `../public`
relative to its own output, so keep the workspace layout intact.

## Sizing

Shkills is small by construction.

- The whole dataset is text. A hundred skills with full version history is a few
  megabytes.
- The expensive request is `GET /api/v1/sync`, and it is a `304` with no body
  unless something actually changed.
- The load is one request per person per Claude session start.

A 1 vCPU / 512 MB container is comfortable for a company of a few hundred.
SQLite in WAL mode handles this without noticing. If you ever outgrow it, the
bottleneck will be manifest computation on `/sync` — which is one indexed query
and a SHA-256 over a few kilobytes.

## Kubernetes

Manifests for a k3s cluster live in [`deploy/k8s/`](../deploy/k8s/README.md),
along with a GitHub Actions pipeline that builds each commit and rolls it out.

The two decisions worth carrying to any cluster:

**Use `Recreate`, and stay at one replica.** The store is SQLite on a
ReadWriteOnce volume. A `RollingUpdate` briefly runs two pods, which means two
writers against one database file — the one failure mode this design cannot
absorb. `strategy: { type: Recreate }` costs a few seconds of downtime per
deploy and removes the problem entirely.

**Deploy an immutable tag.** It is tempting to push `:latest` and
`kubectl rollout restart`. Then nothing records which commit is live, and
`kubectl rollout undo` rolls back to the same moving tag. Tag images with the
commit SHA and `kubectl set image` to it instead.

If the cluster has no inbound access from the internet — most self-hosted ones
don't — resist putting a kubeconfig in an Actions secret. Run a self-hosted
runner inside the cluster and let it authenticate with its ServiceAccount, so no
cluster credential exists outside the cluster at all. `deploy/k8s/60-runner.yaml`
does this in about forty lines, with a Role that can move a Deployment's image
and nothing else.

The container runs unprivileged: uid 1000, read-only root filesystem, all
capabilities dropped, `fsGroup` for the data volume and an `emptyDir` at `/tmp`
for SQLite's scratch files.
