import { ApiError, apiRaw, type SyncSkill } from '../api.js';
import { loadConfig, loadState, saveState, skillsDir } from '../paths.js';
import { applySync, changeCount } from '../sync-engine.js';
import { plural, say, style, warn } from '../ui.js';

interface SyncResponse {
  manifest: string;
  generatedAt: string;
  skills: SyncSkill[];
}

export interface SyncArgs {
  force?: boolean;
  dryRun?: boolean;
  /** Skip entirely if the last successful sync is younger than this many seconds. */
  ifStale?: number;
}

/**
 * Pulls the current skill set and writes it to `~/.claude/skills`.
 *
 * This runs on every Claude session start, so it is built to be invisible: it
 * short-circuits on a 304, and any failure is a warning rather than an error —
 * a Shkills outage must never stop somebody from starting Claude.
 */
export async function sync(args: SyncArgs = {}): Promise<number> {
  const config = loadConfig();
  if (!config.token) {
    warn('this machine is not linked yet — run `shkills login`');
    return 0;
  }

  const state = loadState();

  if (args.ifStale && state.syncedAt) {
    const age = (Date.now() - new Date(state.syncedAt).getTime()) / 1000;
    if (age < args.ifStale) return 0;
  }

  let response: { raw: SyncResponse | null; status: number; etag: string | null };
  try {
    response = await apiRaw<SyncResponse>('/api/v1/sync', {
      headers: args.force || !state.manifest ? {} : { 'if-none-match': `"${state.manifest}"` },
      timeoutMs: 12_000,
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      warn('your Shkills login expired — run `shkills login` to relink this machine');
      return 0;
    }
    warn(err instanceof Error ? err.message : 'sync failed');
    return 0;
  }

  if (response.status === 304 || !response.raw) {
    // Record the check so `--if-stale` and `status` stay meaningful.
    saveState({ ...state, syncedAt: new Date().toISOString() });
    say(style.dim('Skills are up to date.'));
    return 0;
  }

  const { outcome, nextState } = applySync(skillsDir(), response.raw.skills, state, {
    dryRun: args.dryRun,
  });

  if (!args.dryRun) saveState({ ...nextState, manifest: response.raw.manifest });

  for (const skipped of outcome.skipped) {
    warn(`skipped ${style.bold(skipped.slug)} — ${skipped.reason}`);
  }

  const changes = changeCount(outcome);
  if (changes === 0) {
    say(style.dim(`Skills are up to date. ${plural(outcome.unchanged.length, 'skill')} installed.`));
    return 0;
  }

  const parts: string[] = [];
  if (outcome.installed.length) parts.push(`${style.green('+')} ${outcome.installed.join(', ')}`);
  if (outcome.updated.length) parts.push(`${style.blue('↑')} ${outcome.updated.join(', ')}`);
  if (outcome.removed.length) parts.push(`${style.dim('−')} ${outcome.removed.join(', ')}`);

  const prefix = args.dryRun ? style.dim('(dry run) ') : '';
  for (const part of parts) say(`${prefix}${part}`);
  say(
    style.dim(
      `${plural(Object.keys(nextState.skills).length, 'skill')} now available to Claude.`,
    ),
  );
  return changes;
}
