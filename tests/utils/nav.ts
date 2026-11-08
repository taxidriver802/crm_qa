/**
 * Navigation helpers for the CRM app shell.
 *
 * The Workbench shell renders different chrome by width
 * (crm_frontend/src/components/app-shell.js, components/shell/*):
 *   >= lg (1024px) : the rail, id="desktop-sidebar", with Create, Search,
 *                    the person's own ordered nav, Pinned, and the account menu
 *   <  lg          : header hamburger (aria-label "Open menu"/"Close menu")
 *                    plus a bottom tab bar (nav aria-label "Primary") with the
 *                    first four work items and a centred Create button
 *
 * Selectors here use accessible names and the stable ids the app provides.
 */

import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import type { NavigationMode } from "../../config/viewports.ts";

export function desktopSidebar(page: Page) {
  return page.locator("#desktop-sidebar");
}

/** The header hamburger shown below the lg breakpoint. */
export function menuTrigger(page: Page) {
  return page.locator("button.menu-trigger");
}

export function mobileMenu(page: Page) {
  return page.locator(".mobile-menu");
}

/** The bottom tab bar shown below lg. */
export function bottomNav(page: Page) {
  return page.getByRole("navigation", { name: "Primary" });
}

/** The global Create button (rail on desktop, centre of the tab bar on phones). */
export function createButton(page: Page) {
  return page.getByRole("button", { name: /^Create/ }).filter({ visible: true }).first();
}

/** The record preview panel opened by ?peek=kind:id. */
export function peekPanel(page: Page) {
  return page.getByTestId("peek-panel");
}

export function notificationsButton(page: Page) {
  return page.getByRole("button", { name: "Open notifications" });
}

export function searchButton(page: Page) {
  return page.getByRole("button", { name: "Open search" });
}

/**
 * Asserts the chrome appropriate to the viewport is present.
 * `mode` comes from the viewport definition rather than being re-derived, so
 * expectations stay tied to the documented breakpoint behaviour.
 */
export async function expectNavigationChrome(page: Page, mode: NavigationMode): Promise<void> {
  if (mode === "sidebar") {
    await expect(desktopSidebar(page)).toBeVisible();
    await expect(menuTrigger(page)).toBeHidden();
  } else {
    await expect(menuTrigger(page)).toBeVisible();
    await expect(desktopSidebar(page)).toBeHidden();
  }
}

/** Opens the mobile menu and waits for the panel. */
export async function openMobileMenu(page: Page): Promise<void> {
  await menuTrigger(page).click();
  await expect(mobileMenu(page)).toBeVisible();
}

/** Closes the mobile menu via its close control. */
export async function closeMobileMenu(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Close menu" }).click();
  await expect(mobileMenu(page)).toBeHidden();
}

/**
 * The <h1> the app shell renders in its sticky header.
 *
 * Scoped to the banner landmark on purpose: detail pages render a SECOND <h1>
 * inside <main> (the .page-title element), so an unscoped level-1 heading
 * query matches two elements there. Scoping keeps the selector unambiguous
 * without weakening it to .first().
 *
 * The duplicate-h1 pattern is itself an accessibility concern and is recorded
 * as a Phase 3 finding rather than worked around in the application.
 */
export function pageHeading(page: Page) {
  return page.getByRole("banner").getByRole("heading", { level: 1 });
}

/** The in-content <h1> that detail pages render inside <main>. */
export function contentHeading(page: Page) {
  return page.getByRole("main").getByRole("heading", { level: 1 });
}
