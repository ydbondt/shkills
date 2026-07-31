const useColor =
  process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== 'dumb';

const wrap = (open: string, close: string) => (s: string) =>
  useColor ? `\u001b[${open}m${s}\u001b[${close}m` : s;

export const style = {
  bold: wrap('1', '22'),
  dim: wrap('2', '22'),
  underline: wrap('4', '24'),
  red: wrap('31', '39'),
  green: wrap('32', '39'),
  yellow: wrap('33', '39'),
  blue: wrap('34', '39'),
  cyan: wrap('36', '39'),
};

export let quiet = false;
export function setQuiet(value: boolean): void {
  quiet = value;
}

export function say(line = ''): void {
  if (!quiet) process.stdout.write(`${line}\n`);
}

/** Always printed, even in quiet mode — errors are not noise. */
export function warn(line: string): void {
  process.stderr.write(`${style.yellow('!')} ${line}\n`);
}

export function fail(line: string): never {
  process.stderr.write(`${style.red('✗')} ${line}\n`);
  process.exit(1);
}

export function heading(text: string): void {
  say();
  say(style.bold(text));
  say();
}

/** Left-aligned two-column layout — the CLI equivalent of a clean table. */
export function rows(entries: [string, string][], indent = '  '): void {
  const width = entries.reduce((max, [left]) => Math.max(max, stripAnsi(left).length), 0);
  for (const [left, right] of entries) {
    const pad = ' '.repeat(width - stripAnsi(left).length);
    say(`${indent}${left}${pad}   ${style.dim(right)}`);
  }
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001b\[[0-9;]*m/g, '');
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
