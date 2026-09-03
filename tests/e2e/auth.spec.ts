/**
 * Authentication behaviour.
 *
 * Covers acceptance criterion 5 (a real login succeeds) and documents how the
 * application ACTUALLY guards routes.
 *
 * Route protection is UNEVEN, in three distinct tiers. Measured, not assumed:
 *
 *   1. middleware-guarded - crm_frontend/src/proxy.js. Next.js 16 renamed
 *      `middleware` to `proxy`, so that file IS active middleware; the build
 *      output confirms it with a "Proxy (Middleware)" entry. Its matcher
 *      covers /dashboard, /leads, /tasks, /files, /jobs and /notifications.
 *      A signed-out request is redirected server-side, before any render.
 *
 *   2. client-guarded - e.g. /users, which is absent from the matcher but
 *      calls router.replace("/login") itself when /api/auth/me fails
 *      (src/app/users/page.js). The redirect happens after the shell paints.
 *
 *   3. unguarded - e.g. /invoices, absent from the matcher AND lacking a
 *      client-side guard. The shell renders for a signed-out visitor and the
 *      data merely fails to load.
 *
 * These tests assert that real behaviour rather than an idealised version of
 * it. Tier 3 is reported as a finding, not fixed.
 */

import { test, expect } from "../fixtures/test.ts";
import { qaEnv } from "../../config/env.ts";
import { AUTH_COOKIE_NAME } from "../../config/constants.ts";
import { login, OWNER, submitLoginForm } from "../utils/auth.ts";
import { waitForAppReady } from "../utils/app-ready.ts";

/** Tier 1: in the proxy.js matcher, redirected server-side. */
const MIDDLEWARE_GUARDED_PATHS = ["/dashboard", "/leads", "/tasks", "/files", "/jobs"];

/** Tier 2: not matched, but the page redirects itself once mounted. */
const CLIENT_GUARDED_PATHS = ["/users"];

/** Tier 3: no guard at any layer. */
const UNGUARDED_PATHS = ["/invoices"];

test.describe("authentication", () => {
  test("criterion 5: a real login through the form succeeds", async ({ freshContext }) => {
    const { context, page } = await freshContext();

    // Starts with no session at all.
    expect(await context.cookies(qaEnv.baseUrl)).toHaveLength(0);

    await login(page, OWNER);

    const auth = (await context.cookies(qaEnv.baseUrl)).find(
      (cookie) => cookie.name === AUTH_COOKIE_NAME,
    );
    expect(auth, "login should set the access_token cookie").toBeTruthy();
    expect(auth?.httpOnly, "cookie must stay httpOnly").toBe(true);
    expect(auth?.path).toBe("/");
  });

  test("rejects bad credentials without creating a session", async ({ freshContext }) => {
    const { context, page } = await freshContext();

    await page.goto("/login");
    await submitLoginForm(page, {
      email: OWNER.email,
      password: "definitely-not-the-right-password",
    });

    // The page surfaces a generic message and stays put.
    await expect(page.getByText("Invalid credentials")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/login");

    const auth = (await context.cookies(qaEnv.baseUrl)).find(
      (cookie) => cookie.name === AUTH_COOKIE_NAME,
    );
    expect(auth, "a failed login must not set a session cookie").toBeUndefined();
  });

  test("logging out clears the session and returns to login", async ({ freshContext }) => {
    const { context, page } = await freshContext();
    await login(page, OWNER);

    // Logout lives behind a confirm dialog in the app shell.
    await page.request.post(`${qaEnv.baseUrl}/api/auth/logout`);

    const auth = (await context.cookies(qaEnv.baseUrl)).find(
      (cookie) => cookie.name === AUTH_COOKIE_NAME,
    );
    expect(auth?.value ?? "").toBe("");

    // With the cookie gone, proxy.js should bounce a guarded route.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  for (const guardedPath of MIDDLEWARE_GUARDED_PATHS) {
    test(`tier 1: unauthenticated ${guardedPath} is redirected by middleware`, async ({
      freshContext,
    }) => {
      const { page } = await freshContext();
      await page.goto(guardedPath);
      // proxy.js matches this path and redirects when access_token is absent.
      await expect(page).toHaveURL(/\/login/);
      await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    });
  }

  for (const guardedPath of CLIENT_GUARDED_PATHS) {
    test(`tier 2: unauthenticated ${guardedPath} self-redirects client-side`, async ({
      freshContext,
    }) => {
      const { page } = await freshContext();
      await page.goto(guardedPath);

      // Not in the proxy.js matcher, so no server-side redirect occurs. The
      // page reaches the browser and only then calls router.replace("/login")
      // after /api/auth/me returns 401.
      await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
    });
  }

  for (const openPath of UNGUARDED_PATHS) {
    test(`tier 3: unauthenticated ${openPath} renders unguarded (FINDING)`, async ({
      freshContext,
    }) => {
      const { page } = await freshContext();
      await page.goto(openPath);
      await waitForAppReady(page);

      // FINDING (reported, not fixed): this authenticated route is absent from
      // the proxy.js matcher AND has no client-side guard, so the app shell
      // renders for a signed-out visitor while its data fails to load.
      //
      // Asserting the real behaviour is deliberate: if the guard is ever
      // added, this test fails loudly and the path should move up a tier.
      expect(
        new URL(page.url()).pathname,
        `${openPath} has no guard at either layer, so no redirect occurs`,
      ).toBe(openPath);
    });
  }

  test("an authenticated user visiting /login is sent to the dashboard", async ({ page }) => {
    // This project already carries a session via storageState.
    await page.goto("/login");
    await expect(page).toHaveURL(/\/dashboard/);
  });
});
