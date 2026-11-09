/**
 * What the seeded agent sees, at desktop-1440 and phone-390
 * (experiment/CC_revise).
 *
 * Every seeded record belongs to the owner, so to the agent each one is a
 * record they cannot open, and company setup (team, templates, automation,
 * integrations) is an owner/admin area. Both answer once, in words, with a
 * way back, instead of an empty page of controls that fail.
 *
 * A job the owner assigns to the agent (created through the API, so the
 * seeded fixtures stay untouched) opens with its next step, and the parts
 * only an owner can do say so.
 */

import type { Browser, Page } from "@playwright/test";
import { test, expect } from "../fixtures/test.ts";
import { collectPageErrors, expectNoCrash, waitForAppReady } from "../utils/app-ready.ts";
import { horizontalOverflow, stabilizePage } from "../utils/stabilize.ts";
import { submitLoginForm } from "../utils/auth.ts";
import { qaEnv } from "../../config/env.ts";
import type { QaViewport } from "../../config/viewports.ts";

const ROLE_WIDTHS = ["desktop-1440", "phone-390"];

async function signInAgent(browser: Browser, viewport: QaViewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.isMobile,
    hasTouch: viewport.hasTouch,
    // Not the owner's saved session from the config.
    storageState: undefined,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  await stabilizePage(page);
  await page.goto("/login");
  await submitLoginForm(page, { email: qaEnv.agentEmail!, password: qaEnv.agentPassword!, slug: "rooftop" });
  await page.waitForURL(/\/dashboard(\?.*)?$/, { timeout: 30_000 });
  await waitForAppReady(page);
  return { context, page };
}

/** A record the agent cannot see answers with a 404, which the browser logs; that is the expected path. */
function unexpectedErrors(errors: string[]) {
  return errors.filter((e) => !/Failed to load resource: the server responded with a status of 40[34]/.test(e));
}

async function expectFits(page: Page, label: string) {
  expect(await horizontalOverflow(page), `${label} overflows horizontally`).toBe(0);
}

test.describe("access — the seeded agent", () => {
  test.beforeEach(({ viewportInfo }) => {
    test.skip(!ROLE_WIDTHS.includes(viewportInfo.name), "Role checks run at 1440 and 390");
    test.skip(!qaEnv.agentPassword, "QA_AGENT_PASSWORD is not configured, so no agent is seeded");
  });

  test("someone else's records and company setup each answer once, with a way back", async ({
    browser,
    manifest,
    viewportInfo,
  }) => {
    test.setTimeout(90_000);
    const { context, page } = await signInAgent(browser, viewportInfo);
    const errors = collectPageErrors(page);

    const records: Array<[string, string, string]> = [
      [`/jobs/${manifest.routeTokens.billingJobId}`, "job", "Back to Jobs"],
      [`/estimates/${manifest.routeTokens.approvedEstimateId}`, "estimate", "Back to Estimates"],
      [`/invoices/${manifest.routeTokens.balanceInvoiceId}`, "invoice", "Back to Invoices"],
      [`/leads/${manifest.routeTokens.leadId}`, "lead", "Back to Leads"],
      [`/tasks/${manifest.routeTokens.taskId}`, "task", "Back to Tasks"],
    ];
    for (const [path, noun, back] of records) {
      await page.goto(path);
      await waitForAppReady(page);
      await expectNoCrash(page);
      const state = page.getByTestId("record-unavailable");
      await expect(state, `${path} should say the ${noun} is unavailable`).toContainText(`This ${noun} isn’t available`);
      await expect(state.getByRole("link", { name: new RegExp(`^${back}`) })).toBeVisible();
      // No dead controls around the message.
      await expect(page.getByRole("button", { name: /More .*actions/ })).toHaveCount(0);
      await expectFits(page, `${path} for the agent at ${viewportInfo.name}`);
    }

    for (const [path, area] of [
      ["/users", "The team"],
      ["/estimates/templates", "Estimate templates"],
      ["/automation", "Automation"],
      ["/integrations", "Integrations"],
    ]) {
      await page.goto(path);
      await waitForAppReady(page);
      const state = page.getByTestId("admin-only");
      await expect(state, `${path} should be owner/admin only`).toContainText(`${area} is managed by owners and admins`);
      await expect(state.getByRole("link", { name: "Back to Today" })).toBeVisible();
      await expectFits(page, `${path} for the agent at ${viewportInfo.name}`);
    }

    expect(unexpectedErrors(errors.errors)).toEqual([]);
    await context.close();
  });

  test("a job assigned to the agent opens with its next step; sharing the portal is left to an owner", async ({
    page,
    browser,
    manifest,
    viewportInfo,
  }) => {
    test.setTimeout(90_000);
    const stamp = `${Date.now()}`;
    const leadRes = await page.request.post("/api/leads", {
      data: { first_name: "Agent", last_name: `QA ${stamp}`, status: "New", assigned_to: manifest.users.agentId },
    });
    expect(leadRes.ok()).toBeTruthy();
    const { lead } = await leadRes.json();
    const jobRes = await page.request.post("/api/jobs", {
      data: {
        lead_id: lead.id,
        title: `Agent visit ${viewportInfo.name} ${stamp}`,
        address: "3 Test Way, Minneapolis, MN",
        assigned_to: manifest.users.agentId,
      },
    });
    expect(jobRes.ok()).toBeTruthy();
    const { job } = await jobRes.json();

    const { context, page: agent } = await signInAgent(browser, viewportInfo);
    const errors = collectPageErrors(agent);
    await agent.goto(`/jobs/${job.id}`);
    await waitForAppReady(agent);
    await expectNoCrash(agent);
    await expect(agent.getByTestId("record-unavailable")).toHaveCount(0);
    const next = agent.getByTestId("job-next-step");
    await expect(next).toBeVisible();
    await expect(next.getByRole("button").or(next.getByRole("link")).first()).toBeVisible();

    if (viewportInfo.name === "desktop-1440") {
      // The rail is open by default on desktop; the portal is shared by an owner or admin.
      await expect(agent.getByText("An owner or admin shares the portal link.")).toBeVisible();
      await expect(agent.getByRole("button", { name: /portal link/i })).toHaveCount(0);
    }
    await expectFits(agent, `assigned job for the agent at ${viewportInfo.name}`);

    expect(unexpectedErrors(errors.errors)).toEqual([]);
    await context.close();
  });
});
