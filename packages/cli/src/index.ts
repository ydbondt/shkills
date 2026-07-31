import { ApiError } from './api.js';
import { loadConfig } from './paths.js';
import { fail, say, setQuiet, style } from './ui.js';
import { login, logout } from './commands/login.js';
import { sync } from './commands/sync.js';
import { runSetup, teardown } from './commands/setup.js';
import { setHost } from './commands/host.js';
import {
  browse,
  clean,
  collections,
  list,
  show,
  status,
  subscribe,
  unsubscribe,
} from './commands/catalog.js';

const VERSION = '0.1.0';

function usage(): void {
  say(`
  ${style.bold('shkills')} ${style.dim('— your company’s Claude skills, always current')}

  ${style.dim('Getting started')}
    login             Link this machine to your Shkills account
    setup             Keep skills up to date automatically (done for you by login)

  ${style.dim('Everyday')}
    list              What is installed on this machine, and why
    browse [query]    Search the company catalog
    collections       Ready-made sets of skills
    add <name>        Install one skill
    remove <name>     Uninstall one skill
    use <name>        Subscribe to a collection
    unuse <name>      Unsubscribe from a collection

  ${style.dim('Maintenance')}
    sync              Pull the latest skills now
    status            Where everything stands
    show <name>       Print a skill exactly as Claude sees it
    clean             Remove every skill Shkills installed
    logout            Unlink this machine
    setup --off       Stop updating automatically
    set-host <url>    Point this machine at a different Shkills address

  ${style.dim('Flags')}
    --host <url>      Shkills server (login only)
    --token <token>   Link non-interactively, for CI
    --force           Ignore the local cache
    --dry-run         Show what sync would change
    --quiet           Only report problems
`);
}

interface Parsed {
  command: string;
  args: string[];
  flags: Record<string, string | boolean>;
}

function parseArgv(argv: string[]): Parsed {
  const flags: Record<string, string | boolean> = {};
  const args: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args.push(token);
      continue;
    }
    const name = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      flags[name] = next;
      i += 1;
    } else {
      flags[name] = true;
    }
  }
  return { command: args.shift() ?? '', args, flags };
}

function need(args: string[], what: string): string {
  const value = args[0];
  if (!value) fail(`which ${what}? e.g. \`shkills ${process.argv[2]} code-review\``);
  return value;
}

async function main(): Promise<void> {
  const { command, args, flags } = parseArgv(process.argv.slice(2));
  if (flags.quiet) setQuiet(true);

  switch (command) {
    case '':
    case 'help':
    case '--help':
    case '-h':
      usage();
      return;

    case 'version':
    case '--version':
      say(VERSION);
      return;

    case 'login':
      await login({
        host: typeof flags.host === 'string' ? flags.host : undefined,
        token: typeof flags.token === 'string' ? flags.token : undefined,
      });
      return;

    case 'logout':
      logout();
      return;

    case 'setup':
      if (flags.off) {
        teardown();
        return;
      }
      await runSetup();
      return;

    case 'sync':
      await sync({
        force: flags.force === true,
        dryRun: flags['dry-run'] === true,
        ifStale: typeof flags['if-stale'] === 'string' ? Number(flags['if-stale']) : undefined,
      });
      return;

    case 'status':
    case 'doctor':
      await status();
      return;

    case 'list':
    case 'ls':
      await list();
      return;

    case 'browse':
    case 'search':
      await browse(args[0]);
      return;

    case 'collections':
      await collections();
      return;

    case 'add':
      await subscribe('skill', need(args, 'skill'));
      return;

    case 'remove':
    case 'rm':
      await unsubscribe('skill', need(args, 'skill'));
      return;

    case 'use':
      await subscribe('collection', need(args, 'collection'));
      return;

    case 'unuse':
      await unsubscribe('collection', need(args, 'collection'));
      return;

    case 'show':
      await show(need(args, 'skill'));
      return;

    case 'clean':
      clean();
      return;

    case 'open': {
      const { host } = loadConfig();
      say(host || 'no server configured');
      return;
    }

    case 'set-host':
      setHost(need(args, 'address'));
      return;

    default:
      fail(`unknown command “${command}” — run \`shkills help\``);
  }
}

main().catch((err) => {
  if (err instanceof ApiError) {
    if (err.status === 401) {
      fail('not linked — run `shkills login`');
    }
    fail(err.message);
  }
  fail(err instanceof Error ? err.message : String(err));
});
