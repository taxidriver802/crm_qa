/**
 * A way back in, and sessions that end (experiment/CC_way_back_in).
 *
 * QA runs without SMTP, so every link is handed back to copy:
 *   - Forgot password says this Joist can't email, and who can help.
 *   - An owner makes a reset link from the Users page; using it sets a new
 *     password, signs that browser in, and ends the person's other sessions.
 *   - Preferences changes the password (other devices sign out, this one
 *     stays) and signs out everywhere else.
 *   - Log out ends this browser's session on the server, so its cookie no
 *     longer works if replayed, while the person's other sessions carry on.
 *
 * Each test invites its own agent through the owner's API session and never
 * touches the owner's shared session, which the rest of the suite relies on.
 */

import { request as playwrightRequest } from "@playwright/test";
import type { APIRequestContext, Browser, Page } from "@playwright/test";
import { test, expect } from "../fixtures/test.ts";
import { collectPageErrors, expectNoCrash, waitForAppReady } from "../utils/app-ready.ts";
import { horizontalOverflow, stabilizePage } from "../utils/stabilize.ts";
import { submitLoginForm } from "../utils/auth.ts";
import { AUTH_COOKIE_NAME } from "../../config/constants.ts";
import { qaEnv } from "../../config/env.ts";
import type { QaViewport } from "../../config/viewports.ts";

const MAIN_WIDTHS = ["desktop-1440", "phone-390"];
const RUN = Date.now().toString(36);

interface Agent {
  email: string;
  password: string;
  name: string;
  /** Signed in by accepting the invite: a session on another "device". */
  api: APIRequestContext;
}

/** Invites an agent as the owner and accepts the invite in a separate API context. */
async function inviteAgent(owner: Page, label: string, viewport: string): Promise<Agent> {
  const email = `qa-accounts-${label}-${viewport}-${RUN}@crm.local`;
  const first = "Acct";
  const last = `${label[0].toUpperCase()}${label.slice(1)}`;
  const invited = await owner.request.post("/api/users/invite", {
    data: { first_name: first, last_name: last, email, role: "agent" },
  });
  expect(invited.status(), await invited.text()).toBe(201);
  const inviteUrl = (await invited.json()).invite_url as string;
  const token = new URL(inviteUrl).searchParams.get("token");
  expect(token, "the invite hands back a link to copy").toBeTruthy();

  const password = `first-pass-${RUN}`;
  const api = await playwrightRequest.newContext({ baseURL: qaEnv.baseUrl });
  const accepted = await api.post("/api/auth/accept-invite", { data: { token, password } });
  expect(accepted.status(), await accepted.text()).toBe(200);
  return { email, password, name: `${first} ${last}`, api };
}

async function signIn(browser: Browser, viewport: QaViewport, email: string, password: string) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.isMobile,
    hasTouch: viewport.hasTouch,
    storageState: undefined,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  await stabilizePage(page);
  await page.goto("/login");
  await submitLoginForm(page, { email, password, slug: "rooftop" });
  await page.waitForURL(/\/dashboard(\?.*)?$/, { timeout: 30_000 });
  await waitForAppReady(page);
  return { context, page };
}

async function blankContext(browser: Browser, viewport: QaViewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.isMobile,
    hasTouch: viewport.hasTouch,
    storageState: undefined,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  await stabilizePage(page);
  return { context, page };
}

async function meStatus(api: APIRequestContext) {
  return (await api.get("/api/auth/me")).status();
}

/** An ended session answers 401, which the browser logs; that is the expected path. */
function unexpectedErrors(errors: string[]) {
  return errors.filter((e) => !/Failed to load resource: the server responded with a status of 40[0-4]/.test(e));
}

async function expectFits(page: Page, label: string) {
  expect(await horizontalOverflow(page), `${label} overflows horizontally`).toBe(0);
}

async function openActions(owner: Page, email: string, item: string) {
  await owner.getByRole("row").filter({ hasText: email }).getByRole("button", { name: "Actions" }).click();
  await owner
    .getByRole("menu", { name: `Actions for ${email}` })
    .getByRole("menuitem", { name: item })
    .click();
}

