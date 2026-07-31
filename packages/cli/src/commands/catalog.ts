import fs from 'node:fs';
import path from 'node:path';
import { api } from '../api.js';
import { loadConfig, loadState, MARKER, skillsDir } from '../paths.js';
import { heading, plural, rows, say, style } from '../ui.js';
import { hookStatusLine } from './setup.js';
import { sync } from './sync.js';

interface CatalogSkill {
  slug: string;
  title: string;
  description: string;
  category: string;
  audiences: string[];
  version: number;
  published: boolean;
  archived: boolean;
  subscribed: boolean;
}

interface CollectionSummary {
  slug: string;
  name: string;
  description: string;
  skillCount: number;
  subscribed: boolean;
  isDefault: boolean;
}

/** What is actually installed on this machine, and why. */
export async function list(): Promise<void> {
  const mine = await api<{
    collections: { slug: string; name: string; isDefault: boolean }[];
    skills: { slug: string; title: string; category: string; version: number; sources: string[] }[];
  }>('/api/v1/subscriptions');

  if (mine.collections.length) {
    heading('Collections');
    rows(
      mine.collections.map((c) => [
        style.bold(c.name),
        c.isDefault ? 'company default' : `shkills unuse ${c.slug}`,
      ]),
    );
  }

  heading(`Skills  ${style.dim(`(${plural(mine.skills.length, 'skill')})`)}`);
  if (mine.skills.length === 0) {
    say(style.dim('  Nothing yet. Try `shkills browse` to see what is available.'));
    say();
    return;
  }
  rows(mine.skills.map((s) => [style.bold(s.slug), `v${s.version} · via ${s.sources.join(', ')}`]));
  say();
}

/** The whole company catalog, filtered. */
export async function browse(query?: string): Promise<void> {
  const search = query ? `?q=${encodeURIComponent(query)}&unpublished=0` : '?unpublished=0';
  const { skills } = await api<{ skills: CatalogSkill[] }>(`/api/v1/skills${search}`);

  heading(query ? `Skills matching “${query}”` : 'Company skill catalog');
  if (skills.length === 0) {
    say(style.dim('  Nothing found.'));
    say();
    return;
  }

  const byCategory = new Map<string, CatalogSkill[]>();
  for (const skill of skills) {
    byCategory.set(skill.category, [...(byCategory.get(skill.category) ?? []), skill]);
  }

  for (const [category, group] of [...byCategory].sort(([a], [b]) => a.localeCompare(b))) {
    say(`  ${style.dim(category.toUpperCase())}`);
    rows(
      group.map((s) => [
        `${s.subscribed ? style.green('•') : ' '} ${style.bold(s.slug)}`,
        truncate(s.description, 68),
      ]),
      '  ',
    );
    say();
  }
  say(style.dim('  shkills add <name>   to install one'));
  say();
}

export async function collections(): Promise<void> {
  const { collections: list } = await api<{ collections: CollectionSummary[] }>(
    '/api/v1/collections',
  );
  heading('Collections');
  rows(
    list.map((c) => [
      `${c.subscribed ? style.green('•') : ' '} ${style.bold(c.slug)}`,
      `${plural(c.skillCount, 'skill')}${c.isDefault ? ' · company default' : ''} — ${c.name}`,
    ]),
  );
  say();
  say(style.dim('  shkills use <name>   to add a whole set'));
  say();
}

export async function subscribe(kind: 'skill' | 'collection', slug: string): Promise<void> {
  await api('/api/v1/subscriptions', { method: 'POST', body: { kind, slug } });
  say(`${style.green('✓')} Added ${style.bold(slug)}.`);
  await sync({ force: true });
}

export async function unsubscribe(kind: 'skill' | 'collection', slug: string): Promise<void> {
  await api(`/api/v1/subscriptions/${kind}/${encodeURIComponent(slug)}`, { method: 'DELETE' });
  say(`${style.green('✓')} Removed ${style.bold(slug)}.`);
  await sync({ force: true });
}

export async function show(slug: string): Promise<void> {
  const { skill } = await api<{
    skill: { slug: string; owner: string; published: { renderedMd: string } | null };
  }>(`/api/v1/skills/${encodeURIComponent(slug)}`);
  if (!skill.published) {
    say(style.dim(`${slug} has no published version yet.`));
    return;
  }
  say(skill.published.renderedMd);
}

/** Everything a person needs when something looks wrong. */
export async function status(): Promise<void> {
  const config = loadConfig();
  const state = loadState();

  heading('Shkills');
  rows([
    ['Server', config.host || style.yellow('not configured')],
    ['Account', config.user ? `${config.user.name} <${config.user.email}>` : style.yellow('not linked')],
    ['Skills folder', skillsDir()],
    ['Auto-update', hookStatusLine()],
    ['Last sync', state.syncedAt ? new Date(state.syncedAt).toLocaleString() : style.dim('never')],
    ['Installed', plural(Object.keys(state.skills).length, 'skill')],
  ]);

  const managed = Object.keys(state.skills).sort();
  if (managed.length) {
    say();
    rows(
      managed.map((slug) => {
        const onDisk = fs.existsSync(path.join(skillsDir(), slug, 'SKILL.md'));
        return [
          `  ${onDisk ? style.green('•') : style.red('×')} ${slug}`,
          onDisk ? `v${state.skills[slug].version}` : 'missing on disk — run `shkills sync --force`',
        ];
      }),
    );
  }
  say();
}

/** Removes every skill Shkills installed, and nothing else. */
export function clean(): void {
  const state = loadState();
  const dir = skillsDir();
  let removed = 0;
  for (const slug of Object.keys(state.skills)) {
    const target = path.join(dir, slug);
    if (fs.existsSync(path.join(target, MARKER))) {
      fs.rmSync(target, { recursive: true, force: true });
      removed += 1;
    }
  }
  say(`${style.green('✓')} Removed ${plural(removed, 'skill')}.`);
}

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}
