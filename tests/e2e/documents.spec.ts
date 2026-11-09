/**
 * Estimates and invoices as records of their own (experiment/CC_revise).
 *
 * Each document carries its own next step, and the same step shows wherever
 * the document is: on its page, in the peek beside a job, and as the job's
 * next step. These specs check the document pages; job-lifecycle.spec.ts walks
 * the whole job through the peeks.
 *
 * Read-only, every viewport — the seeded approved estimate behind the billing
 * job reads as billed, its lines are locked, it says what the client sees,
 * and it fits at phone width.
 *
 * End to end, desktop-1440 only — an estimate created through the API is
 * scoped, sent, approved and billed from its own page; the invoice opens
 * beside it; a change order is started from the approved estimate. It creates
 * its own lead, job and estimate so the seeded fixtures stay untouched.
 */

import type { APIRequestContext } from "@playwright/test";
import { test, expect } from "../fixtures/test.ts";
import { collectPageErrors, expectNoCrash, waitForAppReady } from "../utils/app-ready.ts";
import { horizontalOverflow } from "../utils/stabilize.ts";
import { peekPanel } from "../utils/nav.ts";

async function apiJson(request: APIRequestContext, method: "get" | "post", url: string, data?: unknown) {
  const response = await request[method](url, data === undefined ? undefined : { data });
  const body = await response.json().catch(() => ({}));
  expect(response.ok(), `${method.toUpperCase()} ${url} -> ${response.status()} ${JSON.stringify(body)}`).toBeTruthy();
  return body;
}

test.describe("documents — seeded approved estimate", () => {
  test("an approved, billed estimate says where it was billed and locks its lines", async ({
    page,
    manifest,
    viewportInfo,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(`/estimates/${manifest.routeTokens.approvedEstimateId}`);
    await waitForAppReady(page);
    await expectNoCrash(page);

    const step = page.getByTestId("estimate-next-step");
    await expect(step).toContainText(/Billed on INV-\d+/);
    await expect(step.getByRole("button", { name: "Open invoice" })).toBeVisible();
    // Approved scope is the agreement: no new lines and no template on it.
    await expect(page.getByRole("button", { name: "Add a line" })).toHaveCount(0);
    await expect(page.getByTestId("apply-template")).toHaveCount(0);
    await expect(page.getByText("The client sees these")).toBeVisible();

    // The billing tab lists the invoices billed from it, each opening beside it.
    await page.getByRole("tablist", { name: "Estimate sections" }).getByRole("tab", { name: /^Billing/ }).click();
    await expect(page).toHaveURL(/[?&]tab=billing/);
    const invoiceLink = page.getByRole("link", { name: /INV-\d+/ }).first();
    await expect(invoiceLink).toBeVisible();
    await invoiceLink.click();
    await expect(peekPanel(page).getByTestId("invoice-next-step")).toBeVisible();
    await expect(page).toHaveURL(/[?&]peek=invoice(:|%3A)\d+/);

    expect(await horizontalOverflow(page), `estimate record overflows at ${viewportInfo.name}`).toBe(0);
    expect(errors.errors).toEqual([]);
  });
});

test.describe("documents — estimate on its own page", () => {
  test("scope, send, approve and bill from the estimate; then start a change order", async ({
    page,
    viewportInfo,
  }) => {
    test.skip(viewportInfo.name !== "desktop-1440", "Mutating flow runs once, on desktop-1440");
    test.setTimeout(90_000);
    const errors = collectPageErrors(page);

    const stamp = `${Date.now()}`;
    const { lead } = await apiJson(page.request, "post", "/api/leads", {
      first_name: "Estimate",
      last_name: `QA ${stamp}`,
      status: "New",
    });
    const { job } = await apiJson(page.request, "post", "/api/jobs", {
      lead_id: lead.id,
      title: `Estimate page ${stamp}`,
      address: "2 Test Way, Minneapolis, MN",
    });
    const { estimate } = await apiJson(page.request, "post", "/api/estimates", {
      job_id: job.id,
      title: "Estimate page scope",
    });

    await page.goto(`/estimates/${estimate.id}`);
    await waitForAppReady(page);
    const step = page.getByTestId("estimate-next-step");

    // --- an empty draft asks for scope, and the line form opens in place ----
    await expect(step).toContainText("Add the scope");
    await step.getByRole("button", { name: "Add a line" }).click();
    const form = page.getByTestId("estimate-line-form");
    await form.getByPlaceholder("Item name").fill("Ice and water shield");
    await form.getByPlaceholder("1").fill("4");
    await form.getByPlaceholder("$0.00").fill("125");
    await form.getByRole("button", { name: "Add line" }).click();
    await expect(form).toHaveCount(0);
    await expect(page.getByText("Ice and water shield")).toBeVisible();

    // --- sharing a draft sends it ------------------------------------------
    await expect(step).toContainText("Send it to the client");
    await step.getByRole("button", { name: "Send — copy link" }).click();
    await expect(step).toContainText("Waiting on the client");
    // Copying again mints a new link, and the button says so.
    await expect(step.getByRole("button", { name: "Copy a new link" })).toBeVisible();

    // --- approval needs a second click, then the estimate is billable ------
    await step.getByRole("button", { name: "Mark approved" }).click();
    await step.getByRole("button", { name: "Yes, they approved" }).click();
    await expect(step).toContainText("Approved — request a deposit");
    await expect(page.getByRole("button", { name: "Add a line" })).toHaveCount(0);

    // --- billing it all opens the new invoice beside the estimate ----------
    await step.getByRole("button", { name: "Bill it all now" }).click();
    const peek = peekPanel(page);
    await expect(peek.getByTestId("invoice-next-step")).toContainText("Send it to the client");
    await expect(peek.getByTestId("invoice-balance")).toHaveText("$500.00");
    await page.getByRole("button", { name: "Close preview" }).click();
    await expect(step).toContainText(/Billed on INV-\d+/);

    // --- extra work after approval is a change order -----------------------
    await page.getByRole("button", { name: "More estimate actions" }).click();
    await page.getByRole("menuitem", { name: "Add change order" }).click();
    await page.waitForURL((url) => /\/estimates\/\d+/.test(url.pathname) && !url.pathname.endsWith(`/${estimate.id}`));
    await waitForAppReady(page);
    await expect(page.getByText("Change order", { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId("estimate-next-step")).toContainText("Add the scope");

    expect(errors.errors).toEqual([]);
  });
});
