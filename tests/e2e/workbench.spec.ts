/**
 * The Workbench experience (experiment/CC_ui_reimagination).
 *
 * Read-only, every viewport:
 *   - the right chrome per width (rail + Create on desktop; tab bar + Create on phones)
 *   - peek: a list row opens the record beside the list, the URL carries it,
 *     a reload restores it, Escape closes it, and "Open full page" goes there
 *   - the Create menu offers the objects the CRM makes, and on a job it offers
 *     the job's own children first
 *   - Settings renders every section the role can reach, with no console errors
 *
 * Mutating, desktop-1440 only (preferences are per user, so one project owns
 * them and every test puts the owner back to defaults when it finishes):
 *   - density, sidebar items, pins and Today widgets persist to the server and
 *     survive a reload and a brand-new browser context
 *   - list columns persist per list
 *   - keyboard shortcuts: C opens Create, g j goes to Jobs, ? opens help, ⌘K searches
 *
 * Roles, desktop-1440 only: the seeded agent sees no admin destinations, no
 * admin widgets, no Workspace settings, and the API refuses their attempt to
 * change team defaults.
 */

import type { APIRequestContext, Browser, Page } from "@playwright/test";
import { test, expect } from "../fixtures/test.ts";
import { collectPageErrors, expectNoCrash, waitForAppReady } from "../utils/app-ready.ts";
import { horizontalOverflow } from "../utils/stabilize.ts";
import { bottomNav, desktopSidebar, peekPanel } from "../utils/nav.ts";
import { submitLoginForm } from "../utils/auth.ts";
import { qaEnv } from "../../config/env.ts";

async function resetPreferences(request: APIRequestContext) {
  const response = await request.delete("/api/me/preferences");
  expect(response.ok(), `DELETE /api/me/preferences -> ${response.status()}`).toBeTruthy();
}

async function getPreferences(request: APIRequestContext) {
  const response = await request.get("/api/me/preferences");
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as {
    preferences: Record<string, unknown>;
    defaults: Record<string, unknown>;
    effective: Record<string, unknown>;
  };
}

/** Waits until the debounced preference save has reached the server. */
async function waitForSaved(page: Page, predicate: (prefs: Record<string, any>) => boolean) {
  await expect
    .poll(async () => predicate((await getPreferences(page.request)).preferences), { timeout: 10_000 })
    .toBe(true);
}

/** A second, independent browser context signed in with the same saved session. */
async function newSignedInPage(browser: Browser) {
  const context = await browser.newContext({ storageState: qaEnv.authStatePath, serviceWorkers: "block" });
  const page = await context.newPage();
  return { context, page };
}

