# Deploying Shkills to k3s

These manifests run Shkills in the `shkills` namespace, built and deployed
automatically by [`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml).

## How a commit reaches the cluster

```
push to main
   │
   ├─ build   (GitHub-hosted runner)   docker build → ghcr.io/ydbondt/shkills:sha-abc1234
   │                                                   ghcr.io/ydbondt/shkills:latest
   │
   └─ deploy  (self-hosted runner, *inside* the cluster)
              kubectl set image deployment/shkills shkills=…:sha-abc1234
              kubectl rollout status   ── fails? ──▶ kubectl rollout undo
              curl /api/health through the Service
```

Two things are worth knowing about that shape.

**No cluster credential exists outside the cluster.** The k3s API server is on a
private LAN with no inbound access from GitHub. The usual workaround — putting a
kubeconfig in an Actions secret — would place a working cluster credential
somewhere every future collaborator on a public repo could try to reach. Instead
the runner lives in the `shkills` namespace and polls GitHub for work from the
inside, authenticating to the API server with its own ServiceAccount. Nothing to
leak, nothing to rotate.

**Deploys are by immutable tag.** The pipeline deploys `sha-<commit>`, never
`latest`, so `kubectl describe deployment/shkills` tells you exactly which commit
is live and `kubectl rollout undo` means something. If the new image does not
become ready within 180s, CI rolls it back itself and fails the run — an
unattended deploy should not be able to leave the portal down.

The runner's permissions are deliberately minimal: it can move the image of an
existing Deployment and watch the result, and that is all. It cannot create or
delete resources, and it cannot read Secrets. Applying these manifests is a
human job, done with your own kubectl.

## First-time setup

### 1. Secrets (never in this repo)

Three Secrets are created out-of-band. They are the only things standing between
this public repo and a working deployment, so none of them is checked in, and
none should be pasted into an issue or a PR.

```sh
# The JWT signing key. Generate once and keep it: changing it signs everybody
# out. Piped straight in so it never lands in a file or your shell history.
openssl rand -hex 48 | tr -d '\n' \
  | kubectl -n shkills create secret generic shkills-secrets \
      --from-file=SHKILLS_JWT_SECRET=/dev/stdin

# Pulling the image from GHCR.
kubectl -n shkills create secret docker-registry ghcr-secret \
  --docker-server=ghcr.io \
  --docker-username=<github-username> \
  --docker-password=<a PAT with read:packages>

# Registering the self-hosted runner. A PAT with `repo` scope; the runner only
# uses it to exchange itself for a short-lived registration token at startup.
kubectl -n shkills create secret generic github-runner-secret \
  --from-literal=ACCESS_TOKEN=<pat>
```

Verify the JWT key arrived intact — a stray newline is easy to introduce and
produces a confusing "everyone is logged out after deploy":

```sh
kubectl -n shkills get secret shkills-secrets \
  -o jsonpath='{.data.SHKILLS_JWT_SECRET}' | base64 -d | wc -c   # → 96
```

### 2. Apply the manifests

```sh
kubectl apply -f deploy/k8s/
```

The app pod stays in `ErrImagePull` until the first pipeline run publishes an
image. That is expected on a fresh cluster; push to `main` (or run the Deploy
workflow manually) and it resolves itself.

### 3. Confirm the runner registered

```sh
gh api repos/ydbondt/shkills/actions/runners \
  --jq '.runners[] | "\(.name) \(.status)"'      # → k3s-shkills online
```

## Reaching the portal

`SHKILLS_PUBLIC_URL` in `10-config.yaml` is not cosmetic. It is baked into
`/install.sh`, into the install command the portal displays, and into the
device-link URL the CLI prints — if it is wrong, onboarding breaks in a way that
is annoying to debug.

Today it points at the NodePort, `http://192.168.83.16:31400`, because
`shkills.biyou.internal` has **no DNS record** — the internal resolver only has
explicit entries, and there is no wildcard for `*.biyou.internal`. The Ingress
in `50-ingress.yaml` is applied and correct, and starts working the moment
somebody adds that record. You can prove the routing already works without DNS:

```sh
curl -H 'Host: shkills.biyou.internal' http://192.168.83.16/api/health
```

Once the record exists:

```sh
# edit SHKILLS_PUBLIC_URL in 10-config.yaml to http://shkills.biyou.internal
kubectl apply -f deploy/k8s/10-config.yaml
kubectl -n shkills rollout restart deployment/shkills
```

The restart is required — the value is read into the process environment at
startup, so a ConfigMap change alone does nothing.

## Notes on the manifests

- **`Recreate`, not `RollingUpdate`.** The store is SQLite on a ReadWriteOnce
  volume; a rolling update would deliberately run two writers against one
  database file. For the same reason, do not scale past one replica.
- **The container runs unprivileged** (uid 1000, read-only root filesystem, all
  capabilities dropped) with `fsGroup: 1000` making the data volume writable and
  an `emptyDir` at `/tmp`. Verified by running the image under exactly those
  constraints, including SQLite's WAL files.
- **Backups**: the whole state is `/data/shkills.sqlite` on the
  `shkills-data` PVC.

## Operating

```sh
# What is actually running?
kubectl -n shkills get deploy shkills -o jsonpath='{.spec.template.spec.containers[0].image}'

# Logs
kubectl -n shkills logs deploy/shkills -f

# Roll back to the previous image
kubectl -n shkills rollout undo deployment/shkills

# Pin an older commit
kubectl -n shkills set image deployment/shkills shkills=ghcr.io/ydbondt/shkills:sha-abc1234
```
