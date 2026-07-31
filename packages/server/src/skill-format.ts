import { createHash } from 'node:crypto';

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface SkillFrontmatter {
  slug: string;
  title: string;
  description: string;
  category: string;
  audiences: string[];
  tags: string[];
  allowedTools?: string | null;
  userInvocable: boolean;
  body: string;
  version: number;
}

/**
 * YAML double-quoted scalars use the same escaping rules as JSON for the
 * characters we can actually encounter here, so JSON.stringify is a safe and
 * dependency-free way to emit a value that survives colons, quotes and newlines.
 */
function yamlString(value: string): string {
  return JSON.stringify(value);
}

/**
 * Renders the exact bytes Claude Code will read from
 * `~/.claude/skills/<slug>/SKILL.md`.
 *
 * Rendering lives on the server on purpose: the SKILL.md format is Claude's, not
 * ours, so when it evolves we change it in one place and every already-installed
 * CLI picks it up on the next sync without an upgrade.
 */
export function renderSkillMd(s: SkillFrontmatter): string {
  const lines: string[] = ['---'];
  lines.push(`name: ${s.slug}`);
  lines.push(`description: ${yamlString(s.description)}`);
  if (s.userInvocable) lines.push('user-invocable: true');
  if (s.allowedTools && s.allowedTools.trim()) {
    lines.push(`allowed-tools: ${yamlString(s.allowedTools.trim())}`);
  }
  lines.push('---');
  lines.push('');
  lines.push(`# ${s.title}`);
  lines.push('');
  lines.push(s.body.trim());
  lines.push('');
  lines.push('---');
  lines.push('');
  const meta = [`Category: ${s.category}`, `Version: ${s.version}`];
  if (s.audiences.length) meta.push(`Audience: ${s.audiences.join(', ')}`);
  if (s.tags.length) meta.push(`Tags: ${s.tags.join(', ')}`);
  lines.push(`<!-- Managed by Shkills. ${meta.join(' · ')} -->`);
  lines.push('<!-- Local edits are overwritten on the next sync. Propose changes in the Shkills portal. -->');
  lines.push('');
  return lines.join('\n');
}

export function checksum(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 16);
}

/** Stable fingerprint of a whole skill set, used for cheap 304 sync responses. */
export function manifestChecksum(entries: { slug: string; checksum: string }[]): string {
  const canonical = [...entries]
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map((e) => `${e.slug}:${e.checksum}`)
    .join('\n');
  return createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 16);
}
