/**
 * Fills an empty database with a believable company: a few people, a handful of
 * genuinely useful skills across departments, and the collections that tie them
 * together. Safe to run repeatedly — it does nothing if data already exists.
 */
import { db } from './db.js';
import { hashPassword } from './auth.js';
import { createSkill, type SkillDraft } from './services/skills.js';
import type { AuthUser } from './auth.js';

const existing = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
if (existing > 0 && !process.argv.includes('--force')) {
  console.log('Database already has data — nothing to seed. Use --force to add anyway.');
  process.exit(0);
}

function addUser(
  email: string,
  name: string,
  role: 'member' | 'curator' | 'admin',
  department: string,
): AuthUser {
  const id = Number(
    db
      .prepare(
        'INSERT INTO users (email, name, password_hash, role, department) VALUES (?, ?, ?, ?, ?)',
      )
      .run(email, name, hashPassword('shkills123'), role, department).lastInsertRowid,
  );
  return { id, email, name, role, department };
}

const maya = addUser('maya@acme.test', 'Maya Chen', 'admin', 'engineering');
const rob = addUser('rob@acme.test', 'Rob Alvarez', 'curator', 'engineering');
const sofia = addUser('sofia@acme.test', 'Sofia Novak', 'curator', 'sales');
const dan = addUser('dan@acme.test', 'Dan Whitfield', 'member', 'product');
const ines = addUser('ines@acme.test', 'Inès Perrot', 'member', 'engineering');

type Seed = SkillDraft & { author: AuthUser; pending?: boolean };

