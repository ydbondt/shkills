/**
 * Keeps docs/acceptance-criteria.md and the feature files honest about each
 * other: every criterion must be claimed by a scenario, and no scenario may
 * claim a criterion that does not exist. Without this the mapping rots quietly,
 * which is worse than having no mapping at all.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const featuresDir = path.join(here, '..', 'features');
const criteriaFile = path.resolve(here, '../../../docs/acceptance-criteria.md');

const criteria = new Set(
  [...fs.readFileSync(criteriaFile, 'utf8').matchAll(/\*\*(AC-\d+)\*\*/g)].map((match) => match[1]),
);

const tagged = new Map();
for (const file of fs.readdirSync(featuresDir).filter((name) => name.endsWith('.feature'))) {
  const text = fs.readFileSync(path.join(featuresDir, file), 'utf8');
  for (const match of text.matchAll(/@(AC-\d+)/g)) {
    tagged.set(match[1], (tagged.get(match[1]) ?? 0) + 1);
  }
}

const uncovered = [...criteria].filter((id) => !tagged.has(id));
const unknown = [...tagged.keys()].filter((id) => !criteria.has(id));

const number = (id) => Number(id.slice(3));
uncovered.sort((a, b) => number(a) - number(b));
unknown.sort((a, b) => number(a) - number(b));

if (uncovered.length || unknown.length) {
  if (uncovered.length) {
    console.error(`Acceptance criteria with no scenario: ${uncovered.join(', ')}`);
  }
  if (unknown.length) {
    console.error(`Scenarios tagged with criteria that do not exist: ${unknown.join(', ')}`);
  }
  process.exit(1);
}

const claims = [...tagged.values()].reduce((total, count) => total + count, 0);
console.log(`${criteria.size} acceptance criteria, each claimed by a scenario (${claims} claims in all).`);
