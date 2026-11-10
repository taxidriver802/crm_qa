/**
 * Two companies on one Joist (experiment/CC_tenancy).
 *
 * A company registered through the real endpoint signs in with its own slug.
 * None of Rooftop's seeded records are in its lists or its search, and each
 * Rooftop record URL reads exactly like a record that does not exist. Its
 * first invoice is INV-0001, whatever Rooftop has numbered up to (the seed's
 * are INV-1001 to INV-1005). Rooftop's owner, in turn, cannot find or open
 * what the new company made.
 *
 * crm_backend test/tenancy.matrix.test.ts proves this for every route; this
 * is the same promise on screen. It runs at desktop-1440 and phone-390, and
 * registers one fresh company at each (registration is rate limited); it
 * never edits the seeded fixtures.
 */

import { request as playwrightRequest } from "@playwright/test";
import type { APIRequestContext, Browser, Page } from "@playwright/test";
import { test, expect } from "../fixtures/test.ts";
import { qaEnv } from "../../config/env.ts";
import type { QaViewport } from "../../config/viewports.ts";
import { submitLoginForm } from "../utils/auth.ts";
import { collectPageErrors, expectNoCrash, waitForAppReady } from "../utils/app-ready.ts";
import { stabilizePage } from "../utils/stabilize.ts";

const WIDTHS = ["desktop-1440", "phone-390"];

/** Words that appear only in Rooftop's seeded records. */
const ROOFTOP_WORDS = [
  "Rooftop Realty",
  "Webb",
  "Raman",
  "Whitfield",
  "Castellanos",
  "Brooks",
  "Nakamura",
  "Asphalt shingle replacement",
  "Storm damage inspection",
  "INV-100",
];

interface OtherCompany {
  api: APIRequestContext;
  email: string;
  password: string;
  slug: string;
  leadId: number;
  jobId: number;
  estimateId: number;
  invoiceId: number;
  invoiceNumber: string;
  leadName: string;
  jobTitle: string;
}

/**
 * Registers a company through the real endpoint (its owner is signed in on
 * the returned request context) and gives it one lead, job, estimate and
 * invoice of its own.
 */
async function registerOtherCompany(viewport: string): Promise<OtherCompany> {
  const tag = `${viewport.replace(/[^a-z0-9]/g, "")}-${Date.now().toString(36)}`;
  const slug = `quillfeather-${tag}`;
  const email = `${slug}@tenancy.qa`;
  const password = "Tenancypass1!";
  const api = await playwrightRequest.newContext({ baseURL: qaEnv.baseUrl });

  async function created<T>(path: string, data: Record<string, unknown>, key: string): Promise<T> {
    const res = await api.post(path, { data });
    expect(res.status(), `${path}: ${await res.text()}`).toBe(201);
    return (await res.json())[key] as T;
  }

  await created(
    "/api/auth/register",
    {
      first_name: "Quill",
      last_name: "Owner",
      email,
      password,
      company_name: "Quillfeather Roofing",
      slug,
    },
    "user",
  );

  const leadName = "Ines Quillfeather";
  const lead = await created<{ id: number }>(
    "/api/leads",
    { first_name: "Ines", last_name: "Quillfeather", status: "New" },
    "lead",
  );
  const jobTitle = `Quillfeather porch roof ${tag}`;
  const job = await created<{ id: number }>(
    "/api/jobs",
    { lead_id: lead.id, title: jobTitle, address: "9 Quill Lane, Duluth, MN" },
    "job",
  );
  const estimate = await created<{ id: number }>(
    "/api/estimates",
    { job_id: job.id, title: "Quillfeather porch scope" },
    "estimate",
  );
  const invoice = await created<{ id: number; invoice_number: string }>("/api/invoices", { job_id: job.id }, "invoice");

  return {
    api,
    email,
    password,
    slug,
    leadId: lead.id,
    jobId: job.id,
    estimateId: estimate.id,
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoice_number,
    leadName,
    jobTitle,
  };
}

async function signIn(browser: Browser, viewport: QaViewport, company: OtherCompany) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.isMobile,
    hasTouch: viewport.hasTouch,
    // Not Rooftop's owner session from the config.
    storageState: undefined,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  await stabilizePage(page);
  await page.goto("/login");
  await submitLoginForm(page, {
    email: company.email,
    password: company.password,
    slug: company.slug,
  });
  await page.waitForURL(/\/dashboard(\?.*)?$/, { timeout: 30_000 });
  await waitForAppReady(page);
  return { context, page };
}

/** A record from the other company answers with a 404, which the browser logs; that is the expected path. */
function unexpectedErrors(errors: string[]) {
  return errors.filter((e) => !/Failed to load resource: the server responded with a status of 404/.test(e));
}

async function expectUnavailable(page: Page, path: string, noun: string) {
  await page.goto(path);
  await waitForAppReady(page);
  await expectNoCrash(page);
  await expect(
    page.getByTestId("record-unavailable"),
    `${path} should read as a ${noun} that does not exist`,
  ).toContainText(`This ${noun} isn’t available`);
}

