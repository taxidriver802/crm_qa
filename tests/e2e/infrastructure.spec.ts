/**
 * Phase 2 acceptance criteria as executable assertions.
 *
 * This spec exists to prove the HARNESS works, not to test CRM features. If
 * something here fails, the problem is the plumbing: wrong database, wrong
 * port, stale build, or a leaked development dependency.
 */

import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { test, expect } from "../fixtures/test.ts";
import { qaEnv } from "../../config/env.ts";
import { AUTH_COOKIE_NAME, PROTECTED_DATABASES, QA_NOW } from "../../config/constants.ts";
import { assertSafeQaTarget, currentTarget, UnsafeQaTargetError } from "../../db/admin.ts";
import { VIEWPORTS } from "../../config/viewports.ts";
import { waitForAppReady } from "../utils/app-ready.ts";

test.describe("infrastructure", () => {
  test("criterion 1: destructive guards reject protected databases", async () => {
    // The full hostile-input matrix lives in scripts/guard-check.ts, which runs
    // before any database work. This re-asserts the core promise in-suite.
    for (const name of PROTECTED_DATABASES) {
      expect(
        () =>
          assertSafeQaTarget({
            dbName: name,
            databaseUrl: `postgresql://crm:pw@localhost:5432/${name}`,
            adminDatabaseUrl: "postgresql://su@localhost:5432/postgres",
          }),
        `guard must reject "${name}"`,
      ).toThrow(UnsafeQaTargetError);
    }

    // The live configuration must be safe.
    expect(() => assertSafeQaTarget(currentTarget())).not.toThrow();
    expect(qaEnv.dbName).toBe("crm_qa");
  });

  test("criterion 2: seed is deterministic and complete", async ({ manifest }) => {
    expect(manifest.generatedFrom.database).toBe("crm_qa");
    expect(manifest.generatedFrom.seedAnchor).toBe("2026-03-02T09:00:00.000Z");

    // Fixed user ids, not gen_random_uuid() output.
    expect(manifest.users.ownerId).toBe("a0000000-0000-4000-8000-000000000001");

    expect(Object.keys(manifest.leads)).toHaveLength(6);
    expect(Object.keys(manifest.jobs)).toHaveLength(4);
    expect(Object.keys(manifest.tasks)).toHaveLength(8);
    expect(Object.keys(manifest.estimates)).toHaveLength(3);
    expect(Object.keys(manifest.invoices)).toHaveLength(3);
    expect(Object.keys(manifest.files)).toHaveLength(4);

    // A barren lead must exist so empty states are reachable.
    expect(manifest.routeTokens.emptyLeadId).toBeTruthy();
  });

  test("criterion 3: backend is connected to crm_qa, not crm_dev", async ({ request }) => {
    const health = await request.get(`${qaEnv.backendUrl}/health`);
    expect(health.ok()).toBeTruthy();
    expect((await health.json()).service).toBe("crm-backend");

    // Ask the database directly which database the QA connection string
    // resolves to, and confirm the seeded owner lives there.
    const client = new pg.Client({ connectionString: qaEnv.databaseUrl });
    await client.connect();
    try {
      const db = await client.query<{ current_database: string }>("SELECT current_database()");
      expect(db.rows[0].current_database).toBe("crm_qa");

      const owner = await client.query<{ email: string; role: string }>(
        "SELECT email, role FROM users WHERE id = $1",
        ["a0000000-0000-4000-8000-000000000001"],
      );
      expect(owner.rows[0].email).toBe(qaEnv.ownerEmail);
      expect(owner.rows[0].role).toBe("owner");
    } finally {
      await client.end();
    }
  });

  test("criterion 4: frontend proxies /api to the QA backend", async ({ page }) => {
    // Same-origin round trip: the browser calls /api/auth/me on the frontend
    // origin, next.config.mjs rewrites() forwards it to the QA backend, and
    // the QA session cookie authenticates it.
    const response = await page.request.get(`${qaEnv.baseUrl}/api/auth/me`);
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.user.email).toBe(qaEnv.ownerEmail);
    expect(body.user.role).toBe("owner");
  });

  test("criterion 6: storageState authenticates without logging in", async ({ page, context }) => {
    // This context was built from the saved storageState and has performed no
    // login of its own.
    const cookies = await context.cookies(qaEnv.baseUrl);
    const auth = cookies.find((cookie) => cookie.name === AUTH_COOKIE_NAME);
    expect(auth, "storageState should carry the auth cookie").toBeTruthy();
    expect(auth?.httpOnly).toBe(true);

    await page.goto("/dashboard");
    await waitForAppReady(page);

    // Reaching the dashboard at all proves the session works: proxy.js
    // redirects unauthenticated requests for /dashboard to /login.
    expect(new URL(page.url()).pathname).toBe("/dashboard");
    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  });

  test("criterion 8: this viewport project executes", async ({ page, viewportInfo }) => {
    const size = page.viewportSize();
    expect(size?.width).toBe(viewportInfo.width);
    expect(size?.height).toBe(viewportInfo.height);

    // Confirm the pinned clock reached the page, so relative-time rendering is
    // reproducible.
    const browserNow = await page.evaluate(() => Date.now());
    expect(Math.abs(browserNow - QA_NOW.getTime())).toBeLessThan(60_000);
  });

  test("criterion 9: development environment is undisturbed", async () => {
    // (a) QA must not be bound to the development ports.
    expect(qaEnv.frontendPort).not.toBe(3000);
    expect(qaEnv.backendPort).not.toBe(4000);
    expect(qaEnv.baseUrl).toContain("3100");

    // (b) The real frontend build output must be untouched: QA builds from a
    //     staged copy at .qa-build/frontend precisely so this holds.
    const realNext = path.join(qaEnv.frontendPath, ".next");
    const stagedNext = path.join(qaEnv.stagedFrontendPath, ".next");
    expect(fs.existsSync(stagedNext), "staged build output should exist").toBeTruthy();
    expect(stagedNext.startsWith(qaEnv.qaRoot)).toBeTruthy();

    if (fs.existsSync(path.join(realNext, "BUILD_ID"))) {
      const realBuildId = fs.readFileSync(path.join(realNext, "BUILD_ID"), "utf8").trim();
      const stagedBuildId = fs.readFileSync(path.join(stagedNext, "BUILD_ID"), "utf8").trim();
      // Different BUILD_IDs prove the QA build did not overwrite the dev one.
      expect(stagedBuildId).not.toBe(realBuildId);
    }

    // (c) crm_dev must still be intact and separate.
    const client = new pg.Client({ connectionString: qaEnv.adminDatabaseUrl });
    await client.connect();
    try {
      const present = await client.query<{ datname: string }>(
        "SELECT datname FROM pg_database WHERE datname IN ('crm_dev','crm_qa','overnight_dev')",
      );
      const names = present.rows.map((row) => row.datname);
      expect(names, "crm_dev must still exist").toContain("crm_dev");
      expect(names, "overnight_dev must still exist").toContain("overnight_dev");
      expect(names, "crm_qa must exist").toContain("crm_qa");
    } finally {
      await client.end();
    }
  });

  test("viewport matrix matches the application's real breakpoints", async () => {
    // Guards against someone quietly changing the matrix to round numbers that
    // no longer straddle the app's breakpoints.
    const byName = new Map(VIEWPORTS.map((viewport) => [viewport.name, viewport]));

    // Below the 767px rule: tables collapse to cards, bottom nav active.
    expect(byName.get("phone-390")?.tables).toBe("stacked-cards");
    expect(byName.get("phone-390")?.navigation).toBe("mobile");

    // The hybrid state: >= md so tables return, but < lg so nav is still mobile.
    expect(byName.get("tablet-768")?.width).toBe(768);
    expect(byName.get("tablet-768")?.tables).toBe("table");
    expect(byName.get("tablet-768")?.navigation).toBe("mobile");

    // At and above lg: desktop sidebar.
    expect(byName.get("laptop-1280")?.navigation).toBe("sidebar");
    expect(byName.get("desktop-1440")?.navigation).toBe("sidebar");
  });
});
