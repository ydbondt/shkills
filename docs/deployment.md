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
| `SHKILLS_PUBLIC_URL` | `http://localhost:<PORT>` | **Get this right.** It is baked into `/install.sh`, shown in the portal's install command, and used in the device-link URL the CLI prints. |
| `SHKILLS_DATA_DIR` | `./data` (`/data` in the image) | Where the database and the generated secret live. |
| `SHKILLS_DB` | `<data dir>/shkills.sqlite` | Override only if you want the file elsewhere. |
| `SHKILLS_JWT_SECRET` | generated and persisted | **Set this in production.** |
| `NODE_ENV` | — | `production` turns on `Secure` session cookies. |

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
