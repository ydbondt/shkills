import { loadConfig, saveConfig } from '../paths.js';
import { say, style } from '../ui.js';

/**
 * Point this machine at a different Shkills address.
 *
 * A server that was reached by IP and later gets a DNS name is the same
 * server, so the link is deliberately kept: re-pointing must not log everyone
 * out. If it really is a different server the token will not be honoured, and
 * `shkills status` says so plainly.
 *
 * The installer calls this on every run, which is what makes re-running it the
 * cure for a machine that is still talking to a stale address.
 */
export function setHost(url: string): string {
  const host = url.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/\s]+$/i.test(host)) {
    throw new Error(`“${url}” is not an http(s) address — try http://shkills.yourcompany.com`);
  }
  const config = loadConfig();
  const previous = config.host;
  config.host = host;
  saveConfig(config);
  if (previous && previous !== host) {
    say(`${style.green('✓')} Now talking to ${style.bold(host)} ${style.dim(`(was ${previous})`)}`);
  } else {
    say(`${style.green('✓')} Talking to ${style.bold(host)}`);
  }
  return host;
}