const skills: Seed[] = [
  {
    author: rob,
    slug: 'commit-messages',
    title: 'Commit Messages',
    description:
      'Use when writing a git commit message or a pull request title, to follow the Acme conventional-commit format.',
    category: 'engineering',
    audiences: ['engineering'],
    tags: ['git', 'conventions'],
    userInvocable: false,
    changeNote: 'Initial version',
    body: `Write every commit subject as \`type(scope): summary\`.

**Types** — \`feat\`, \`fix\`, \`refactor\`, \`perf\`, \`test\`, \`docs\`, \`build\`, \`chore\`.

**Rules**
- Keep the subject under 72 characters, in the imperative mood ("add", not "added").
- Scope is the package or service name, lowercase.
- Explain *why* in the body, not *what* — the diff already says what.
- Reference the Jira ticket on its own trailing line: \`Refs: ACME-1234\`.

**Example**

\`\`\`
fix(billing): stop double-charging annual renewals

Renewals ran through both the scheduler and the webhook path when a
customer upgraded mid-cycle. Make the webhook the only writer.

Refs: ACME-4821
\`\`\``,
  },
  {
    author: rob,
    slug: 'code-review',
    title: 'Code Review Standards',
    description:
      'Use when reviewing a pull request or asked to review code, to apply the Acme review checklist and comment conventions.',
    category: 'engineering',
    audiences: ['engineering'],
    tags: ['review', 'quality'],
    userInvocable: true,
    changeNote: 'Initial version',
    body: `Review in this order and stop at the first level that has problems.

1. **Correctness** — does it do what the ticket asked? Look for the failure case
   the author did not consider: empty input, concurrent writes, partial failure.
2. **Tests** — is the new behaviour covered? A test that cannot fail is not a test.
3. **Interfaces** — public names, error shapes and migrations are expensive to
   change later. Everything else is cheap.
4. **Style** — only what the linter cannot catch.

**Comment conventions**

- \`blocking:\` must be fixed before merge.
- \`consider:\` a suggestion; the author decides.
- \`nit:\` cosmetic, never blocking.
- \`question:\` you genuinely do not know — ask before asserting.

Praise the good parts explicitly. Reviews that only contain criticism train
people to fear review.`,
  },
  {
    author: rob,
    slug: 'incident-response',
    title: 'Incident Response',
    description:
      'Use during a production incident or outage, to run the Acme incident process and write the postmortem.',
    category: 'engineering',
    audiences: ['engineering', 'support'],
    tags: ['oncall', 'sre'],
    userInvocable: true,
    changeNote: 'Initial version',
    body: `**Mitigate first. Understand second.** A rollback you can explain tomorrow beats
a root cause you find at 3am.

**The first five minutes**
1. Declare in \`#incidents\` — severity, one-line impact, who is driving.
2. Assign roles: driver, comms, scribe. One person never holds two.
3. Check the last deploy. Most incidents are the previous change.

**Severity**
- **Sev1** — customers cannot use the product. Page immediately.
- **Sev2** — degraded or a major feature is broken. Page during business hours.
- **Sev3** — annoying, contained, no data at risk. Ticket it.

**Postmortem**, within three working days: timeline, impact in customer terms,
contributing causes, and action items with owners and dates. Blameless — the
question is always "what made this easy to do", never "who did it".`,
  },
  {
    author: maya,
    slug: 'writing-style',
    title: 'Acme Writing Style',
    description:
      'Use when writing anything customers or colleagues will read — docs, release notes, emails, UI copy — to match the Acme voice.',
    category: 'communication',
    audiences: ['engineering', 'sales', 'product', 'support', 'marketing'],
    tags: ['writing', 'voice'],
    userInvocable: false,
    changeNote: 'Initial version',
    body: `Write the way a knowledgeable colleague speaks: plain, direct, warm, never breathless.

**Do**
- Lead with the thing the reader needs. Context second.
- Use short sentences and ordinary words. "Use", not "utilise".
- Address the reader as "you". Say "we" only when Acme is genuinely acting.
- Give real numbers and dates instead of "soon" or "significantly faster".

**Don't**
- No hype: "revolutionary", "seamless", "game-changing", "delighted to announce".
- No apology padding: "sorry for any inconvenience this may have caused".
- No exclamation marks in product copy. One per email, at most.
- Never blame the customer. "The file is too large" beats "you uploaded too much".

**Error messages** say what happened, why, and what to do next — in that order,
in one sentence each.`,
  },
  {
    author: sofia,
    slug: 'discovery-call',
    title: 'Discovery Calls',
    description:
      'Use when preparing for or following up on a sales discovery call, to qualify with the Acme framework and write the recap.',
    category: 'sales',
    audiences: ['sales'],
    tags: ['discovery', 'qualification'],
    userInvocable: true,
    changeNote: 'Initial version',
    body: `The goal of discovery is a decision, not a demo. Leave knowing whether this is real.

**Qualify on four things**
- **Pain** — what breaks today, and what does it cost them per month?
- **Authority** — who signs, and who can quietly say no?
- **Timeline** — what event forces a decision? No event, no deal.
- **Alternative** — what happens if they do nothing? That is your real competitor.

**Questions that work**
- "Walk me through the last time this went wrong."
- "Who else feels this problem?"
- "What have you already tried?"
- "If this were solved, what changes for you personally?"

**Recap email**, same day: their words for the problem, the cost they quoted,
agreed next step with a date, and who owns it. If you cannot write their pain in
their own language, you did not do discovery.`,
  },
  {
    author: sofia,
    slug: 'security-questionnaire',
    title: 'Security Questionnaires',
    description:
      'Use when a prospect sends a security questionnaire, vendor assessment or RFP security section, to answer accurately from approved language.',
    category: 'sales',
    audiences: ['sales', 'support'],
    tags: ['compliance', 'rfp'],
    userInvocable: true,
    changeNote: 'Initial version',
    body: `**Never invent a control.** A wrong yes becomes a contractual promise.

**Process**
1. Answer only from the approved control descriptions in the trust centre.
2. Anything not covered there goes to \`#security-review\` — do not paraphrase.
3. Mark roadmap items as roadmap, with a quarter, never as current.
4. Send the SOC 2 report under NDA; never paste excerpts into a spreadsheet.

**Standard answers**
- Data at rest: AES-256. In transit: TLS 1.2+.
- SSO via SAML 2.0 and OIDC on all paid plans; SCIM on Enterprise.
- Sub-processors are listed publicly and customers get 30 days notice of changes.
- Data residency: EU or US, chosen at provisioning, not movable afterwards.

If the honest answer is "not yet", say "not yet" and give the quarter. Buyers
forgive gaps; they do not forgive surprises during implementation.`,
  },
  {
    author: dan,
    slug: 'product-brief',
    title: 'Product Briefs',
    description:
      'Use when starting a new feature or writing a spec, PRD or product brief, to follow the Acme one-page brief format.',
    category: 'product',
    audiences: ['product', 'engineering', 'design'],
    tags: ['prd', 'planning'],
    userInvocable: true,
    changeNote: 'Initial version',
    body: `One page. If it needs two, the problem is not understood yet.

**The six sections**
1. **Problem** — whose problem, how often, what it costs them. Evidence, not intuition.
2. **Why now** — what changed. "A customer asked" is not a reason.
3. **Success** — the one metric that moves, with today's number and the target.
4. **Approach** — the shape of the solution in a paragraph. No screens yet.
5. **Not doing** — the tempting scope you are explicitly cutting.
6. **Risks** — what would make this a mistake, and how you would find out early.

Write section 6 honestly or do not write it at all. A brief with no risks is a
brief nobody thought about.`,
  },
  {
    author: dan,
    slug: 'customer-interview',
    title: 'Customer Interviews',
    description:
      'Use when planning or writing up a customer interview or user research session, to ask non-leading questions and record findings.',
    category: 'product',
    audiences: ['product', 'design', 'marketing'],
    tags: ['research', 'discovery'],
    userInvocable: true,
    changeNote: 'Initial version',
    body: `Ask about the past, never the future. People are excellent historians and
terrible predictors of their own behaviour.

**Good**
- "Tell me about the last time you did X."
- "What did you do right before that?"
- "How do you handle it today?"
- Silence. Wait three seconds after they stop. The second sentence is the true one.

**Bad**
- "Would you use a feature that…" — everyone says yes.
- "Do you find X frustrating?" — you just supplied the answer.
- Anything mentioning your solution before minute twenty.

**Writing it up**: quote them verbatim, note what they *did* separately from what
they *said*, and record the workaround they built. The workaround is the spec.`,
  },
  {
    author: ines,
    slug: 'api-design',
    title: 'API Design',
    description:
      'Use when designing or changing an HTTP API, endpoint or public interface, to follow Acme API conventions and versioning rules.',
    category: 'engineering',
    audiences: ['engineering'],
    tags: ['api', 'http'],
    userInvocable: false,
    changeNote: 'Proposed after the v2 billing API review',
    pending: true,
    body: `**Nouns for resources, verbs only for actions that are not CRUD.**

**Conventions**
- Plural, kebab-case paths: \`/api/v1/invoice-runs\`.
- \`camelCase\` JSON fields. Timestamps are ISO 8601 UTC with a \`At\` suffix.
- Every list endpoint is paginated from day one: \`?limit=\` and \`?cursor=\`.
- Errors return \`{ "error": "human readable sentence" }\` and the right status.
  400 you sent nonsense, 401 who are you, 403 not allowed, 404 not there,
  409 conflicts with current state, 422 valid JSON but not valid data.

**Compatibility**
Adding an optional field is free. Everything else — renaming, removing, changing
a type, making something required, tightening validation — is a new version.

Never return 200 with an error in the body. Somebody's retry logic depends on
the status code.`,
  },
];

