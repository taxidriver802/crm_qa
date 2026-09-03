/**
 * The extended Playwright test object every spec imports.
 *
 * Provides:
 *   - a stabilised `page` (pinned clock and localStorage) with no per-test setup
 *   - `viewportInfo`, so a test can reason about the width it is running at
 *   - `manifest`, the seeded ids
 *   - `freshContext()`, for creating an UNAUTHENTICATED context on demand
 */

import { test as base, expect } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import { getViewport, type QaViewport, type ViewportName } from "../../config/viewports.ts";
import { readManifest, type SeedManifest } from "../../db/manifest.ts";
import { stabilizePage } from "../utils/stabilize.ts";

interface QaFixtures {
  viewportInfo: QaViewport;
  manifest: SeedManifest;
  /** Creates a context with NO stored session, for unauthenticated tests. */
  freshContext: () => Promise<{ context: BrowserContext; page: Page }>;
}

export const test = base.extend<QaFixtures>({
  // Applied to the shared `page` before any test body runs, so no spec has to
  // remember to stabilise.
  page: async ({ page }, use) => {
    await stabilizePage(page);
    await use(page);
  },

  viewportInfo: async ({}, use, testInfo) => {
    await use(getViewport(testInfo.project.name as ViewportName));
  },

  manifest: async ({}, use) => {
    await use(readManifest());
  },

  freshContext: async ({ browser }, use) => {
    const created: BrowserContext[] = [];

    await use(async () => {
      const context = await browser.newContext({
        storageState: undefined,
        serviceWorkers: "block",
      });
      created.push(context);
      const page = await context.newPage();
      await stabilizePage(page);
      return { context, page };
    });

    for (const context of created) {
      await context.close();
    }
  },
});

export { expect };
