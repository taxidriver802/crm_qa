/**
 * "Is the application actually ready?" helpers.
 *
 * Every CRM page is a client component that fetches on mount and renders
 * skeletons meanwhile (crm_frontend/src/components/loading/loadingSkeletons.js).
 * Asserting against a skeleton produces flaky passes, so these helpers wait
 * for real content rather than sleeping for an arbitrary interval.
 */

import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Selectors matching the app's skeleton primitives. Derived from the class
 * names those components render; kept in one place so a change to the
 * skeleton library only needs updating here.
 */
const SKELETON_SELECTOR = [
  ".animate-pulse",
  "[data-loading='true']",
  ".skeleton",
].join(", ");

/**
 * Waits until the page has settled: network quiet and no skeleton visible.
 *
 * networkidle is normally discouraged, but it is the right tool here because
 * these pages issue several independent fetches on mount with no single
 * completion signal.
 */
export async function waitForAppReady(page: Page, timeout = 30_000): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle", { timeout }).catch(() => {
    // A long-lived connection can keep the network busy; the skeleton check
    // below is the authoritative signal.
  });

  await expect
    .poll(async () => page.locator(SKELETON_SELECTOR).filter({ visible: true }).count(), {
      timeout,
      message: "loading skeletons never disappeared",
    })
    .toBe(0);
}

/**
 * Navigates to a path and waits for readiness.
 * Returns the final URL, which may differ if middleware redirected.
 */
export async function gotoAndSettle(page: Page, urlPath: string): Promise<string> {
  await page.goto(urlPath, { waitUntil: "domcontentloaded" });
  await waitForAppReady(page);
  return page.url();
}

/**
 * Asserts the page did not render a hard client-side error.
 *
 * The app catches render errors in an ErrorBoundary
 * (crm_frontend/src/components/error-boundary.js) and Next.js shows its own
 * overlay for unhandled ones. Either means the page is broken regardless of
 * what else is on screen.
 */
export async function expectNoCrash(page: Page): Promise<void> {
  await expect(page.locator("text=Application error")).toHaveCount(0);
  await expect(page.locator("text=Unhandled Runtime Error")).toHaveCount(0);
  await expect(page.locator("nextjs-portal")).toHaveCount(0);
}

/** Collects console errors and page exceptions for the life of the page. */
export function collectPageErrors(page: Page): { errors: string[] } {
  const collected: string[] = [];

  page.on("pageerror", (error) => {
    collected.push(`pageerror: ${error.message}`);
  });

  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    // Expected noise: the app logs failed API calls to the console on purpose
    // (e.g. "Failed to load user" in app-shell.js). Those are assertions'
    // business, not crash detection.
    if (/favicon|manifest\.webmanifest/i.test(text)) return;
    collected.push(`console.error: ${text}`);
  });

  return { errors: collected };
}
