import { hookInstalled, installHook, removeHook } from '../hook.js';
import { claudeDir } from '../paths.js';
import { say, style } from '../ui.js';
import { sync } from './sync.js';

/**
 * The one-time configuration. After this, skills stay current on their own.
 */
export async function runSetup(options: { silent?: boolean } = {}): Promise<void> {
  const { changed, command } = installHook();

  if (!options.silent) {
    say();
    if (changed) {
      say(`${style.green('✓')} Claude will refresh your skills at the start of every session.`);
    } else {
      say(`${style.green('✓')} Automatic updates were already configured.`);
    }
    say(style.dim(`  ${claudeDir()}/settings.json → SessionStart → ${command}`));
    say();
  }

  await sync({ force: true });

  if (!options.silent) {
    say();
    say(style.dim('  That was the only setup step. Nothing else to do, ever.'));
    say();
  }
}

export function teardown(): void {
  const removed = removeHook();
  say(
    removed
      ? `${style.green('✓')} Automatic updates turned off.`
      : style.dim('Automatic updates were not configured.'),
  );
  if (removed) say(style.dim('  Run `shkills sync` by hand, or `shkills setup` to turn it back on.'));
}

export function hookStatusLine(): string {
  const { installed, command } = hookInstalled();
  return installed ? `on  ${style.dim(command ?? '')}` : style.yellow('off — run `shkills setup`');
}
