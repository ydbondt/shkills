import type { ShkillsWorld } from '../world.js';

/**
 * Signing in through the form rather than by planting a cookie: it is one
 * second, and it means every scenario starts from a state a person could
 * actually have reached.
 */
export async function signIn(world: ShkillsWorld, email: string): Promise<void> {
  const person = world.person(email);
  // Scenarios routinely swap person mid-way ("…and now Inès looks at it"), and
  // the portal sends an already-signed-in visitor away from the sign-in page.
  if (world.signedInAs) await world.context.clearCookies();
  await world.visit('/signin');
  await world.page.locator('[data-testid="signin-email"]').first().fill(person.email);
  await world.page.locator('[data-testid="signin-password"]').first().fill(person.password);
  await world.page.locator('[data-testid="signin-submit"]').first().click();
  await world.page.locator('[data-testid="app-header"]').first().waitFor({ state: 'visible' });
  world.signedInAs = person.email;
}
