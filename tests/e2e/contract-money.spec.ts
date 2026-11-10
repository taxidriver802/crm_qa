/**
 * The accepted estimate is the job contract, and payments reduce what is owed.
 * Seeded Brooks already has both. A second check records a deposit through the UI.
 */

import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures/test.ts";

async function clearJobPricing(page: Page, jobId: number) {
  const money = await page.request.get(`/api/jobs/${jobId}/money`);
  if (money.ok()) {
    const body = await money.json();
    for (const payment of body.money?.payments ?? []) {
      await page.request.delete(`/api/jobs/${jobId}/payments/${payment.id}`);
    }
  }

  const estimates = await page.request.get(`/api/estimates/job/${jobId}`);
  if (!estimates.ok()) return;
  const list = ((await estimates.json()).estimates ?? []) as {
    id: number;
    is_contract?: boolean;
  }[];
  const ordered = [...list].sort(
    (a, b) => Number(Boolean(a.is_contract)) - Number(Boolean(b.is_contract)),
  );
  for (const estimate of ordered) {
    await page.request.delete(`/api/estimates/${estimate.id}`);
  }
}

test.describe("contract money", () => {
  test("shows the Brooks contract, what was collected, and the credit", async ({
    page,
    manifest,
  }) => {
    await page.goto(`/jobs/${manifest.jobs["brooks-tearoff"]}`);
    await page.getByRole("tab", { name: "Money" }).click();
    const money = page.locator("#section-money");
    await expect(money).toBeVisible();
    await expect(money.locator("[data-money='contract']")).toHaveText("$21,553.38");
    await expect(money.locator("[data-money='collected']")).toHaveText("$23,284.27");
    await expect(money.getByText("Credit", { exact: true })).toBeVisible();
    await expect(money.locator("[data-money='still-owed']")).toHaveText("$1,730.89");
    await expect(money.getByRole("button", { name: "New change order" })).toBeVisible();
  });

  test("records a deposit against a newly accepted contract", async ({
    page,
    manifest,
    viewportInfo,
  }) => {
    test.skip(
      viewportInfo.name !== "desktop-1440",
      "One viewport records the deposit so the shared database is only changed once.",
    );

    const jobId = manifest.jobs["raman-gutters"];
    await clearJobPricing(page, jobId);
    const created = await page.request.post("/api/estimates", {
      data: { job_id: jobId, title: "Gutter contract" },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const estimateId = (await created.json()).estimate.id as number;

    const line = await page.request.post(`/api/estimates/${estimateId}/line-items`, {
      data: { name: "Gutters", quantity: 1, unit_price: 1000 },
    });
    expect(line.ok(), await line.text()).toBeTruthy();

    const approved = await page.request.patch(`/api/estimates/${estimateId}`, {
      data: { status: "Approved" },
    });
    expect(approved.ok(), await approved.text()).toBeTruthy();

    try {
      await page.goto(`/jobs/${jobId}`);
      await page.getByRole("tab", { name: "Money" }).click();
      const money = page.locator("#section-money");
      await expect(money.locator("[data-money='contract']")).toHaveText("$1,000.00");

      await money.getByLabel("Amount").fill("250");
      await money.getByRole("button", { name: "Record payment" }).click();
      await expect(money.locator("[data-money='collected']")).toHaveText("$250.00");
      await expect(money.locator("[data-money='still-owed']")).toHaveText("$750.00");
      await expect(money.getByText("Check · $250.00")).toBeVisible();
    } finally {
      await clearJobPricing(page, jobId);
    }
  });
});
