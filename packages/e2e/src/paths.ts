import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The monorepo root, found from this file rather than from the cwd. */
export const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../../..');

export const serverEntry = path.join(repoRoot, 'packages/server/dist/index.js');
/** The console way back in, the same file `kubectl exec` would run. */
export const consoleResetEntry = path.join(repoRoot, 'packages/server/dist/reset-password.js');
export const cliBundle = path.join(repoRoot, 'packages/cli/dist/shkills.mjs');
export const webIndex = path.join(repoRoot, 'packages/web/dist/index.html');

/**
 * The suite drives the built artifacts, not the sources — the same files a
 * deployment serves. Missing ones are a build problem, and saying so plainly
 * beats a browser timing out on a blank page.
 */
export function requireBuiltArtifacts(): void {
  const missing = [serverEntry, consoleResetEntry, cliBundle, webIndex].filter(
    (file) => !fs.existsSync(file),
  );
  if (missing.length === 0) return;
  throw new Error(
    `these are not built yet:\n  ${missing
      .map((file) => path.relative(repoRoot, file))
      .join('\n  ')}\n\nRun \`npm run build\` first (or use \`npm run test:e2e\` from the repo root, which does it for you).`,
  );
}
