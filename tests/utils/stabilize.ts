/**
 * Determinism helpers.
 *
 * These make time and motion explicit INPUTS to a test rather than ambient
 * state. They do not hide legitimate UI differences - no element is masked or
 * restyled beyond freezing animation, and layout is untouched.
 */

import type { Page } from "@playwright/test";
import { PINNED_LOCAL_STORAGE, QA_NOW } from "../../config/constants.ts";

/**
 * Pins the browser clock to QA_NOW.
 *
 * The seed's fixed anchor is the primary determinism mechanism; this exists so
 * relative-time rendering ("overdue", "due today", "in 3 days") agrees with
 * that fixed data. Without it those labels would drift daily even though the
 * underlying rows never change.
 *
 * Must be called before the first navigation.
 */
export async function pinClock(page: Page): Promise<void> {
  await page.clock.setFixedTime(QA_NOW);
}

/**
 * Seeds localStorage before any application script runs, so the very first
 * paint already reflects the pinned theme and view modes. addInitScript
 * applies to every navigation in the page's lifetime.
 */
export async function pinLocalStorage(page: Page): Promise<void> {
  await page.addInitScript((entries: Record<string, string>) => {
    for (const [key, value] of Object.entries(entries)) {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // Storage can be unavailable in odd contexts; not fatal.
      }
    }
  }, PINNED_LOCAL_STORAGE);
}

/**
 * Disables CSS transitions and animations.
 *
 * The application defines no @keyframes; motion comes from the
 * --duration-fast / --ease-standard tokens. Zeroing them removes transient
 * in-between states without altering final layout or colour.
 *
 * Phase 4 will call this immediately before each screenshot.
 */
export async function freezeMotion(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        animation-iteration-count: 1 !important;
        scroll-behavior: auto !important;
      }
    `,
  });
}

/** Applies every pre-navigation stabiliser. Call once per fresh page. */
export async function stabilizePage(page: Page): Promise<void> {
  await pinClock(page);
  await pinLocalStorage(page);
}

/**
 * Measures horizontal overflow.
 *
 * Returns the amount by which the document scrolls wider than its viewport.
 * Anything above zero means a user at this width must scroll sideways to
 * reach content, which is the single most common mobile regression.
 */
export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return Math.max(0, doc.scrollWidth - doc.clientWidth);
  });
}

/**
 * Finds elements wider than the viewport.
 *
 * Reports the worst offenders with enough context to identify them, which is
 * far more useful than a bare "something overflows" assertion.
 */
export async function findOverflowingElements(
  page: Page,
  tolerance = 1,
): Promise<Array<{ description: string; width: number; viewportWidth: number }>> {
  return page.evaluate((allowed) => {
    const viewportWidth = document.documentElement.clientWidth;
    const results: Array<{ description: string; width: number; viewportWidth: number }> = [];

    for (const element of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") continue;

      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (rect.width <= viewportWidth + allowed) continue;

      // An element may legitimately be wide if an ancestor scrolls it.
      let scrollableAncestor = false;
      let parent = element.parentElement;
      while (parent) {
        const parentStyle = window.getComputedStyle(parent);
        if (/(auto|scroll)/.test(parentStyle.overflowX)) {
          scrollableAncestor = true;
          break;
        }
        parent = parent.parentElement;
      }
      if (scrollableAncestor) continue;

      const classes = element.className?.toString().slice(0, 80) ?? "";
      results.push({
        description: `${element.tagName.toLowerCase()}${classes ? `.${classes.split(/\s+/).join(".")}` : ""}`,
        width: Math.round(rect.width),
        viewportWidth,
      });
    }

    return results.slice(0, 10);
  }, tolerance);
}
