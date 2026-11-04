/**
 * Phase 23: the job carries the work from first contact to paid and closed.
 *
 * Two kinds of coverage:
 *
 *   Read-only, every viewport — the seeded "Gutter guard install" job is in
 *   billing with a deposit paid and a balance due. Its job page, the jobs
 *   list phase filter, its invoice, the dashboard money metric, the customer
 *   portal and the public invoice link must all tell the same story, and must
 *   not overflow at phone width.
 *
 *   End to end, desktop only — a job created through the API walks the whole
 *   lifecycle in the UI: the client accepts on the public estimate page, the
 *   job moves to Sold by itself, a deposit is billed and paid, the crew moves
 *   it through production, the close gate refuses to close with a draft
 *   invoice, and the final payment closes the job. It creates its own records
 *   so the seeded fixtures stay untouched for the other viewports.
 */

import type { APIRequestContext, Page } from "@playwright/test";
import { test, expect } from "../fixtures/test.ts";
import { waitForAppReady, expectNoCrash, collectPageErrors } from "../utils/app-ready.ts";
import { horizontalOverflow } from "../utils/stabilize.ts";

async function apiJson(request: APIRequestContext, method: "get" | "post" | "patch", url: string, data?: unknown) {
  const response = await request[method](url, data === undefined ? undefined : { data });
  const body = await response.json().catch(() => ({}));
  expect(response.ok(), `${method.toUpperCase()} ${url} -> ${response.status()} ${JSON.stringify(body)}`).toBeTruthy();
  return body;
}

async function expectNoOverflow(page: Page, label: string) {
  expect(await horizontalOverflow(page), `${label} overflows horizontally`).toBe(0);
}

