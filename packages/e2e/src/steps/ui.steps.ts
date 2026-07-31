import { Given, Then, When } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import type { Locator } from 'playwright';
import { ShkillsWorld } from '../world.js';
import { signIn } from './sign-in.js';

/**
 * Every step below addresses the portal through `data-testid` and nothing else.
 * Copy, layout and styling can change freely; a scenario only breaks when the
 * behaviour it describes breaks. See docs/e2e-testing.md for the id conventions.
 */
function find(world: ShkillsWorld, testId: string): Locator {
  return world.page.locator(`[data-testid="${testId}"]`).first();
}

/** Page names, so scenarios say where they are rather than which URL that is. */
const PAGES: Record<string, string> = {
  'sign-in': '/signin',
  catalog: '/',
  collections: '/collections',
  review: '/review',
  'your setup': '/setup',
  people: '/people',
  'link a machine': '/link',
  'propose a skill': '/skills/new',
};

function pathFor(page: string): string {
  const known = PAGES[page];
  if (known) return known;
  throw new Error(`no page called "${page}" — known pages: ${Object.keys(PAGES).join(', ')}`);
}

// ---- getting somewhere ----------------------------------------------------

Given('I am signed in as {string}', async function (this: ShkillsWorld, email: string) {
  await signIn(this, email);
});

Given('I am signed out', async function (this: ShkillsWorld) {
  await this.context.clearCookies();
  this.signedInAs = undefined;
});

When('I open the {string} page', async function (this: ShkillsWorld, page: string) {
  await this.visit(pathFor(page));
});

When('I open the skill {string}', async function (this: ShkillsWorld, slug: string) {
  await this.visit(`/skills/${slug}`);
  await find(this, 'skill-detail').waitFor({ state: 'visible' });
});

When('I open the collection {string}', async function (this: ShkillsWorld, slug: string) {
  await this.visit(`/collections/${slug}`);
  await find(this, 'collection-detail').waitFor({ state: 'visible' });
});

Then('I am taken to the {string} page', async function (this: ShkillsWorld, page: string) {
  await this.page.waitForURL((url) => url.pathname === pathFor(page), { timeout: 10_000 });
});

Then('I am taken to the skill {string}', async function (this: ShkillsWorld, slug: string) {
  await this.page.waitForURL((url) => url.pathname === `/skills/${slug}`, { timeout: 10_000 });
});

// ---- doing things ---------------------------------------------------------

When('I click {string}', async function (this: ShkillsWorld, testId: string) {
  await find(this, testId).click();
});

When('I type {string} into {string}', async function (this: ShkillsWorld, value: string, testId: string) {
  await find(this, testId).fill(value);
});

When('I type into {string}:', async function (this: ShkillsWorld, testId: string, value: string) {
  await find(this, testId).fill(value);
});

When('I choose {string} in {string}', async function (this: ShkillsWorld, value: string, testId: string) {
  await find(this, testId).selectOption(value);
});

When('I tick {string}', async function (this: ShkillsWorld, testId: string) {
  await find(this, testId).check();
});

When('I untick {string}', async function (this: ShkillsWorld, testId: string) {
  await find(this, testId).uncheck();
});

When('I resize the window to {int} by {int}', async function (this: ShkillsWorld, width: number, height: number) {
  await this.page.setViewportSize({ width, height });
});

When('the browser is in dark mode', async function (this: ShkillsWorld) {
  await this.page.emulateMedia({ colorScheme: 'dark' });
});

When('I reload the page', async function (this: ShkillsWorld) {
  await this.page.reload({ waitUntil: 'domcontentloaded' });
});

// ---- seeing things --------------------------------------------------------

Then('I see {string}', async function (this: ShkillsWorld, testId: string) {
  await find(this, testId).waitFor({ state: 'visible', timeout: 10_000 });
});

Then('I do not see {string}', async function (this: ShkillsWorld, testId: string) {
  const element = find(this, testId);
  // Gone and hidden both count: what the scenario means is "not shown to me".
  await element.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => undefined);
  assert.ok(
    await element.isHidden(),
    `"${testId}" is on the page, and this scenario says it should not be`,
  );
});

Then('{string} says {string}', async function (this: ShkillsWorld, testId: string, expected: string) {
  const element = find(this, testId);
  await element.waitFor({ state: 'visible', timeout: 10_000 });
  await this.page
    .waitForFunction(
      ([id, text]) => document.querySelector(`[data-testid="${id}"]`)?.textContent?.includes(text) ?? false,
      [testId, expected] as const,
      { timeout: 10_000 },
    )
    .catch(async () => {
      assert.fail(`"${testId}" says "${(await element.textContent())?.trim()}", not "${expected}"`);
    });
});

Then('{string} does not say {string}', async function (this: ShkillsWorld, testId: string, unexpected: string) {
  const element = find(this, testId);
  await element.waitFor({ state: 'visible', timeout: 10_000 });
  const text = (await element.textContent()) ?? '';
  assert.ok(!text.includes(unexpected), `"${testId}" says "${text.trim()}", which contains "${unexpected}"`);
});

Then(
  '{string} is marked {string} as {string}',
  async function (this: ShkillsWorld, testId: string, attribute: string, expected: string) {
    const element = find(this, testId);
    await element.waitFor({ state: 'visible', timeout: 10_000 });
    await this.page
      .waitForFunction(
        ([id, attr, value]) =>
          document.querySelector(`[data-testid="${id}"]`)?.getAttribute(`data-${attr}`) === value,
        [testId, attribute, expected] as const,
        { timeout: 10_000 },
      )
      .catch(async () => {
        assert.fail(
          `"${testId}" is marked ${attribute} as "${await element.getAttribute(`data-${attribute}`)}", not "${expected}"`,
        );
      });
  },
);

Then('I see a message saying {string}', async function (this: ShkillsWorld, expected: string) {
  await this.page
    .locator(`[data-testid="toast"]`, { hasText: expected })
    .first()
    .waitFor({ state: 'visible', timeout: 10_000 });
});

Then('the page does not scroll sideways', async function (this: ShkillsWorld) {
  // Let the layout settle before measuring, or a mid-animation frame decides it.
  await this.page.waitForTimeout(400);
  const overflow = await this.page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  assert.ok(
    overflow.scrollWidth <= overflow.clientWidth + 1,
    `the page is ${overflow.scrollWidth}px wide in a ${overflow.clientWidth}px window, so it scrolls sideways`,
  );
});

Then('the text is readable against the background', async function (this: ShkillsWorld) {
  const { ink, surface } = await this.page.evaluate(() => {
    const styles = getComputedStyle(document.body);
    return { ink: styles.color, surface: styles.backgroundColor };
  });
  const luminance = (colour: string): number => {
    const [r, g, b] = (colour.match(/\d+(\.\d+)?/g) ?? ['0', '0', '0']).map(Number);
    const channel = (value: number) => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const [lighter, darker] = [luminance(ink), luminance(surface)].sort((a, b) => b - a);
  const contrast = (lighter + 0.05) / (darker + 0.05);
  assert.ok(contrast >= 4.5, `body text contrast is ${contrast.toFixed(2)}:1, which is below 4.5:1`);
});
