/**
 * Authentication helpers.
 *
 * Login is performed through the real /login form rather than by forging a
 * JWT, so the login flow itself is exercised on every run. The resulting
 * session is captured once into storageState and reused by all projects.
 *
 * Selectors are derived from crm_frontend/src/app/login/page.js, where each
 * input is wrapped in a <label> containing its text - giving the input an
 * implicit accessible name that getByLabel can target. No data-testid exists
 * anywhere in the app, and this harness does not add any.
 */

import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { AUTH_COOKIE_NAME, PINNED_LOCAL_STORAGE } from "../../config/constants.ts";
import { qaEnv } from "../../config/env.ts";

export interface Credentials {
  email: string;
  password: string;
}

export const OWNER: Credentials = {
  email: qaEnv.ownerEmail,
  password: qaEnv.ownerPassword,
};

/** Fills and submits the login form. Does not assert the outcome. */
export async function submitLoginForm(page: Page, credentials: Credentials): Promise<void> {
  await page.getByLabel("Email").fill(credentials.email);
  await page.getByLabel("Password").fill(credentials.password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/**
 * Logs in and waits for the dashboard.
 *
 * The app calls router.replace("/dashboard") after a successful POST
 * /auth/login, so a URL assertion is the correct completion signal.
 */
export async function login(page: Page, credentials: Credentials = OWNER): Promise<void> {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  await submitLoginForm(page, credentials);

  await page.waitForURL(/\/dashboard(\?.*)?$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
}

/**
 * Applies the pinned localStorage values so theme, palette, sidebar state and
 * list view modes are explicit inputs rather than inherited state.
 */
export async function pinClientState(page: Page): Promise<void> {
  await page.evaluate((entries) => {
    for (const [key, value] of Object.entries(entries)) {
      window.localStorage.setItem(key, value);
    }
  }, PINNED_LOCAL_STORAGE);
}

/** Confirms the auth cookie is present on the QA frontend origin. */
export async function expectAuthCookie(context: BrowserContext): Promise<void> {
  const cookies = await context.cookies(qaEnv.baseUrl);
  const auth = cookies.find((cookie) => cookie.name === AUTH_COOKIE_NAME);
  expect(auth, `expected a "${AUTH_COOKIE_NAME}" cookie on ${qaEnv.baseUrl}`).toBeTruthy();
  // httpOnly is the backend's setting (crm_backend/src/lib/authCookies.ts) and
  // should never regress to a JS-readable cookie.
  expect(auth?.httpOnly).toBe(true);
}

/** True if a saved storageState file exists. */
export function authStateExists(): boolean {
  return fs.existsSync(qaEnv.authStatePath);
}

/**
 * Persists the authenticated session with restrictive permissions.
 * The file contains a live session cookie, so it is gitignored and 0600.
 */
export async function saveAuthState(context: BrowserContext): Promise<void> {
  fs.mkdirSync(path.dirname(qaEnv.authStatePath), { recursive: true });
  await context.storageState({ path: qaEnv.authStatePath });
  fs.chmodSync(qaEnv.authStatePath, 0o600);
}