test.describe("accounts — a way back in", () => {
  test.beforeEach(({ viewportInfo }) => {
    test.skip(!MAIN_WIDTHS.includes(viewportInfo.name), "Account checks run at 1440 and 390");
  });

  test("Forgot password says this Joist can't email, and who can send a link", async ({ browser, viewportInfo }) => {
    const { context, page } = await blankContext(browser, viewportInfo);
    const { errors } = collectPageErrors(page);
    try {
      await page.goto("/login");
      await waitForAppReady(page);
      await page.getByRole("link", { name: "Forgot password?" }).click();
      await expect(page).toHaveURL(/\/forgot-password$/);
      await expect(page.getByRole("heading", { name: "Forgot password" })).toBeVisible();

      await page.getByLabel("Company slug").fill("rooftop");
      await page.getByLabel("Email").fill(`nobody-${viewportInfo.name}-${RUN}@crm.local`);
      await page.getByRole("button", { name: "Email me a link" }).click();

      const sent = page.getByTestId("forgot-sent");
      await expect(sent).toContainText("This Joist can’t send email yet");
      await expect(sent).toContainText("Ask an owner or admin at your company to send you a reset link");
      await expectFits(page, "/forgot-password");
      await sent.getByRole("link", { name: "Back to sign in" }).click();
      await expect(page).toHaveURL(/\/login$/);
      await expectNoCrash(page);
      expect(unexpectedErrors(errors)).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("an owner's copied reset link signs the person back in and ends their other sessions", async ({
    page: owner,
    browser,
    viewportInfo,
  }) => {
    test.skip(viewportInfo.name !== "desktop-1440", "The owner's Users page flow runs once, at 1440");
    test.setTimeout(120_000);
    const agent = await inviteAgent(owner, "reset", viewportInfo.name);
    const before = await signIn(browser, viewportInfo, agent.email, agent.password);
    try {
      await owner.goto("/users");
      await waitForAppReady(owner);
      await openActions(owner, agent.email, "Send password reset link");
      const confirm = owner.getByRole("dialog", { name: `Send ${agent.name} a password reset link?` });
      await confirm.getByRole("button", { name: "Make the link" }).click();

      const handoff = owner.getByTestId("link-handoff");
      await expect(handoff.getByRole("heading", { name: "Password reset link" })).toBeVisible();
      await expect(handoff).toContainText("This Joist can’t send email yet");
      const link = await handoff.getByTestId("handoff-url").inputValue();
      expect(link).toMatch(/\/reset-password\?token=[0-9a-f]{64}$/);
      await handoff.getByRole("button", { name: "Done" }).click();
      await expect(handoff).toBeHidden();
      const path = new URL(link).pathname + new URL(link).search;

      // The person opens the link on a new device.
      const fresh = await blankContext(browser, viewportInfo);
      const { errors } = collectPageErrors(fresh.page);
      try {
        await fresh.page.goto(path);
        await expect(fresh.page.getByRole("heading", { name: "Set a new password" })).toBeVisible();
        await expect(fresh.page.getByText(`For ${agent.email} at Rooftop Realty.`)).toBeVisible();
        const newPassword = `reset-pass-${RUN}`;
        await fresh.page.getByLabel(/^New password/).fill(newPassword);
        await fresh.page.getByLabel("Confirm new password").fill(newPassword);
        await fresh.page.getByRole("button", { name: "Set password and sign in" }).click();
        await fresh.page.waitForURL(/\/dashboard(\?.*)?$/, { timeout: 30_000 });
        await waitForAppReady(fresh.page);
        await expectNoCrash(fresh.page);
        expect(unexpectedErrors(errors)).toEqual([]);
      } finally {
        await fresh.context.close();
      }

      // Every session from before the reset is over: the browser and the API.
      expect(await meStatus(agent.api), "the invite session ended").toBe(401);
      await before.page.goto("/dashboard");
      await expect(before.page).toHaveURL(/\/login/, { timeout: 30_000 });

      // The old password no longer works; the new one does.
      const api = await playwrightRequest.newContext({ baseURL: qaEnv.baseUrl });
      try {
        const old = await api.post("/api/auth/login", {
          data: { company_slug: "rooftop", email: agent.email, password: agent.password },
        });
        expect(old.status()).toBe(401);
        const current = await api.post("/api/auth/login", {
          data: { company_slug: "rooftop", email: agent.email, password: `reset-pass-${RUN}` },
        });
        expect(current.status()).toBe(200);
      } finally {
        await api.dispose();
      }

      // The owner sees what happened.
      await owner.reload();
      await waitForAppReady(owner);
      await openActions(owner, agent.email, "Account history");
      const history = owner.getByTestId("account-history");
      await expect(history).toContainText("Set a new password from a reset link");
      await expect(history).toContainText(/Reset link made to copy by Quinn/);
      await expect(history).toContainText("Accepted the invite");
      await history.getByRole("button", { name: "Close" }).click();

      // The link worked once.
      const again = await blankContext(browser, viewportInfo);
      try {
        await again.page.goto(path);
        await expect(again.page.getByTestId("reset-unavailable")).toContainText("This link has already been used.");
        await expect(again.page.getByRole("link", { name: "Ask for a new link" })).toBeVisible();
      } finally {
        await again.context.close();
      }
    } finally {
      await before.context.close();
      await agent.api.dispose();
    }
  });

  test("Preferences changes the password and signs out everywhere else, keeping this browser", async ({
    page: owner,
    browser,
    viewportInfo,
  }) => {
    test.setTimeout(120_000);
    const agent = await inviteAgent(owner, "prefs", viewportInfo.name);
    const here = await signIn(browser, viewportInfo, agent.email, agent.password);
    const { errors } = collectPageErrors(here.page);
    const later = await playwrightRequest.newContext({ baseURL: qaEnv.baseUrl });
    try {
      await here.page.goto("/settings?tab=account");
      await waitForAppReady(here.page);
      const panel = here.page.getByTestId("settings-account");
      await expect(panel.getByRole("heading", { name: "Change password" })).toBeVisible();
      await expectFits(here.page, "/settings?tab=account");

      // A wrong current password is refused and nothing else changes.
      await panel.getByLabel("Current password").fill("not-my-password");
      await panel.getByLabel("New password", { exact: true }).fill(`changed-pass-${RUN}`);
      await panel.getByLabel("Confirm new password").fill(`changed-pass-${RUN}`);
      await panel.getByRole("button", { name: "Change password" }).click();
      await expect(panel.getByRole("alert")).toHaveText("Your current password isn’t right.");
      expect(await meStatus(agent.api)).toBe(200);

      await panel.getByLabel("Current password").fill(agent.password);
      await panel.getByRole("button", { name: "Change password" }).click();
      await expect(here.page.getByText("Password changed. 1 other device was signed out.")).toBeVisible();
      expect(await meStatus(agent.api), "the other device is signed out").toBe(401);
      await here.page.reload();
      await waitForAppReady(here.page);
      await expect(panel).toBeVisible();
      await expect(here.page).toHaveURL(/\/settings\?tab=account$/);

      // Sign in somewhere else with the new password, then end it from here.
      const signedIn = await later.post("/api/auth/login", {
        data: { company_slug: "rooftop", email: agent.email, password: `changed-pass-${RUN}` },
      });
      expect(signedIn.status()).toBe(200);
      expect(await meStatus(later)).toBe(200);

      await panel.getByRole("button", { name: "Sign out everywhere else" }).click();
      const confirm = here.page.getByRole("dialog", { name: "Sign out everywhere else?" });
      await confirm.getByRole("button", { name: "Sign out others" }).click();
      await expect(here.page.getByText("Signed out 1 other session.")).toBeVisible();
      expect(await meStatus(later), "the later sign-in is signed out").toBe(401);

      await here.page.reload();
      await waitForAppReady(here.page);
      await expect(panel).toBeVisible();
      await expectNoCrash(here.page);
      expect(unexpectedErrors(errors)).toEqual([]);
    } finally {
      await later.dispose();
      await here.context.close();
      await agent.api.dispose();
    }
  });

  test("Log out ends this browser's session on the server and leaves the others", async ({
    page: owner,
    browser,
    viewportInfo,
  }) => {
    test.skip(viewportInfo.name !== "desktop-1440", "Log out is checked once, at 1440");
    const agent = await inviteAgent(owner, "logout", viewportInfo.name);
    const here = await signIn(browser, viewportInfo, agent.email, agent.password);
    let replay: APIRequestContext | null = null;
    try {
      const cookie = (await here.context.cookies(qaEnv.baseUrl)).find((c) => c.name === AUTH_COOKIE_NAME);
      expect(cookie?.value, "signed in with a session cookie").toBeTruthy();

      await here.page.getByRole("button", { name: "Account and preferences" }).click();
      await here.page.getByRole("menuitem", { name: "Log out" }).click();
      await here.page.getByRole("dialog", { name: "Log out?" }).getByRole("button", { name: "Log out" }).click();
      await expect(here.page).toHaveURL(/\/login/, { timeout: 30_000 });

      // A copy of the cookie taken before signing out no longer works.
      replay = await playwrightRequest.newContext({
        baseURL: qaEnv.baseUrl,
        extraHTTPHeaders: { Cookie: `${AUTH_COOKIE_NAME}=${cookie!.value}` },
      });
      expect(await meStatus(replay), "the replayed cookie is refused").toBe(401);
      expect(await meStatus(agent.api), "the person's other session carries on").toBe(200);
    } finally {
      await replay?.dispose();
      await here.context.close();
      await agent.api.dispose();
    }
  });
});
