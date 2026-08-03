import {
  After,
  AfterAll,
  Before,
  BeforeAll,
  Status,
  setDefaultTimeout,
  type ITestCaseHookParameter,
} from '@cucumber/cucumber';
import { chromium, type Browser } from 'playwright';
import { requireBuiltArtifacts } from './paths.js';
import { ShkillsWorld } from './world.js';

// Real processes and a real browser: generous, but never unbounded.
setDefaultTimeout(60_000);

let browser: Browser;

BeforeAll(async function () {
  requireBuiltArtifacts();
  browser = await chromium.launch();
});

AfterAll(async function () {
  await browser?.close();
});

/**
 * Whether this deployment has a mail server has to be decided before the
 * process starts, so it is a tag rather than a `Given`. Untagged scenarios get
 * a Shkills with no mail server, which is what a freshly stood-up one is.
 */
Before(async function (this: ShkillsWorld, scenario: ITestCaseHookParameter) {
  const tags = scenario.pickle.tags.map((tag) => tag.name);
  await this.open(browser, {
    mail: tags.includes('@with-a-mail-server'),
    // Same reasoning as mail: where GitHub is, is read when the process starts.
    git: tags.includes('@with-a-git-repository'),
  });
});

/**
 * A failing scenario should hand over everything needed to understand it: the
 * page it died on, a screenshot, and whatever the server said.
 */
After(async function (this: ShkillsWorld, scenario: ITestCaseHookParameter) {
  if (scenario.result?.status === Status.FAILED && this.page && !this.page.isClosed()) {
    this.attach(`page: ${this.page.url()}`, 'text/plain');
    const shot = await this.page.screenshot({ fullPage: true }).catch(() => null);
    if (shot) this.attach(shot, 'image/png');
    const log = this.server?.log();
    if (log) this.attach(`server log:\n${log}`, 'text/plain');
  }
  await this.close();
});