/** Every result list in a /api/search answer, flattened to "type:id". */
function searchHits(body: Record<string, unknown>): string[] {
  const hits: string[] = [];
  for (const [type, value] of Object.entries(body)) {
    if (Array.isArray(value)) for (const row of value) hits.push(`${type}:${(row as { id: unknown }).id}`);
  }
  const related = body.related as Record<string, unknown[]> | undefined;
  for (const [type, value] of Object.entries(related ?? {})) {
    for (const row of value) hits.push(`related.${type}:${(row as { id: unknown }).id}`);
  }
  return hits;
}

test.describe("tenancy — a second company", () => {
  test.beforeEach(({ viewportInfo }) => {
    test.skip(!WIDTHS.includes(viewportInfo.name), "Tenancy checks run at 1440 and 390");
  });

  // One company per width: registration is limited to 10 an hour per
  // address, and the rest of the suite registers some too.
  test("each company sees only its own records; the other's read as missing", async ({
    page: rooftop,
    browser,
    manifest,
    viewportInfo,
  }) => {
    test.setTimeout(150_000);
    const other = await registerOtherCompany(viewportInfo.name);
    // Numbering is per company: Rooftop's seed ends at INV-1005.
    expect(other.invoiceNumber).toBe("INV-0001");

    const { context, page } = await signIn(browser, viewportInfo, other);
    const errors = collectPageErrors(page);

    await test.step("its lists show its own record and none of Rooftop's", async () => {
      // Estimates have no list of their own; they are listed on their job.
      const lists: Array<[string, string | null]> = [
        ["/dashboard", null],
        ["/leads", "Quillfeather"],
        ["/jobs", other.jobTitle],
        ["/invoices", other.invoiceNumber],
      ];
      for (const [path, own] of lists) {
        await page.goto(path);
        await waitForAppReady(page);
        await expectNoCrash(page);
        if (own) {
          // Its own record shows, so the list has loaded.
          await expect(
            page.locator("main").getByText(own).first(),
            `${path} should show the company's own record`,
          ).toBeVisible();
        } else {
          // The dashboard has no one record to wait for; the tab names the company.
          await expect(page).toHaveTitle("Quillfeather Roofing CRM");
        }
        const text = await page.locator("body").innerText();
        for (const word of ROOFTOP_WORDS) {
          expect(text, `${path} shows "${word}" from Rooftop`).not.toContain(word);
        }
      }
    });

    await test.step("its search finds nothing of Rooftop's, and its own lead once", async () => {
      for (const word of ["Webb", "Whitfield", "Brooks", "INV-1001", "Asphalt"]) {
        const res = await page.request.get(`/api/search?q=${encodeURIComponent(word)}`);
        expect(res.ok()).toBeTruthy();
        expect(searchHits(await res.json()), `search for ${word}`).toEqual([]);
      }
      // The other width's company has a Quillfeather lead too; it is not found.
      const own = await page.request.get("/api/search?q=Quillfeather&types=leads");
      expect(own.ok()).toBeTruthy();
      expect(((await own.json()).leads as Array<{ id: number }>).map((lead) => lead.id)).toEqual([other.leadId]);
    });

    await test.step("Rooftop's record URLs read like records that do not exist", async () => {
      const tokens = manifest.routeTokens;
      await expectUnavailable(page, `/leads/${tokens.leadId}`, "lead");
      await expectUnavailable(page, `/jobs/${tokens.billingJobId}`, "job");
      await expectUnavailable(page, `/estimates/${tokens.approvedEstimateId}`, "estimate");
      await expectUnavailable(page, `/invoices/${tokens.balanceInvoiceId}`, "invoice");
      await expectUnavailable(page, `/tasks/${tokens.taskId}`, "task");
      // An id nobody has reads the same.
      await expectUnavailable(page, "/jobs/999999", "job");

      // Its own invoice opens.
      await page.goto(`/invoices/${other.invoiceId}`);
      await waitForAppReady(page);
      await expect(page.getByTestId("record-unavailable")).toHaveCount(0);
      await expect(page.getByRole("heading", { level: 1, name: other.invoiceNumber })).toBeVisible();
    });
    expect(unexpectedErrors(errors.errors)).toEqual([]);
    await context.close();

    await test.step("Rooftop's owner cannot find or open what it made", async () => {
      const rooftopErrors = collectPageErrors(rooftop);
      await rooftop.goto("/leads");
      await waitForAppReady(rooftop);
      // Rooftop's own leads show (the list has loaded); the other company's does not.
      await expect(rooftop.locator("main").getByText("Webb").first()).toBeVisible();
      await expect(rooftop.getByText("Quillfeather")).toHaveCount(0);

      const res = await rooftop.request.get("/api/search?q=Quillfeather");
      expect(res.ok()).toBeTruthy();
      expect(searchHits(await res.json())).toEqual([]);

      await expectUnavailable(rooftop, `/leads/${other.leadId}`, "lead");
      await expectUnavailable(rooftop, `/jobs/${other.jobId}`, "job");
      await expectUnavailable(rooftop, `/estimates/${other.estimateId}`, "estimate");
      await expectUnavailable(rooftop, `/invoices/${other.invoiceId}`, "invoice");
      expect(unexpectedErrors(rooftopErrors.errors)).toEqual([]);
    });

    await other.api.dispose();
  });
});
