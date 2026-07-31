import fs from 'node:fs';
import path from 'node:path';
import type { SyncSkill } from './api.js';
import { MARKER, type CliState } from './paths.js';

export interface SyncOutcome {
  installed: string[];
  updated: string[];
  removed: string[];
  unchanged: string[];
  /** Directories we refused to touch because a human wrote them. */
  skipped: { slug: string; reason: string }[];
}

interface Marker {
  managedBy: 'shkills';
  slug: string;
  version: number;
  checksum: string;
  syncedAt: string;
}

function markerPath(dir: string): string {
  return path.join(dir, MARKER);
}

function isOurs(dir: string): boolean {
  try {
    const marker = JSON.parse(fs.readFileSync(markerPath(dir), 'utf8')) as Marker;
    return marker.managedBy === 'shkills';
  } catch {
    return false;
  }
}

/**
 * Writes the skill set to disk.
 *
 * The single rule this function exists to enforce: never modify or delete a
 * skill directory that Shkills did not create. Somebody's hand-written skill
 * losing to a name collision would be far worse than a skill failing to install.
 */
export function applySync(
  skillsDir: string,
  remote: SyncSkill[],
  state: CliState,
  options: { dryRun?: boolean } = {},
): { outcome: SyncOutcome; nextState: CliState } {
  const outcome: SyncOutcome = {
    installed: [],
    updated: [],
    removed: [],
    unchanged: [],
    skipped: [],
  };
  const nextSkills: CliState['skills'] = {};
  const dry = options.dryRun === true;

  if (!dry) fs.mkdirSync(skillsDir, { recursive: true });

  for (const skill of remote) {
    const dir = path.join(skillsDir, skill.slug);
    const known = state.skills[skill.slug];
    const exists = fs.existsSync(dir);

    if (exists && !isOurs(dir)) {
      outcome.skipped.push({
        slug: skill.slug,
        reason: 'a skill of your own already uses that name',
      });
      continue;
    }

    if (exists && known && known.checksum === skill.checksum && fs.existsSync(path.join(dir, 'SKILL.md'))) {
      outcome.unchanged.push(skill.slug);
      nextSkills[skill.slug] = { version: skill.version, checksum: skill.checksum };
      continue;
    }

    if (!dry) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'SKILL.md'), skill.content, 'utf8');
      const marker: Marker = {
        managedBy: 'shkills',
        slug: skill.slug,
        version: skill.version,
        checksum: skill.checksum,
        syncedAt: new Date().toISOString(),
      };
      fs.writeFileSync(markerPath(dir), `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
    }

    (exists ? outcome.updated : outcome.installed).push(skill.slug);
    nextSkills[skill.slug] = { version: skill.version, checksum: skill.checksum };
  }

  // Anything we installed before and no longer receive has been unsubscribed,
  // archived or deleted centrally — take it back off the machine.
  const remoteSlugs = new Set(remote.map((s) => s.slug));
  for (const slug of Object.keys(state.skills)) {
    if (remoteSlugs.has(slug)) continue;
    const dir = path.join(skillsDir, slug);
    if (!fs.existsSync(dir)) {
      outcome.removed.push(slug);
      continue;
    }
    if (!isOurs(dir)) {
      outcome.skipped.push({ slug, reason: 'no longer managed, and edited locally — left alone' });
      continue;
    }
    if (!dry) fs.rmSync(dir, { recursive: true, force: true });
    outcome.removed.push(slug);
  }

  return {
    outcome,
    nextState: {
      ...state,
      skills: nextSkills,
      syncedAt: new Date().toISOString(),
    },
  };
}

export function changeCount(outcome: SyncOutcome): number {
  return outcome.installed.length + outcome.updated.length + outcome.removed.length;
}