test.describe("workbench — chrome and records", () => {
  test("the shell shows the right chrome and a working Create menu", async ({ page, viewportInfo }) => {
    const errors = collectPageErrors(page);
    await page.goto("/dashboard");
    await waitForAppReady(page);
    await expectNoCrash(page);

    if (viewportInfo.navigation === "sidebar") {
      const rail = desktopSidebar(page);
      await expect(rail).toBeVisible();
      for (const name of ["Today", "Jobs", "Leads", "Tasks", "Invoices", "Inbox"]) {
        await expect(rail.getByRole("link", { name: new RegExp(`^${name}`) })).toBeVisible();
      }
      await expect(bottomNav(page)).toBeHidden();
    } else {
      const tabs = bottomNav(page);
      await expect(tabs).toBeVisible();
      for (const name of ["Today", "Jobs", "Leads", "Tasks"]) {
        await expect(tabs.getByRole("link", { name })).toBeVisible();
      }
    }

    await page.getByRole("button", { name: "Create" }).filter({ visible: true }).first().click();
    const menu = page.getByRole("menu", { name: "Create" });
    await expect(menu).toBeVisible();
    for (const name of ["Lead", "Job", "Task", "Appointment", "Estimate", "Invoice"]) {
      await expect(menu.getByRole("menuitem", { name: new RegExp(`^${name}`) })).toBeVisible();
    }
    await menu.getByRole("menuitem", { name: /^Lead/ }).click();
    await page.waitForURL(/\/leads\/new$/);

    expect(errors.errors).toEqual([]);
  });

  test("Create on a job offers the job's own work first", async ({ page, manifest }) => {
    await page.goto(`/jobs/${manifest.routeTokens.billingJobId}`);
    await waitForAppReady(page);
    await page.getByRole("button", { name: "Create" }).filter({ visible: true }).first().click();
    const menu = page.getByRole("menu", { name: "Create" });
    await expect(menu.getByRole("menuitem", { name: "Task on this job" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Invoice for this job" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  });

  test("a list row peeks the record without leaving the list", async ({ page, manifest, viewportInfo }) => {
    const errors = collectPageErrors(page);
    await page.goto("/jobs");
    await waitForAppReady(page);

    await page.getByRole("link", { name: "Gutter guard install" }).first().click();
    const panel = peekPanel(page);
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("aria-label", "Job preview");
    await expect(page).toHaveURL(new RegExp(`[?&]peek=job%3A${manifest.routeTokens.billingJobId}|[?&]peek=job:${manifest.routeTokens.billingJobId}`));
    await expect(page).toHaveURL(/\/jobs\?/);
    await expect(panel.getByText("Gutter guard install").first()).toBeVisible();

    // The URL is the state: a reload brings the same preview back.
    await page.reload();
    await waitForAppReady(page);
    await expect(peekPanel(page)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(peekPanel(page)).toBeHidden();
    await expect(page).not.toHaveURL(/peek=/);

    // Leads open their preview too, and "Open full page" goes to the record.
    await page.goto(`/leads?peek=lead:${manifest.routeTokens.leadId}`);
    await waitForAppReady(page);
    await expect(peekPanel(page)).toHaveAttribute("aria-label", "Lead preview");
    await peekPanel(page).getByRole("link", { name: "Open full page" }).click();
    await page.waitForURL(new RegExp(`/leads/${manifest.routeTokens.leadId}$`));
    await waitForAppReady(page);
    await expect(page.getByTestId("lead-head")).toBeVisible();

    expect(await horizontalOverflow(page), `lead record at ${viewportInfo.name}`).toBe(0);
    expect(errors.errors).toEqual([]);
  });

  test("record tabs keep their place in the URL", async ({ page, manifest }) => {
    await page.goto(`/leads/${manifest.routeTokens.leadId}`);
    await waitForAppReady(page);
    const tabs = page.getByRole("tablist", { name: "Lead sections" });
    await tabs.getByRole("tab", { name: /^Jobs/ }).click();
    await expect(page).toHaveURL(/[?&]tab=jobs/);
    await page.reload();
    await waitForAppReady(page);
    await expect(tabs.getByRole("tab", { name: /^Jobs/, selected: true })).toBeVisible();
    // The job under this lead opens as a preview from the lead.
    await page.getByRole("tabpanel").getByRole("link", { name: /Asphalt shingle replacement/ }).click();
    await expect(peekPanel(page)).toHaveAttribute("aria-label", "Job preview");
  });

  test("Preferences renders every section an owner can reach", async ({ page, viewportInfo }) => {
    const errors = collectPageErrors(page);
    await page.goto("/settings");
    await waitForAppReady(page);
    const sections = page.getByRole("tablist", { name: "Preference sections" });
    for (const name of ["Appearance", "Navigation", "Today", "Lists & records", "Workspace"]) {
      await sections.getByRole("tab", { name }).click();
      await expect(page.getByRole("tabpanel")).toBeVisible();
    }
    await expect(page.getByTestId("settings-workspace")).toBeVisible();
    expect(await horizontalOverflow(page), `settings at ${viewportInfo.name}`).toBe(0);
    expect(errors.errors).toEqual([]);
  });
});

test.describe("workbench — preferences persist", () => {
  test.beforeEach(async ({ viewportInfo, page }) => {
    test.skip(viewportInfo.name !== "desktop-1440", "Preferences are per user; one project owns them");
    await resetPreferences(page.request);
  });
  test.afterEach(async ({ viewportInfo, page }) => {
    if (viewportInfo.name === "desktop-1440") await resetPreferences(page.request);
  });

  test("density, sidebar and pins follow the person to a new browser", async ({ page, browser, manifest }) => {
    await page.goto("/settings");
    await waitForAppReady(page);

    // Density
    await page.getByRole("radiogroup", { name: "Density" }).getByRole("radio", { name: /Compact/ }).click();
    await expect(page.locator("html")).toHaveAttribute("data-density", "compact");

    // Sidebar: hide Files
    await page.getByRole("tab", { name: "Navigation" }).click();
    await page.getByRole("checkbox", { name: "Show Files" }).uncheck();
    await expect(desktopSidebar(page).getByRole("link", { name: /^Files/ })).toHaveCount(0);

    // Pin a job from its record
    await page.goto(`/jobs/${manifest.routeTokens.billingJobId}`);
    await waitForAppReady(page);
    const head = page.getByTestId("job-head");
    await head.getByRole("button", { name: "Pin", exact: true }).click();
    await expect(head.getByRole("button", { name: "Pinned", pressed: true })).toBeVisible();
    const pinnedLink = desktopSidebar(page).getByRole("link", { name: /Gutter guard install/ });
    await expect(pinnedLink).toBeVisible();

    await waitForSaved(
      page,
      (prefs) =>
        prefs.appearance?.density === "compact" &&
        (prefs.nav?.hidden || []).includes("files") &&
        (prefs.nav?.pins || []).some((pin: { id: string }) => pin.id === `job:${manifest.routeTokens.billingJobId}`),
    );

    // Same browser, after a reload
    await page.reload();
    await waitForAppReady(page);
    await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
    await expect(desktopSidebar(page).getByRole("link", { name: /^Files/ })).toHaveCount(0);

    // A brand-new context with no local storage of its own
    const other = await newSignedInPage(browser);
    try {
      await other.page.goto("/dashboard");
      await waitForAppReady(other.page);
      await expect(other.page.locator("html")).toHaveAttribute("data-density", "compact");
      const rail = desktopSidebar(other.page);
      await expect(rail.getByRole("link", { name: /^Jobs/ })).toBeVisible();
      await expect(rail.getByRole("link", { name: /^Files/ })).toHaveCount(0);
      await expect(rail.getByRole("link", { name: /Gutter guard install/ })).toBeVisible();
    } finally {
      await other.context.close();
    }

    // Reset all puts everything back
    await page.goto("/settings");
    await waitForAppReady(page);
    await page.getByRole("button", { name: "Reset all" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Reset" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-density", "comfortable");
    await expect(desktopSidebar(page).getByRole("link", { name: /^Files/ })).toBeVisible();
  });

  test("Today widgets can be hidden, and stay hidden", async ({ page }) => {
    await page.goto("/dashboard");
    await waitForAppReady(page);
    await expect(page.getByRole("heading", { name: "Jobs by phase", level: 2 })).toBeVisible();

    await page.getByRole("button", { name: "Customize" }).click();
    const customize = page.getByTestId("customize-home");
    await customize.getByRole("button", { name: "Hide Jobs by phase" }).click();
    await expect(page.getByRole("heading", { name: "Jobs by phase", level: 2 })).toHaveCount(0);
    await customize.getByRole("button", { name: "Done" }).click();

    await waitForSaved(page, (prefs) =>
      (prefs.home?.widgets || []).some((w: { id: string; hidden: boolean }) => w.id === "pipeline" && w.hidden),
    );
    await page.reload();
    await waitForAppReady(page);
    await expect(page.getByRole("heading", { name: "Jobs by phase", level: 2 })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Needs you", level: 2 })).toBeVisible();
  });

  test("list columns are saved per list", async ({ page }) => {
    await page.goto("/jobs");
    await waitForAppReady(page);
    const table = page.locator('[data-list="jobs"] table');
    await expect(table.getByRole("columnheader", { name: /Owner/ })).toBeVisible();

    await page.getByRole("button", { name: "Display options" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Owner" }).click();
    await page.keyboard.press("Escape");
    await expect(table.getByRole("columnheader", { name: /Owner/ })).toHaveCount(0);

    await waitForSaved(page, (prefs) => Array.isArray(prefs.lists?.jobs?.columns));
    await page.reload();
    await waitForAppReady(page);
    await expect(table.getByRole("columnheader", { name: /Owner/ })).toHaveCount(0);

    // Other lists are untouched.
    await page.goto("/leads");
    await waitForAppReady(page);
    await expect(page.locator('[data-list="leads"] table').getByRole("columnheader").first()).toBeVisible();
  });

  test("keyboard shortcuts move around the workspace", async ({ page }) => {
    await page.goto("/dashboard");
    await waitForAppReady(page);

    await page.keyboard.press("c");
    await expect(page.getByRole("menu", { name: "Create" })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.keyboard.press("g");
    await page.keyboard.press("j");
    await page.waitForURL(/\/jobs$/);
    await waitForAppReady(page);

    await page.keyboard.press("Shift+?");
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByRole("textbox", { name: "Search workspace" })).toBeVisible();
    await page.keyboard.press("Escape");

    // Shortcuts never fire while typing.
    const field = page.getByRole("main").getByRole("textbox").filter({ visible: true }).first();
    await field.click();
    await page.keyboard.type("c");
    await expect(field).toHaveValue(/c$/);
    await expect(page.getByRole("menu", { name: "Create" })).toBeHidden();
  });
});

test.describe("workbench — roles", () => {
  test("an agent sees no admin destinations and cannot set team defaults", async ({
    page,
    viewportInfo,
    freshContext,
  }) => {
    test.skip(viewportInfo.name !== "desktop-1440", "Role checks run once");
    test.skip(!qaEnv.agentPassword, "QA_AGENT_PASSWORD is not configured, so no agent is seeded");

    const { page: agent } = await freshContext();
    const errors = collectPageErrors(agent);
    await agent.goto("/login");
    await submitLoginForm(agent, { email: qaEnv.agentEmail, password: qaEnv.agentPassword, slug: "rooftop" });
    await agent.waitForURL(/\/dashboard(\?.*)?$/, { timeout: 30_000 });
    await waitForAppReady(agent);
    await expect(agent.getByRole("banner").getByRole("heading", { level: 1 })).toContainText("Avery");

    const rail = desktopSidebar(agent);
    await expect(rail.getByRole("link", { name: /^Jobs/ })).toBeVisible();
    for (const name of ["Team", "Automation", "Templates"]) {
      await expect(rail.getByRole("link", { name: new RegExp(`^${name}`) })).toHaveCount(0);
    }
    await expect(agent.getByTestId("money-widget")).toHaveCount(0);
    await expect(agent.getByRole("heading", { name: "Team load", level: 2 })).toHaveCount(0);

    await agent.goto("/settings?tab=workspace");
    await waitForAppReady(agent);
    await expect(agent.getByRole("tab", { name: "Workspace" })).toHaveCount(0);
    await expect(agent.getByTestId("settings-workspace")).toHaveCount(0);
    await expect(agent.getByTestId("settings-appearance")).toBeVisible();

    const refused = await agent.request.patch("/api/company/workspace-defaults", {
      data: { appearance: { density: "compact" } },
    });
    expect(refused.status()).toBe(403);

    // The agent's own preferences are theirs alone.
    const saved = await agent.request.patch("/api/me/preferences", { data: { appearance: { density: "compact" } } });
    expect(saved.ok()).toBeTruthy();
    const ownerView = await getPreferences(page.request);
    expect((ownerView.preferences as any).appearance?.density).not.toBe("compact");
    await agent.request.delete("/api/me/preferences");

    expect(errors.errors).toEqual([]);
  });
});
