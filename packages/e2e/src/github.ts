/**
 * The suite drives the same fake GitHub the server's own tests do, rather than
 * a second one written to agree with the first. It lives next to the client it
 * doubles; see `packages/server/src/test/fake-github.ts` for why it speaks the
 * real git-data API over a real socket instead of being a mocked `fetch`.
 */
export { startFakeGitHub, type FakeRepo } from '../../server/src/test/fake-github.js';

/** The token the suite's servers are given. Nothing real, and never sent anywhere real. */
export const FAKE_TOKEN = 'ghp_e2e_not_a_real_token';
