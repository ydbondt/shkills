export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });

  const text = await response.text();
  const body = text ? safeParse(text) : null;

  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : `Something went wrong (${response.status}).`;
    throw new ApiError(message, response.status);
  }
  return body as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

// ---- shared shapes -------------------------------------------------------

export type Role = 'member' | 'curator' | 'admin';

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
  department: string;
}

export type Visibility = 'personal' | 'shared';

/** Where a personal skill stands with the curators. */
export type ShareStatus = 'none' | 'pending' | 'declined';

export interface SkillSummary {
  id: number;
  slug: string;
  title: string;
  description: string;
  category: string;
  audiences: string[];
  tags: string[];
  version: number;
  published: boolean;
  archived: boolean;
  owner: string;
  visibility: Visibility;
  shareStatus: ShareStatus;
  pendingCount: number;
  updatedAt: string;
  subscribed: boolean;
}

export interface SkillVersion {
  id: number;
  version: number;
  title: string;
  description: string;
  category: string;
  audiences: string[];
  tags: string[];
  allowedTools: string | null;
  userInvocable: boolean;
  body: string;
  changeNote: string;
  status: 'draft' | 'pending' | 'approved' | 'rejected' | 'superseded';
  author: string | null;
  reviewer: string | null;
  reviewNote: string | null;
  checksum: string;
  createdAt: string;
  reviewedAt: string | null;
}

export interface SkillDetail {
  id: number;
  slug: string;
  owner: string;
  mine: boolean;
  visibility: Visibility;
  shareStatus: ShareStatus;
  shareNote: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  subscribed: boolean;
  collections: { slug: string; name: string }[];
  published: (SkillVersion & { renderedMd: string }) | null;
  versions: SkillVersion[];
}

export interface Collection {
  id: number;
  slug: string;
  name: string;
  description: string;
  audience: string;
  isDefault: boolean;
  skillCount: number;
  subscribed: boolean;
  locked: boolean;
}

export interface Proposal {
  versionId: number;
  skillId: number;
  slug: string;
  version: number;
  title: string;
  description: string;
  category: string;
  audiences: string[];
  tags: string[];
  body: string;
  changeNote: string;
  author: string;
  createdAt: string;
  isNewSkill: boolean;
}

/** Somebody offering a skill they have been keeping to themselves. */
export interface ShareRequest {
  skillId: number;
  slug: string;
  version: number;
  title: string;
  description: string;
  category: string;
  audiences: string[];
  tags: string[];
  body: string;
  owner: string;
  askedAt: string | null;
}

/**
 * Where the company skills are mirrored to. `hasToken` is deliberately a
 * boolean: the server never hands the credential back.
 */
export interface GitMirror {
  enabled: boolean;
  owner: string;
  repo: string;
  branch: string;
  pathPrefix: string;
  lastRunAt: string | null;
  lastCommit: string | null;
  lastError: string | null;
  hasToken: boolean;
  fileCount: number;
}

export interface MirrorResult {
  ok: boolean;
  commit: string | null;
  added: string[];
  updated: string[];
  removed: string[];
  error?: string;
}

export interface Stats {
  skills: number;
  pending: number;
  collections: number;
  people: number;
  linkedDevices: number;
  syncedLastDay: number;
}

export function canCurate(user: User | null): boolean {
  return user?.role === 'curator' || user?.role === 'admin';
}
