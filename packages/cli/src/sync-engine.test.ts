import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { applySync } from './sync-engine.js';
import type { SyncSkill } from './api.js';
import type { CliState } from './paths.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shkills-sync-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function skill(slug: string, body = 'do the thing', version = 1): SyncSkill {
  const content = `---\nname: ${slug}\ndescription: "…"\n---\n\n${body}\n`;
  return {
    slug,
    title: slug,
    description: '…',
    category: 'general',
    audiences: [],
    tags: [],
    version,
    // A checksum that actually tracks the content keeps the tests honest.
    checksum: createHash('sha256').update(content).digest('hex').slice(0, 16),
    content,
    sources: ['direct'],
    updatedAt: new Date().toISOString(),
  };
}

const empty: CliState = { skills: {} };

describe('writing skills to disk', () => {
  it('installs a skill where Claude will find it', () => {
    const { outcome, nextState } = applySync(dir, [skill('code-review')], empty);

    expect(outcome.installed).toEqual(['code-review']);
    expect(fs.readFileSync(path.join(dir, 'code-review', 'SKILL.md'), 'utf8')).toContain(
      'name: code-review',
    );
    expect(nextState.skills['code-review'].version).toBe(1);
  });

  it('rewrites a skill when its content changed', () => {
    const first = applySync(dir, [skill('code-review')], empty);
    const { outcome } = applySync(
      dir,
      [skill('code-review', 'do the thing differently', 2)],
      first.nextState,
    );

    expect(outcome.updated).toEqual(['code-review']);
    expect(fs.readFileSync(path.join(dir, 'code-review', 'SKILL.md'), 'utf8')).toContain(
      'differently',
    );
  });

  it('does no work when nothing changed', () => {
    const first = applySync(dir, [skill('code-review')], empty);
    const { outcome } = applySync(dir, [skill('code-review')], first.nextState);

    expect(outcome.unchanged).toEqual(['code-review']);
    expect(outcome.updated).toEqual([]);
  });

  it('removes a skill once it stops being served', () => {
    const first = applySync(dir, [skill('code-review'), skill('commit-messages')], empty);
    const { outcome, nextState } = applySync(dir, [skill('code-review')], first.nextState);

    expect(outcome.removed).toEqual(['commit-messages']);
    expect(fs.existsSync(path.join(dir, 'commit-messages'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'code-review'))).toBe(true);
    expect(nextState.skills['commit-messages']).toBeUndefined();
  });

  it('refuses to overwrite a skill the user wrote themselves', () => {
    const handWritten = path.join(dir, 'code-review');
    fs.mkdirSync(handWritten, { recursive: true });
    fs.writeFileSync(path.join(handWritten, 'SKILL.md'), 'my own precious skill');

    const { outcome } = applySync(dir, [skill('code-review')], empty);

    expect(outcome.installed).toEqual([]);
    expect(outcome.skipped[0].slug).toBe('code-review');
    expect(fs.readFileSync(path.join(handWritten, 'SKILL.md'), 'utf8')).toBe(
      'my own precious skill',
    );
  });

  it('leaves an unmanaged directory alone even when it is dropped from the set', () => {
    const first = applySync(dir, [skill('code-review')], empty);

    // Someone takes ownership of the folder by deleting our marker.
    fs.rmSync(path.join(dir, 'code-review', '.shkills.json'));

    const { outcome } = applySync(dir, [], first.nextState);
    expect(outcome.removed).toEqual([]);
    expect(outcome.skipped[0].slug).toBe('code-review');
    expect(fs.existsSync(path.join(dir, 'code-review', 'SKILL.md'))).toBe(true);
  });

  it('reinstalls a skill that vanished from disk', () => {
    const first = applySync(dir, [skill('code-review')], empty);
    fs.rmSync(path.join(dir, 'code-review'), { recursive: true });

    const { outcome } = applySync(dir, [skill('code-review')], first.nextState);
    expect(outcome.installed).toEqual(['code-review']);
    expect(fs.existsSync(path.join(dir, 'code-review', 'SKILL.md'))).toBe(true);
  });

  it('touches nothing during a dry run', () => {
    const { outcome } = applySync(dir, [skill('code-review')], empty, { dryRun: true });
    expect(outcome.installed).toEqual(['code-review']);
    expect(fs.existsSync(path.join(dir, 'code-review'))).toBe(false);
  });

  it('creates the skills folder when Claude has never had one', () => {
    const fresh = path.join(dir, 'nested', 'skills');
    applySync(fresh, [skill('code-review')], empty);
    expect(fs.existsSync(path.join(fresh, 'code-review', 'SKILL.md'))).toBe(true);
  });
});
