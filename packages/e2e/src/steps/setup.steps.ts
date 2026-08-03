import { Given, type DataTable } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { ShkillsWorld, type Person } from '../world.js';

/** One password for everybody in a test — nothing here guards anything. */
const PASSWORD = 'correct-horse-battery';

function titleCase(slug: string): string {
  return slug
    .split('-')
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * A believable skill with as little ceremony as possible. The category follows
 * the author's department, which is both what happens in practice and what
 * makes "filter by category" mean something without a scenario spelling it out.
 */
function defaultDraft(author: Person, slug: string, body?: string) {
  return {
    slug,
    title: titleCase(slug),
    description: `Use when working on ${titleCase(slug).toLowerCase()}, to follow the company way.`,
    category: author.department,
    audiences: [author.department],
    tags: [slug.split('-')[0]],
    userInvocable: false,
    changeNote: 'Initial version',
    body: body ?? `Follow the company standard for ${slug}.\n\n- Do the careful thing.\n- Say why.`,
  };
}

/**
 * Introduces the company. The first row is registered through the public
 * signup, which is how a real instance gets its administrator; everyone else is
 * created by that administrator with the role the table asks for.
 */
Given('these people:', async function (this: ShkillsWorld, table: DataTable) {
  const rows = table.hashes() as { name: string; email: string; role: Person['role']; department?: string }[];
  const [first, ...rest] = rows;
  assert.equal(
    first.role,
    'admin',
    'the first person in the table becomes the administrator of a brand new Shkills, so list an admin first',
  );

  const remember = (row: (typeof rows)[number]) => {
    const person: Person = {
      email: row.email.toLowerCase(),
      name: row.name,
      password: PASSWORD,
      role: row.role,
      department: row.department ?? 'engineering',
    };
    this.people.set(person.email, person);
    return person;
  };

  const admin = remember(first);
  await this.anonymous().post('/v1/auth/register', {
    email: admin.email,
    password: admin.password,
    name: admin.name,
    department: admin.department,
  });

  const adminApi = await this.as(admin.email);
  for (const row of rest) {
    const person = remember(row);
    await adminApi.post('/v1/admin/users', {
      email: person.email,
      name: person.name,
      password: person.password,
      role: person.role,
      department: person.department,
    });
  }
});

Given(
  '{string} has published the skill {string}',
  async function (this: ShkillsWorld, email: string, slug: string) {
    const api = await this.as(email);
    await api.post('/v1/skills', { ...defaultDraft(this.person(email), slug), submitForReview: false });
  },
);

Given(
  '{string} has published the skill {string} saying:',
  async function (this: ShkillsWorld, email: string, slug: string, body: string) {
    const api = await this.as(email);
    await api.post('/v1/skills', {
      ...defaultDraft(this.person(email), slug, body),
      submitForReview: false,
    });
  },
);

Given(
  '{string} has proposed the skill {string}',
  async function (this: ShkillsWorld, email: string, slug: string) {
    const api = await this.as(email);
    await api.post('/v1/skills', { ...defaultDraft(this.person(email), slug), submitForReview: true });
  },
);

Given(
  '{string} has proposed a change to {string} saying:',
  async function (this: ShkillsWorld, email: string, slug: string, body: string) {
    const api = await this.as(email);
    await api.post(`/v1/skills/${slug}/versions`, {
      ...defaultDraft(this.person(email), slug, body),
      changeNote: 'A revision worth reviewing',
      submitForReview: true,
    });
  },
);

Given(
  '{string} has published a change to {string} saying:',
  async function (this: ShkillsWorld, email: string, slug: string, body: string) {
    const api = await this.as(email);
    await api.post(`/v1/skills/${slug}/versions`, {
      ...defaultDraft(this.person(email), slug, body),
      changeNote: 'A published revision',
      submitForReview: false,
    });
  },
);

/**
 * A skill nobody else will ever see. No review, whoever writes it — which is
 * what makes it usable for trying something out.
 */
Given(
  '{string} has a skill of their own called {string}',
  async function (this: ShkillsWorld, email: string, slug: string) {
    const api = await this.as(email);
    await api.post('/v1/skills', { ...defaultDraft(this.person(email), slug), visibility: 'personal' });
  },
);

Given(
  '{string} has a skill of their own called {string} saying:',
  async function (this: ShkillsWorld, email: string, slug: string, body: string) {
    const api = await this.as(email);
    await api.post('/v1/skills', {
      ...defaultDraft(this.person(email), slug, body),
      visibility: 'personal',
    });
  },
);

Given(
  '{string} has offered {string} to everybody',
  async function (this: ShkillsWorld, email: string, slug: string) {
    const api = await this.as(email);
    await api.post(`/v1/skills/${slug}/share`);
  },
);

Given('the skill {string} is archived', async function (this: ShkillsWorld, slug: string) {
  const api = await this.as(this.curatorEmail());
  await api.del(`/v1/skills/${slug}`);
});

Given(
  'a collection {string} containing:',
  async function (this: ShkillsWorld, slug: string, table: DataTable) {
    await this.createCollection(slug, false, table.raw().flat());
  },
);

Given('a collection {string}', async function (this: ShkillsWorld, slug: string) {
  await this.createCollection(slug, false, []);
});

Given(
  'a company-wide collection {string} containing:',
  async function (this: ShkillsWorld, slug: string, table: DataTable) {
    await this.createCollection(slug, true, table.raw().flat());
  },
);

Given(
  '{string} has joined the collection {string}',
  async function (this: ShkillsWorld, email: string, slug: string) {
    const api = await this.as(email);
    await api.post('/v1/subscriptions', { kind: 'collection', slug });
  },
);

Given(
  '{string} has added the skill {string}',
  async function (this: ShkillsWorld, email: string, slug: string) {
    const api = await this.as(email);
    await api.post('/v1/subscriptions', { kind: 'skill', slug });
  },
);
