/**
 * The desk is personal: density and the job pane are stored on the user
 * and still there after a reload.
 */

import { test, expect } from "../fixtures/test.ts";

test.describe("workspace", () => {
  test("keeps density and the job pane after reload", async ({ page, manifest, viewportInfo }) => {
    test.skip(viewportInfo.name !== "desktop-1440", "Preference check runs once on desktop");

    const jobId = manifest.jobs["brooks-tearoff"];

    try {
      await page.goto("/dashboard");
      await page.getByRole("button", { name: "Settings" }).click();
      const savedDensity = page.waitForResponse(
        (res) => res.url().includes("/auth/preferences") && res.request().method() === "PATCH",
      );
      await page.getByLabel("Density").selectOption("compact");
      await savedDensity;
      await expect(page.locator("html")).toHaveAttribute("data-density", "compact");

      await page.goto(`/jobs/${jobId}`);
      const savedPane = page.waitForResponse(
        (res) => res.url().includes("/auth/preferences") && res.request().method() === "PATCH",
      );
      await page.getByRole("tab", { name: "Money" }).click();
      await savedPane;
      await expect(page.locator("#section-money")).toBeVisible();
      await expect(page.getByText("Communication", { exact: true })).toBeHidden();

      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
      await expect(page.locator("#section-money")).toBeVisible();
      await expect(page.getByRole("tab", { name: "Money" })).toHaveAttribute("aria-selected", "true");
    } finally {
      await page.request.patch("/api/auth/preferences", {
        data: { density: "comfortable", desk: "queue", job_pane: "work" },
      });
    }
  });
});