const created = new Map<string, number>();
for (const seed of skills) {
  const { author, pending, ...draft } = seed;
  const { skill } = createSkill(author, draft, { submitForReview: pending });
  created.set(draft.slug, skill.id);
}

function addCollection(
  slug: string,
  name: string,
  description: string,
  audience: string,
  isDefault: boolean,
  members: string[],
): void {
  const id = Number(
    db
      .prepare(
        'INSERT INTO collections (slug, name, description, audience, is_default, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(slug, name, description, audience, isDefault ? 1 : 0, maya.id).lastInsertRowid,
  );
  members.forEach((member, index) => {
    const skillId = created.get(member);
    if (skillId) {
      db.prepare(
        'INSERT INTO collection_skills (collection_id, skill_id, position) VALUES (?, ?, ?)',
      ).run(id, skillId, index);
    }
  });
}

addCollection(
  'everyone',
  'Everyone at Acme',
  'How we write and how we work. Installed for every person automatically.',
  'general',
  true,
  ['writing-style'],
);
addCollection(
  'engineering',
  'Engineering',
  'Conventions every engineer is expected to follow.',
  'engineering',
  false,
  ['commit-messages', 'code-review', 'incident-response'],
);
addCollection(
  'sales',
  'Sales',
  'How we qualify, and how we answer the hard questions.',
  'sales',
  false,
  ['discovery-call', 'security-questionnaire'],
);
addCollection(
  'product',
  'Product & Design',
  'Briefs, research, and deciding what not to build.',
  'product',
  false,
  ['product-brief', 'customer-interview'],
);

// Give the sample people a plausible starting setup.
const subscribe = db.prepare(
  'INSERT OR IGNORE INTO subscriptions (user_id, kind, target_id) VALUES (?, ?, ?)',
);
const collectionId = (slug: string) =>
  (db.prepare('SELECT id FROM collections WHERE slug = ?').get(slug) as { id: number }).id;

for (const user of [maya, rob, ines]) subscribe.run(user.id, 'collection', collectionId('engineering'));
subscribe.run(sofia.id, 'collection', collectionId('sales'));
subscribe.run(dan.id, 'collection', collectionId('product'));
subscribe.run(dan.id, 'collection', collectionId('engineering'));

console.log(`Seeded ${skills.length} skills, 4 collections and 5 people.`);
console.log('');
console.log('  Sign in at the portal with any of these — password: shkills123');
console.log('');
console.log('    maya@acme.test    admin, engineering');
console.log('    rob@acme.test     curator, engineering');
console.log('    sofia@acme.test   curator, sales');
console.log('    dan@acme.test     member, product');
console.log('    ines@acme.test    member, engineering');
console.log('');
console.log('  One skill (api-design) is waiting in the review queue.');
