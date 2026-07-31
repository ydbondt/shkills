import { randomBytes } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

function envStr(key: string, fallback: string): string {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}

const dataDir = path.resolve(envStr('SHKILLS_DATA_DIR', path.join(process.cwd(), 'data')));
fs.mkdirSync(dataDir, { recursive: true });

/**
 * The JWT secret must survive restarts, otherwise every deploy logs everybody out.
 * In production it comes from the environment; for local runs we persist a
 * generated one next to the database so `npm run dev` just works.
 */
function resolveSecret(): string {
  const fromEnv = process.env.SHKILLS_JWT_SECRET;
  if (fromEnv) return fromEnv;
  const secretFile = path.join(dataDir, '.jwt-secret');
  if (fs.existsSync(secretFile)) return fs.readFileSync(secretFile, 'utf8').trim();
  const generated = randomBytes(48).toString('hex');
  fs.writeFileSync(secretFile, generated, { mode: 0o600 });
  return generated;
}

const publicUrl = envStr('SHKILLS_PUBLIC_URL', `http://localhost:${envStr('PORT', '4000')}`);

/**
 * Whether the session cookie carries `Secure`.
 *
 * This tracks the *public* URL's scheme, not NODE_ENV. A browser silently drops
 * a `Secure` cookie delivered over plain HTTP, which makes the portal look like
 * it accepts your password and then forgets you — so tying the flag to
 * NODE_ENV=production bricks every production deployment that has not got TLS
 * yet. The public URL is the one thing that knows how the browser reaches us,
 * including when TLS is terminated by a proxy in front of this process.
 *
 * `SHKILLS_SECURE_COOKIES` overrides it for setups the URL cannot describe.
 */
function resolveSecureCookies(): boolean {
  const override = process.env.SHKILLS_SECURE_COOKIES;
  if (override) return override === 'true' || override === '1';
  return publicUrl.startsWith('https://');
}

export const config = {
  port: Number(envStr('PORT', '4000')),
  dataDir,
  dbPath: envStr('SHKILLS_DB', path.join(dataDir, 'shkills.sqlite')),
  jwtSecret: resolveSecret(),
  /** Lifetime of a browser session token. */
  sessionTtl: '12h',
  /** Public base URL, used in install instructions and the device-auth prompt. */
  publicUrl,
  secureCookies: resolveSecureCookies(),
  isProduction: process.env.NODE_ENV === 'production',
};
