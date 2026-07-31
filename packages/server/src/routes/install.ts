import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { config } from '../config.js';

export const installRouter: Router = Router();

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * The bundled CLI. In development it sits in the sibling workspace package; a
 * production build copies it next to the server output.
 */
function cliBundlePath(): string | null {
  const candidates = [
    path.resolve(here, '../cli/shkills.mjs'),
    path.resolve(here, '../../cli/shkills.mjs'),
    path.resolve(here, '../../../cli/dist/shkills.mjs'),
    path.resolve(process.cwd(), '../cli/dist/shkills.mjs'),
    path.resolve(process.cwd(), 'packages/cli/dist/shkills.mjs'),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

installRouter.get('/cli/shkills.mjs', (_req, res) => {
  const bundle = cliBundlePath();
  if (!bundle) {
    res.status(503).type('text/plain').send('CLI bundle not built — run `npm run build`');
    return;
  }
  res.type('application/javascript').send(fs.readFileSync(bundle, 'utf8'));
});

installRouter.get('/cli/version', (_req, res) => {
  const bundle = cliBundlePath();
  if (!bundle) {
    res.status(503).json({ error: 'CLI bundle not built' });
    return;
  }
  const content = fs.readFileSync(bundle);
  res.json({
    sha256: createHash('sha256').update(content).digest('hex'),
    bytes: content.length,
    builtAt: fs.statSync(bundle).mtime.toISOString(),
  });
});

/**
 * The whole onboarding story is this one script. It installs a Node bundle, drops
 * a launcher on PATH, records which Shkills server to talk to, and — when it has
 * a terminal — hands straight over to `shkills login`.
 */
installRouter.get('/install.sh', (req, res) => {
  const host = config.publicUrl || `${req.protocol}://${req.get('host')}`;
  res.type('text/x-shellscript').send(`#!/bin/sh
# Shkills installer — sets up the CLI that keeps your Claude skills in sync.
set -eu

SHKILLS_HOST="\${SHKILLS_HOST:-${host}}"
SHKILLS_HOME="\${SHKILLS_HOME:-$HOME/.shkills}"
BIN_DIR="$SHKILLS_HOME/bin"

say()  { printf '%s\\n' "$1"; }
fail() { printf 'error: %s\\n' "$1" >&2; exit 1; }

command -v node >/dev/null 2>&1 || fail "Node.js 20+ is required (https://nodejs.org)"
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 20 ] || fail "Node.js 20+ is required, found $(node -v)"

if command -v curl >/dev/null 2>&1; then
  fetch() { curl -fsSL "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -qO "$2" "$1"; }
else
  fail "curl or wget is required"
fi

mkdir -p "$BIN_DIR"
say "Downloading the Shkills CLI from $SHKILLS_HOST ..."
# .mjs, not .js: the bundle is ESM and this directory has no package.json to
# say so, and Node would parse a bare .js file as CommonJS.
fetch "$SHKILLS_HOST/cli/shkills.mjs" "$BIN_DIR/shkills.mjs" || fail "download failed"

cat > "$BIN_DIR/shkills" <<LAUNCHER
#!/bin/sh
exec node "$BIN_DIR/shkills.mjs" "\\$@"
LAUNCHER
chmod +x "$BIN_DIR/shkills"

# Remember the server so no one has to type a URL again.
mkdir -p "$SHKILLS_HOME"
if [ ! -f "$SHKILLS_HOME/config.json" ]; then
  printf '{\\n  "host": "%s"\\n}\\n' "$SHKILLS_HOST" > "$SHKILLS_HOME/config.json"
fi

# Put the launcher on PATH for the next shell, without duplicating the line.
add_path() {
  rc="$1"
  [ -f "$rc" ] || return 0
  grep -q '.shkills/bin' "$rc" 2>/dev/null && return 0
  printf '\\n# Shkills\\nexport PATH="$HOME/.shkills/bin:$PATH"\\n' >> "$rc"
  say "Added $BIN_DIR to PATH in $rc"
}
add_path "$HOME/.zshrc"
add_path "$HOME/.bashrc"
[ -f "$HOME/.bashrc" ] || add_path "$HOME/.profile"

PATH="$BIN_DIR:$PATH"
export PATH

say ""
say "Shkills CLI installed."

if [ -t 1 ]; then
  say ""
  "$BIN_DIR/shkills" login || true
else
  say ""
  say "Next: run these two commands"
  say ""
  say "  shkills login     # link this machine to your Shkills account"
  say "  shkills setup     # keep skills fresh on every Claude session"
  say ""
  say "(open a new terminal first, so PATH picks up $BIN_DIR)"
fi
`);
});