test.describe("job lifecycle — seeded billing job", () => {
  test("job page shows the lifecycle, the money, and the next step", async ({ page, manifest }) => {
    const errors = collectPageErrors(page);
    await page.goto(`/jobs/${manifest.routeTokens.billingJobId}`);
    await waitForAppReady(page);
    await expectNoCrash(page);

    await expect(page.getByText("Lifecycle", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Work Complete", pressed: true })).toBeVisible();
    // Selling and production read as done; Closed is still ahead.
    await expect(page.getByRole("button", { name: "Closed", pressed: false })).toBeVisible();

    const nextStep = page.getByTestId("job-next-step");
    await expect(nextStep).toContainText("Collect $960.00 balance");
    await expect(nextStep.getByRole("link", { name: "Record payment" })).toBeVisible();

    await expect(page.getByTestId("money-contract")).toContainText("$2,800.00");
    await expect(page.getByTestId("money-balance")).toContainText("$960.00");
    await expect(page.getByText("INV-1004").first()).toBeVisible();
    await expect(page.getByText("INV-1005").first()).toBeVisible();

    await expectNoOverflow(page, "billing job page");
    expect(errors.errors).toEqual([]);
  });

  test("jobs list filters by lifecycle phase", async ({ page, viewportInfo }) => {
    await page.goto("/jobs");
    await waitForAppReady(page);

    const phases = page.getByRole("tablist", { name: "Job phase" });
    // Phone shows the short label; the accessible name always carries the full one.
    // Wait for counts: the accessible name is "Billing <n>" once the summary loads.
    await phases.getByRole("tab", { name: /^Billing \d+$/ }).click();
    await waitForAppReady(page);
    await expect(page.getByText("Gutter guard install").first()).toBeVisible();
    await expect(page.getByText("Asphalt shingle replacement")).toHaveCount(0);

    await phases.getByRole("tab", { name: /^Closed \d+$/ }).click();
    await waitForAppReady(page);
    await expect(page.getByText("Full tear-off and re-deck").first()).toBeVisible();
    await expect(page.getByText("Gutter guard install")).toHaveCount(0);

    await expectNoOverflow(page, `jobs list at ${viewportInfo.name}`);
  });

  test("invoice shows deposit applied, the payment, and the balance", async ({ page, manifest }) => {
    await page.goto(`/invoices/${manifest.routeTokens.balanceInvoiceId}`);
    await waitForAppReady(page);
    await expectNoCrash(page);

    await expect(page.getByTestId("invoice-balance")).toHaveText("$960.00");
    await expect(page.getByText("Less deposit billed")).toBeVisible();
    await expect(page.getByText("Partially Paid").first()).toBeVisible();
    await expect(page.getByText("by check #3318")).toBeVisible();
    // Money is in, so the lines are locked.
    await expect(page.getByText("Locked: payments are recorded or the invoice is void.")).toBeVisible();
    await expect(page.getByRole("button", { name: "New item" })).toHaveCount(0);

    await expectNoOverflow(page, "invoice detail");
  });

  test("dashboard leads with what is owed", async ({ page }) => {
    await page.goto("/dashboard");
    await waitForAppReady(page);
    await expect(page.getByText("Owed to you")).toBeVisible();
  });

  test("customer portal shows the client's stage and balance, and hides drafts", async ({
    page,
    manifest,
    freshContext,
  }) => {
    // Generating a portal link only upserts portal_tokens; seeded records are unchanged.
    const gutters = await apiJson(
      page.request,
      "post",
      `/api/portal/generate/${manifest.routeTokens.billingJobId}`,
    );
    const webb = await apiJson(
      page.request,
      "post",
      `/api/portal/generate/${manifest.routeTokens.jobId}`,
    );

    const { page: client } = await freshContext();

    await client.goto(`/public/portal/${gutters.token}`);
    await waitForAppReady(client);
    await expect(client.getByTestId("portal-stage")).toHaveText("Work is complete");
    await expect(client.getByRole("listitem").filter({ hasText: "Complete" }).first()).toHaveAttribute(
      "aria-current",
      "step",
    );
    await expect(client.getByTestId("portal-balance")).toHaveText("$960.00");
    await expect(client.getByRole("link", { name: "INV-1005" })).toBeVisible();
    await expectNoOverflow(client, "customer portal");

    await client.goto(`/public/portal/${webb.token}`);
    await waitForAppReady(client);
    await expect(client.getByTestId("portal-stage")).toHaveText("Your estimate is ready to review");
    await expect(client.getByText("Asphalt shingle replacement - south and west slopes")).toBeVisible();
    // The internal draft option never leaves the building.
    await expect(client.getByText("Alternate - premium designer shingles")).toHaveCount(0);
  });

  test("the invoice share link opens a page that shows what is owed", async ({
    page,
    manifest,
    freshContext,
  }) => {
    const shared = await apiJson(
      page.request,
      "post",
      `/api/invoices/${manifest.routeTokens.balanceInvoiceId}/share`,
    );
    const { page: client } = await freshContext();
    await client.goto(new URL(shared.share_url).pathname);
    await waitForAppReady(client);
    await expectNoCrash(client);
    await expect(client.getByTestId("public-invoice-balance")).toHaveText("$960.00");
    await expect(client.getByText("Less deposit already billed")).toBeVisible();
    await expect(client.getByText("Payments received")).toBeVisible();
    await expectNoOverflow(client, "public invoice");
  });
});

test.describe("job lifecycle — end to end", () => {
  test("client approval sells the job; deposit, production, final invoice and payment close it", async ({
    page,
    viewportInfo,
    freshContext,
  }) => {
    test.skip(viewportInfo.name !== "desktop-1440", "Mutating flow runs once, on desktop-1440");
    test.setTimeout(120_000);

    // --- set up a fresh job through the API --------------------------------
    const stamp = `${Date.now()}`;
    const { lead } = await apiJson(page.request, "post", "/api/leads", {
      first_name: "Lifecycle",
      last_name: `QA ${stamp}`,
      status: "New",
    });
    const { job } = await apiJson(page.request, "post", "/api/jobs", {
      lead_id: lead.id,
      title: `Lifecycle re-roof ${stamp}`,
      address: "1 Test Way, Minneapolis, MN",
    });
    const { estimate } = await apiJson(page.request, "post", "/api/estimates", {
      job_id: job.id,
      title: "Lifecycle scope",
    });
    await apiJson(page.request, "post", `/api/estimates/${estimate.id}/line-items`, {
      name: "Architectural shingles",
      quantity: 20,
      unit_price: 250,
    });
    const shared = await apiJson(page.request, "post", `/api/estimates/${estimate.id}/share`);
    expect(shared.estimate.status).toBe("Sent");

    // --- the client accepts on the public page -----------------------------
    const { page: client } = await freshContext();
    await client.goto(new URL(shared.share_url).pathname);
    await waitForAppReady(client);
    await client.getByRole("button", { name: "Accept" }).click();
    await expect(client.getByText("Thank you — this estimate is marked as accepted.")).toBeVisible();

    // --- nobody touched the job, and it is sold ----------------------------
    await page.goto(`/jobs/${job.id}`);
    await waitForAppReady(page);
    await expect(page.getByRole("button", { name: "Sold", pressed: true })).toBeVisible();
    await expect(page.getByTestId("job-next-step")).toContainText("Request a deposit");
    await expect(page.getByTestId("money-contract")).toContainText("$5,000.00");

    // --- bill and collect the deposit --------------------------------------
    await page.getByRole("button", { name: "Request deposit" }).click();
    await page.getByRole("button", { name: "Create deposit invoice" }).click();
    await page.waitForURL(/\/invoices\/\d+$/);
    await waitForAppReady(page);
    await expect(page.getByTestId("invoice-balance")).toHaveText("$1,500.00");
    await page.getByRole("button", { name: "Record payment" }).click();
    await page.getByRole("button", { name: "Save payment" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Paid in full." })).toBeVisible();

    // --- production --------------------------------------------------------
    await page.goto(`/jobs/${job.id}`);
    await waitForAppReady(page);
    await expect(page.getByTestId("job-next-step")).toContainText("Schedule the work");
    for (const status of ["Work Scheduled", "In Progress", "Work Complete"]) {
      await page.getByRole("button", { name: status, exact: true }).click();
      await expect(page.getByRole("button", { name: status, pressed: true })).toBeVisible();
    }
    await expect(page.getByTestId("job-next-step")).toContainText("Send the final invoice");

    // --- the final invoice subtracts the deposit ---------------------------
    await page.getByRole("button", { name: "Create final invoice" }).click();
    await page.waitForURL(/\/invoices\/\d+$/);
    await waitForAppReady(page);
    const finalUrl = page.url();
    await expect(page.getByText("Less deposit billed")).toBeVisible();
    await expect(page.getByTestId("invoice-balance")).toHaveText("$3,500.00");

    // --- the close gate holds while the final is a draft --------------------
    await page.goto(`/jobs/${job.id}`);
    await waitForAppReady(page);
    await page.getByRole("button", { name: "Closed", exact: true }).click();
    await expect(page.getByText("This job cannot be closed while money is still open.")).toBeVisible();
    await expect(page.getByText(/draft invoice has not been sent/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Work Complete", pressed: true })).toBeVisible();

    // --- send it, get paid, and the job closes itself -----------------------
    await page.goto(new URL(finalUrl).pathname);
    await waitForAppReady(page);
    await page.getByRole("button", { name: "Mark sent" }).click();
    await expect(page.getByText("Sent", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Record payment" }).click();
    await page.getByRole("button", { name: "Save payment" }).click();
    await expect(page.getByText("Paid in full. The job is settled and now closed.")).toBeVisible();

    await page.goto(`/jobs/${job.id}`);
    await waitForAppReady(page);
    await expect(page.getByRole("button", { name: "Closed", pressed: true })).toBeVisible();
    await expect(page.getByTestId("job-next-step")).toHaveCount(0);
    await expect(page.getByTestId("money-balance")).toContainText("$0.00");
  });
});
