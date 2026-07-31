/**
 * Cucumber runs the acceptance criteria in docs/acceptance-criteria.md.
 *
 * Step definitions are TypeScript, loaded through tsx (see the `test:e2e`
 * script, which sets `--import tsx`). Scenarios run one at a time on purpose:
 * each one owns a whole server, database and browser context, and the CLI
 * scenarios drive real processes.
 */
export default {
  import: ['src/**/*.ts'],
  paths: ['features/**/*.feature'],
  format: ['progress-bar', 'summary', 'html:reports/e2e.html'],
  formatOptions: { snippetInterface: 'async-await' },
  strict: true,
};
