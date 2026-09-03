/**
 * Route smoke coverage (acceptance criterion 7).
 *
 * For each Tier 1 authenticated route, at every viewport: the page loads, the
 * expected navigation chrome for that width is present, nothing crashes, and
 * the layout does not overflow horizontally.
 *
 * Breadth over depth by design. Feature-level assertions belong in later
 * phases; this suite's job is to prove the harness can reach and render the
 * application reliably.
 */

import { test, expect } from "../fixtures/test.ts";
import { TIER_1_AUTHENTICATED, resolveRoutePath } from "../../config/routes.ts";
import { collectPageErrors, expectNoCrash, waitForAppReady } from "../utils/app-ready.ts";
import { expectNavigationChrome, pageHeading } from "../utils/nav.ts";
import { findOverflowingElements, horizontalOverflow } from "../utils/stabilize.ts";

test.describe("route smoke", () => {
  for (const route of TIER_1_AUTHENTICATED) {
    test(`${route.id} (${route.kind}) loads`, async ({ page, manifest, viewportInfo }) => {
      const errors = collectPageErrors(page);
      const urlPath = resolveRoutePath(route, manifest.routeTokens);

      await page.goto(urlPath);
      await waitForAppReady(page);

      // Did not get bounced to login: the session is valid for this route.
      expect(
        new URL(page.url()).pathname,
        `${route.id} should stay on ${urlPath}`,
      ).toBe(urlPath);

      await expectNoCrash(page);

      // The app shell always renders an <h1> for these routes.
      await expect(pageHeading(page)).toBeVisible();
      if (route.heading) {
        await expect(pageHeading(page)).toHaveText(route.heading);
      }

      // Correct chrome for this width, per the documented breakpoints.
      await expectNavigationChrome(page, viewportInfo.navigation);

      expect(errors.errors, `unexpected page errors on ${route.id}`).toEqual([]);
    });
  }

  /**
   * Horizontal overflow is the highest-value mobile assertion: it is the most
   * common regression and the most user-visible. Checked at every width, not
   * just phone, because the tablet hybrid state regresses too.
   */
  for (const route of TIER_1_AUTHENTICATED) {
    test(`${route.id} does not overflow horizontally`, async ({
      page,
      manifest,
      viewportInfo,
    }) => {
      await page.goto(resolveRoutePath(route, manifest.routeTokens));
      await waitForAppReady(page);

      const overflow = await horizontalOverflow(page);
      if (overflow > 0) {
        const culprits = await findOverflowingElements(page);
        const detail = culprits
          .map((item) => `    ${item.description} = ${item.width}px > ${item.viewportWidth}px`)
          .join("\n");
        expect(
          overflow,
          `${route.id} at ${viewportInfo.name} scrolls ${overflow}px wider than the ` +
            `viewport.\n  Widest unconstrained elements:\n${detail || "    (none isolated)"}`,
        ).toBe(0);
      }
    });
  }
});

test.describe("seeded content is reachable", () => {
  test("leads list shows every seeded lead", async ({ page }) => {
    await page.goto("/leads");
    await waitForAppReady(page);

    // Names come from the deterministic seed, so these are stable strings.
    for (const name of ["Marcus", "Priya", "Dana", "Owen", "Helen", "Theo"]) {
      await expect(page.getByText(name, { exact: false }).first()).toBeVisible();
    }
  });

  test("lead detail renders the seeded record", async ({ page, manifest }) => {
    await page.goto(`/leads/${manifest.routeTokens.leadId}`);
    await waitForAppReady(page);
    await expect(page.getByText("Marcus", { exact: false }).first()).toBeVisible();
  });

  test("job detail renders the seeded record", async ({ page, manifest }) => {
    await page.goto(`/jobs/${manifest.routeTokens.jobId}`);
    await waitForAppReady(page);
    await expect(
      page.getByText("Asphalt shingle replacement", { exact: false }).first(),
    ).toBeVisible();
  });

  test("invoices list shows all three seeded statuses", async ({ page }) => {
    await page.goto("/invoices");
    await waitForAppReady(page);
    for (const invoiceNumber of ["INV-1001", "INV-1002", "INV-1003"]) {
      await expect(page.getByText(invoiceNumber).first()).toBeVisible();
    }
  });

  test("files list shows seeded files with real binaries", async ({ page }) => {
    await page.goto("/files");
    await waitForAppReady(page);
    await expect(page.getByText("south-slope-hail-damage.png").first()).toBeVisible();
  });

  test("a lead with no related records is reachable for empty-state coverage", async ({
    page,
    manifest,
  }) => {
    await page.goto(`/leads/${manifest.routeTokens.emptyLeadId}`);
    await waitForAppReady(page);
    await expectNoCrash(page);
    await expect(page.getByText("Theo", { exact: false }).first()).toBeVisible();
  });
});
