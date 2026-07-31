import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Each test file gets its own SQLite file (see setup.ts), so files stay
    // independent even when vitest runs them in parallel workers.
    setupFiles: ['./src/test/setup.ts'],
    testTimeout: 20_000,
  },
});
