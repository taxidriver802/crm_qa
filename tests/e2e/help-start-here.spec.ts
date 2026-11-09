/**
 * Start here, walked. A new owner registers an empty company and follows
 * Part 2 of crm_backend/docs/guide/using-the-crm.md in the UI, step by
 * step, with the words the guide uses. The client's side (the shared
 * estimate, the shared invoice, the portal) runs in a separate signed-out
 * browser, with the links the owner copied.
 *
 * If this spec breaks, either the product or the guide changed; fix the
 * one that is wrong so Start here stays true.
 *
 * Desktop only: it creates a company, so it runs once.
 */

import path from "node:path";
import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures/test.ts";
import { waitForAppReady, collectPageErrors } from "../utils/app-ready.ts";
import { qaEnv } from "../../config/env.ts";

// Throwaway owner for a fresh company in the crm_qa database. The database
// is dropped and reseeded on every run; the email is made unique per test.
export const START_HERE_OWNER = {
  company: "Start Here Roofing",
  firstName: "Sam",
  lastName: "Starter",
  emailPrefix: "start-here-owner",
  password: "qa-start-here-7Kp2",
};

const PHOTO = path.join(qaEnv.qaRoot, "fixtures", "uploads");

async function pickDay(page: Page, scope: ReturnType<Page["locator"]>, day: number) {
  await scope.getByRole("button", { name: "Select date" }).first().click();
  await page.getByRole("gridcell", { name: String(day), exact: true }).first().click();
}

