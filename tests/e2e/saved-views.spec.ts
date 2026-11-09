/**
 * List filters live in the URL, and a saved view is a link
 * (experiment/CC_revise).
 *
 * Read-only, every viewport: a filtered jobs list survives a reload, because
 * the filters are in the query string.
 *
 * Mutating, desktop-1440 only (saved views and pins belong to the owner, so
 * one project owns them, and the owner's preferences are reset before and
 * after): saving a view puts it in the URL, pinning it puts it in the
 * sidebar, the pin opens the same rows, changing a filter leaves the view,
 * and deleting the view removes its pin.
 */

import type { APIRequestContext } from "@playwright/test";
import { test, expect } from "../fixtures/test.ts";
import { collectPageErrors, waitForAppReady } from "../utils/app-ready.ts";
import { desktopSidebar } from "../utils/nav.ts";

const SEARCH = "Search title, description, address…";
const VIEW_PREFIX = "QA billing view";

async function resetPreferences(request: APIRequestContext) {
  const response = await request.delete("/api/me/preferences");
  expect(response.ok(), `DELETE /api/me/preferences -> ${response.status()}`).toBeTruthy();
}

async function deleteQaViews(request: APIRequestContext) {
  const response = await request.get("/api/saved-views?entityType=jobs");
  if (!response.ok()) return;
  const { views = [] } = (await response.json()) as { views?: Array<{ id: number; name: string }> };
  for (const view of views.filter((v) => v.name.startsWith(VIEW_PREFIX))) {
    await request.delete(`/api/saved-views/${view.id}`);
  }
}

test.describe("saved views — filters in the URL", () => {
  test("a filtered jobs list survives a reload", async ({ page }) => {
    await page.goto("/jobs");
    await waitForAppReady(page);
    await page.getByRole("tablist", { name: "Job phase" }).getByRole("tab", { name: /^Billing/ }).click();
    await expect(page).toHaveURL(/[?&]phase=billing/);
    await page.getByPlaceholder(SEARCH).fill("gutter");
    await expect(page).toHaveURL(/[?&]q=gutter/);

    await page.reload();
    await waitForAppReady(page);
    await expect(page.getByPlaceholder(SEARCH)).toHaveValue("gutter");
    await expect(page.getByRole("tablist", { name: "Job phase" }).getByRole("tab", { name: /^Billing/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByText("Gutter guard install").first()).toBeVisible();
  });
});

test.describe("saved views — save, pin, open, leave, delete", () => {
  test.beforeEach(async ({ page, viewportInfo }) => {
    test.skip(viewportInfo.name !== "desktop-1440", "Saved views and pins belong to one user; one project owns them");
    await resetPreferences(page.request);
    await deleteQaViews(page.request);
  });
  test.afterEach(async ({ page, viewportInfo }) => {
    if (viewportInfo.name !== "desktop-1440") return;
    await deleteQaViews(page.request);
    await resetPreferences(page.request);
  });

  test("a saved view is a link the sidebar can pin", async ({ page }) => {
    const errors = collectPageErrors(page);
    const name = `${VIEW_PREFIX} ${Date.now() % 100000}`;

    await page.goto("/jobs?phase=billing&q=gutter");
    await waitForAppReady(page);
    await expect(page.getByPlaceholder(SEARCH)).toHaveValue("gutter");

    const views = page.getByTestId("saved-views");
    await views.getByRole("button", { name: "Save view" }).click();
    await views.getByLabel("View name").fill(name);
    await views.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page).toHaveURL(/[?&]view=\d+/);
    const viewId = new URL(page.url()).searchParams.get("view")!;
    await expect(page.getByLabel("Saved views")).toHaveValue(viewId);

    // Pins are preferences; wait for the debounced save before moving on.
    const saved = page.waitForResponse(
      (r) => r.url().includes("/me/preferences") && r.request().method() === "PATCH" && r.ok(),
    );
    await views.getByRole("button", { name: "Pin view" }).click();
    await saved;
    await expect(views.getByRole("button", { name: "Pinned" })).toBeVisible();

    // From anywhere, the pin opens the same rows.
    await desktopSidebar(page).getByRole("link", { name: /^Today/ }).click();
    await page.waitForURL(/\/dashboard/);
    await desktopSidebar(page).getByRole("link", { name }).click();
    await expect(page).toHaveURL(new RegExp(`/jobs\\?.*view=${viewId}`));
    await waitForAppReady(page);
    await expect(page.getByPlaceholder(SEARCH)).toHaveValue("gutter");
    await expect(page).toHaveURL(/[?&]phase=billing/);
    await expect(page.getByLabel("Saved views")).toHaveValue(viewId);

    // Changing a filter leaves the view, so the label never claims other rows.
    await page.getByPlaceholder(SEARCH).fill("roof");
    await expect(page).not.toHaveURL(/[?&]view=/);
    await expect(page.getByLabel("Saved views")).toHaveValue("");

    // Deleting the view takes its pin with it.
    await page.getByLabel("Saved views").selectOption(viewId);
    await expect(page.getByPlaceholder(SEARCH)).toHaveValue("gutter");
    await views.getByRole("button", { name: "Delete view" }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(desktopSidebar(page).getByRole("link", { name })).toHaveCount(0);
    await expect(page).not.toHaveURL(/[?&]view=/);

    expect(errors.errors).toEqual([]);
  });
});
