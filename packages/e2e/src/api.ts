/**
 * A tiny signed-in HTTP client, one per person in a scenario.
 *
 * Scenarios set their starting position through the API and then *assert*
 * through the UI or the CLI. Clicking a fixture into place would make every
 * scenario a page tour and hide what it is actually about.
 */
export class Api {
  private cookie = '';

  constructor(private readonly baseUrl: string) {}

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}/api${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(this.cookie ? { cookie: this.cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const setCookie = response.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];

    const text = await response.text();
    const payload = text ? (JSON.parse(text) as T & { error?: string }) : ({} as T);
    if (!response.ok) {
      const error = (payload as { error?: string }).error ?? response.statusText;
      throw new Error(`${method} ${path} → ${response.status}: ${error}`);
    }
    return payload;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', path, body);
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }

  del<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  /** For the endpoints that answer something other than JSON, like `/raw`. */
  async text(path: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api${path}`, {
      headers: { ...(this.cookie ? { cookie: this.cookie } : {}) },
    });
    if (!response.ok) throw new Error(`GET ${path} → ${response.status}`);
    return response.text();
  }

  /** The raw status, for the scenarios that assert an API refusal. */
  async attempt(method: string, path: string, body?: unknown): Promise<{ status: number; error: string }> {
    const response = await fetch(`${this.baseUrl}/api${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(this.cookie ? { cookie: this.cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const payload = text ? (JSON.parse(text) as { error?: string }) : {};
    return { status: response.status, error: payload.error ?? '' };
  }
}

export interface SkillVersion {
  id: number;
  version: number;
  status: string;
  body: string;
}

export interface SkillDetail {
  slug: string;
  archived: boolean;
  published: { version: number; body: string; renderedMd: string } | null;
  versions: SkillVersion[];
}
