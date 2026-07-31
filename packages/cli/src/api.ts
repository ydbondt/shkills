import { loadConfig } from './paths.js';

export interface SyncSkill {
  slug: string;
  title: string;
  description: string;
  category: string;
  audiences: string[];
  tags: string[];
  version: number;
  checksum: string;
  content: string;
  sources: string[];
  updatedAt: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** Suppresses the automatic auth header — used by the login flow. */
  anonymous?: boolean;
  timeoutMs?: number;
}

export function host(): string {
  const { host: h } = loadConfig();
  if (!h) {
    throw new ApiError('no Shkills server configured — run `shkills login --host <url>`', 0);
  }
  return h.replace(/\/+$/, '');
}

export async function api<T>(pathname: string, options: RequestOptions = {}): Promise<T> {
  const { raw } = await apiRaw<T>(pathname, options);
  return raw as T;
}

/**
 * One place for every HTTP call: attaches the token, applies a timeout so a
 * hung server can never stall a Claude session, and turns error bodies into
 * readable messages.
 */
export async function apiRaw<T>(
  pathname: string,
  options: RequestOptions = {},
): Promise<{ raw: T | null; status: number; etag: string | null }> {
  const config = loadConfig();
  const headers: Record<string, string> = {
    accept: 'application/json',
    ...options.headers,
  };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (!options.anonymous && config.token) headers.authorization = `Bearer ${config.token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);

  let response: Response;
  try {
    response = await fetch(`${host()}${pathname}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
  } catch (err) {
    const reason = err instanceof Error && err.name === 'AbortError' ? 'timed out' : 'unreachable';
    throw new ApiError(`${host()} is ${reason}`, 0);
  } finally {
    clearTimeout(timer);
  }

  const etag = response.headers.get('etag');
  if (response.status === 304) return { raw: null, status: 304, etag };
  if (response.status === 204) return { raw: null, status: 204, etag };

  const text = await response.text();
  const parsed = text ? safeJson(text) : null;

  if (!response.ok) {
    const message =
      (parsed && typeof parsed === 'object' && 'error' in parsed
        ? String((parsed as { error: unknown }).error)
        : null) ?? `request failed with ${response.status}`;
    throw new ApiError(message, response.status);
  }
  return { raw: parsed as T, status: response.status, etag };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