async function copied(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

test.describe("help — Start here, walked", () => {
  test("a new owner runs the first job from sign-up to paid and closed", async ({
    page: _seeded,
    viewportInfo,
    freshContext,
    browser,
  }) => {
    test.skip(viewportInfo.name !== "desktop-1440", "Creates a company; runs once, on desktop-1440");
    test.setTimeout(240_000);

    const { context, page } = await freshContext();
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: qaEnv.baseUrl });
    const { errors } = collectPageErrors(page);
    const email = `${START_HERE_OWNER.emailPrefix}-${Date.now()}@qa.test`;

    // --- 1. Sign in (create the company) -------------------------------------
    await page.goto("/register");
    await page.getByLabel("Company name").fill(START_HERE_OWNER.company);
    await page.getByLabel("First name").fill(START_HERE_OWNER.firstName);
    await page.getByLabel("Last name").fill(START_HERE_OWNER.lastName);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(START_HERE_OWNER.password);
    await page.getByRole("button", { name: "Create company" }).click();
    await page.waitForURL(/\/dashboard/);
    await waitForAppReady(page);
    await expect(page.getByText("Nothing needs you right now. Clear desk.")).toBeVisible();

    // The empty Today offers Start here, and it opens over Today.
    await page.getByRole("button", { name: "New here? Start with your first job" }).click();
    const help = page.getByTestId("help-panel");
    await expect(help.getByRole("heading", { name: "Start here" })).toBeVisible();
    await expect(page).toHaveURL(/[?&]help=start-here/);
    await help.getByRole("button", { name: "Close help" }).click();

    // --- 2. Create a lead ------------------------------------------------------
    await page.getByRole("button", { name: "Create", exact: true }).first().click();
    await page.getByRole("menuitem", { name: /^Lead/ }).click();
    await page.waitForURL(/\/leads\/new/);
    await page.getByLabel("First name").fill("Pat");
    await page.getByLabel("Last name").fill("Client");
    await page.getByLabel("Phone").fill("6125550142");
    await page.getByRole("button", { name: "Create lead" }).click();
    await page.waitForURL(/\/leads\/\d+$/);
    await waitForAppReady(page);
    await expect(page.getByRole("heading", { name: "Pat Client" })).toBeVisible();

    // --- 3. Turn it into a job ------------------------------------------------
    await page.getByRole("link", { name: "New job" }).first().click();
    await page.waitForURL(/\/jobs\/new/);
    await page.getByLabel("Title").fill("Roof replacement");
    await page.getByLabel("Address").fill("12 Elm St, Minneapolis, MN");
    await page.getByRole("button", { name: "Create job" }).click();
    await page.waitForURL(/\/jobs\/\d+/);
    await waitForAppReady(page);
    const jobUrl = page.url().split("?")[0];
    const next = page.getByTestId("job-next-step");
    await expect(next).toContainText("Schedule a site visit");

    // --- 4. A task and an appointment ------------------------------------------
    const tabs = page.getByRole("tablist", { name: "Job sections" });
    await tabs.getByRole("tab", { name: /^Work/ }).click();
    const work = page.locator("#section-tasks");
    await work.getByRole("button", { name: "New task" }).click();
    await work.getByLabel("Title").fill("Call to confirm the visit");
    await pickDay(page, work, 17);
    await work.getByRole("button", { name: "Create task" }).click();
    await expect(work.getByText("Call to confirm the visit")).toBeVisible();

    await work.getByRole("button", { name: "Schedule" }).click();
    await expect(work.getByLabel("Title")).toHaveValue("Site visit");
    await expect(work.getByLabel("Set job status to Appointment Scheduled")).toBeChecked();
    await pickDay(page, work, 18);
    await work.getByRole("button", { name: "Schedule appointment" }).click();
    await expect(work.getByText("Site visit")).toBeVisible();
    await expect(page.getByRole("button", { name: "Appointment Scheduled", pressed: true })).toBeVisible();
    await expect(next).toContainText("Build the estimate");

    // --- 5. A note ---------------------------------------------------------------
    await tabs.getByRole("tab", { name: /^Overview/ }).click();
    const notes = page.locator("form").filter({ has: page.getByLabel("Summary") });
    await notes.getByRole("radio", { name: "Call" }).click().catch(() => notes.getByText("Call", { exact: true }).click());
    await notes.getByLabel("Summary").fill("Booked the visit for Wednesday.");
    await notes.getByRole("button", { name: "Log" }).click();
    await expect(page.getByText("Booked the visit for Wednesday.")).toBeVisible();

    // --- 6. A file ---------------------------------------------------------------
    await tabs.getByRole("tab", { name: /^Files/ }).click();
    const fileInput = page.locator('#section-files input[type="file"]');
    const fs = await import("node:fs");
    const fixture = fs.readdirSync(PHOTO).find((f) => /\.(jpe?g|png)$/i.test(f));
    expect(fixture, "a photo fixture in crm_qa/fixtures/uploads").toBeTruthy();
    await fileInput.setInputFiles(path.join(PHOTO, fixture!));
    await expect(page.getByLabel("Show in portal").first()).toBeChecked();

    // --- 7. The estimate -----------------------------------------------------------
    await next.getByRole("link", { name: "New estimate" }).click();
    await page.waitForURL(/\/estimates\/new/);
    await page.getByLabel("Title").fill("Roof replacement");
    await page.getByLabel("Notes for the client").fill("Includes tear-off and haul-away.");
    await page.getByRole("button", { name: "Create estimate" }).click();
    await page.waitForURL(/\/estimates\/\d+/);
    await waitForAppReady(page);
    await page.getByLabel("Item name").fill("Architectural shingles");
    await page.getByLabel("Quantity").fill("20");
    await page.getByLabel("Unit price").fill("250");
    await page.getByRole("button", { name: "Add line" }).click();
    await expect(page.getByTestId("estimate-total").first()).toContainText("$5,000.00");
    const estimateStep = page.getByTestId("estimate-next-step");
    await expect(estimateStep).toContainText("Send it to the client");

    // --- 8. Send it ----------------------------------------------------------------
    await estimateStep.getByRole("button", { name: "Send — copy link" }).click();
    await expect(estimateStep).toContainText("Waiting on the client");
    const estimateLink = await copied(page);
    expect(estimateLink).toMatch(/\/public\/estimate\//);
    await page.goto(jobUrl);
    await waitForAppReady(page);
    await expect(page.getByRole("button", { name: "Proposal Sent", pressed: true })).toBeVisible();
    await expect(next).toContainText("Waiting on the client");

    // --- 9. Accept it the way the client does ------------------------------------
    const clientContext = await browser.newContext({ serviceWorkers: "block" });
    const client = await clientContext.newPage();
    await client.goto(new URL(estimateLink).pathname);
    await waitForAppReady(client);
    await expect(client.getByText("Architectural shingles")).toBeVisible();
    await expect(client.getByTestId("help-panel")).toHaveCount(0);
    await client.getByRole("button", { name: "Accept" }).click();
    await expect(client.getByText("Thank you — this estimate is marked as accepted.")).toBeVisible();

    await page.reload();
    await waitForAppReady(page);
    await expect(page.getByRole("button", { name: "Sold", pressed: true })).toBeVisible();
    await expect(next).toContainText("Request a deposit");

    // --- 10. Request the deposit -----------------------------------------------------
    const peek = page.getByTestId("peek-panel");
    await next.getByRole("button", { name: "Request deposit" }).click();
    await expect(peek.getByLabel("Deposit percent")).toHaveValue("30");
    await peek.getByRole("button", { name: "Create deposit invoice" }).click();
    const invoiceStep = peek.getByTestId("invoice-next-step");
    await expect(invoiceStep).toContainText("Send it to the client");
    await invoiceStep.getByRole("button", { name: "Copy link" }).click();
    await expect(invoiceStep).toContainText("Collect $1,500.00");
    const depositLink = await copied(page);
    expect(depositLink).toMatch(/\/public\/invoice\//);
    await expect(next).toContainText("Schedule the work");

    await client.goto(new URL(depositLink).pathname);
    await waitForAppReady(client);
    await expect(client.getByText("Amount due")).toBeVisible();
    await expect(client.getByText("$1,500.00").first()).toBeVisible();

    // --- 11. Record the deposit payment ------------------------------------------------
    await invoiceStep.getByRole("button", { name: "Record payment" }).click();
    await peek.getByLabel("Method").selectOption({ label: "Check" });
    await peek.getByLabel("Reference").fill("1042");
    await peek.getByRole("button", { name: "Save payment" }).click();
    await expect(invoiceStep).toContainText("Paid in full");
    await page.getByRole("button", { name: "Close preview" }).click();

    // --- 12. Schedule the work -----------------------------------------------------------
    await next.getByRole("button", { name: "Schedule" }).or(next.getByRole("link", { name: "Schedule" })).click();
    await expect(work.getByLabel("Set job status to Work Scheduled")).toBeChecked();
    await pickDay(page, work, 23);
    await work.getByRole("button", { name: "Schedule appointment" }).click();
    await expect(page.getByRole("button", { name: "Work Scheduled", pressed: true })).toBeVisible();
    await expect(next).toContainText("Start the work");

    // --- 13. The portal --------------------------------------------------------------------
    await page.getByRole("button", { name: "Copy portal link" }).click();
    await expect.poll(() => copied(page)).toMatch(/\/public\/portal\//);
    const portalLink = await copied(page);
    await client.goto(new URL(portalLink).pathname);
    await waitForAppReady(client);
    await expect(client.getByText("Customer portal").first()).toBeVisible();
    await expect(client.getByText("Roof replacement").first()).toBeVisible();
    await expect(client.getByTestId("help-panel")).toHaveCount(0);

    // --- 14. Do the work ------------------------------------------------------------------
    await next.getByRole("button", { name: "Move to In Progress" }).click();
    await expect(page.getByRole("button", { name: "In Progress", pressed: true })).toBeVisible();
    await next.getByRole("button", { name: "Move to Work Complete" }).click();
    await expect(page.getByRole("button", { name: "Work Complete", pressed: true })).toBeVisible();
    await expect(next).toContainText("Send the final invoice");

    // --- 15. The final invoice --------------------------------------------------------------
    await next.getByRole("button", { name: "Create final invoice" }).click();
    await expect(peek.getByText("Less deposit billed")).toBeVisible();
    await expect(peek.getByTestId("invoice-balance")).toHaveText("$3,500.00");
    await invoiceStep.getByRole("button", { name: "Copy link" }).click();
    await expect(invoiceStep).toContainText("Collect $3,500.00");
    const finalLink = await copied(page);
    await client.goto(new URL(finalLink).pathname);
    await waitForAppReady(client);
    await expect(client.getByText("Less deposit already billed")).toBeVisible();
    await page.getByRole("button", { name: "Close preview" }).click();
    await expect(next).toContainText("Collect $3,500.00");

    // --- 16. The final payment closes the job -------------------------------------------------
    await next.getByRole("button", { name: "Record payment" }).click();
    await peek.getByRole("button", { name: "Save payment" }).click();
    await expect(page.getByText("Paid in full. The job is settled and closed.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Closed", pressed: true })).toBeVisible();
    await expect(next).toHaveCount(0);
    await page.getByRole("button", { name: "Close preview" }).click();
    await tabs.getByRole("tab", { name: /^Money/ }).click();
    await expect(page.getByTestId("money-contract")).toContainText("$5,000.00");
    await expect(page.getByTestId("money-balance")).toContainText("$0.00");

    await clientContext.close();
    expect(errors, `console or page errors on the Start here walk:\n${errors.join("\n")}`).toEqual([]);
  });
});
