/**
 * Help, the user guide, opened over the work.
 *
 * Desktop covers how a person opens it (account menu, reload, ⌘K, the
 * shortcuts dialog, a job's next step), that an agent does not receive an
 * owner-only article, and that a public client page has none of it.
 * Phone covers the same panel from the phone menu.
 */

import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures/test.ts";
import { collectPageErrors, expectNoCrash, waitForAppReady } from "../utils/app-ready.ts";
import { horizontalOverflow } from "../utils/stabilize.ts";
import { submitLoginForm } from "../utils/auth.ts";
import { qaEnv } from "../../config/env.ts";

async function openAccountHelp(page: Page) {
  await page.getByRole("button", { name: "Account and preferences" }).click();
  await page.getByRole("menuitem", { name: "Help" }).click();
}

test.describe("help — opening the guide", () => {
  test("the account menu opens Help on this page, and reload keeps the article", async ({
    page,
    viewportInfo,
  }) => {
    test.skip(viewportInfo.name !== "desktop-1440", "Help chrome is checked once, at desktop width");
    const { errors } = collectPageErrors(page);
    await page.goto("/dashboard");
    await waitForAppReady(page);
    const here = new URL(page.url()).pathname;

    await openAccountHelp(page);
    const help = page.getByRole("dialog", { name: "Help" });
    await expect(help).toBeVisible();
    await expect(help.getByRole("heading", { name: "Help" })).toBeVisible();
    await expect(page).toHaveURL(/[?&]help=contents/);
    expect(new URL(page.url()).pathname).toBe(here);

    await help.getByRole("button", { name: /Your first job/ }).click();
    await expect(help.getByRole("heading", { name: "Start here" })).toBeVisible();
    await expect(page).toHaveURL(/[?&]help=start-here/);
    expect(new URL(page.url()).pathname).toBe(here);

    await page.reload();
    await waitForAppReady(page);
    await expect(page.getByRole("dialog", { name: "Help" }).getByRole("heading", { name: "Start here" })).toBeVisible();
    await expect(page).toHaveURL(/[?&]help=start-here/);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("⌘K opens the article for the task you typed", async ({ page, viewportInfo }) => {
    test.skip(viewportInfo.name !== "desktop-1440", "Help chrome is checked once, at desktop width");
    await page.goto("/dashboard");
    await waitForAppReady(page);
    await page.keyboard.press("ControlOrMeta+k");
    const search = page.getByRole("textbox", { name: "Search workspace" });
    await expect(search).toBeVisible();
    await search.fill("record payment");
    await page.getByRole("button", { name: "Record a payment" }).click();
    const help = page.getByRole("dialog", { name: "Help" });
    await expect(help.getByRole("heading", { name: "Record a payment" })).toBeVisible();
    await expect(page).toHaveURL(/\/dashboard\?help=record-a-payment/);
    await expect(page.getByRole("textbox", { name: "Search workspace" })).toBeHidden();
  });

  test("? still opens shortcuts, and its guide line opens Help", async ({ page, viewportInfo }) => {
    test.skip(viewportInfo.name !== "desktop-1440", "Help chrome is checked once, at desktop width");
    await page.goto("/dashboard");
    await waitForAppReady(page);
    await page.keyboard.press("Shift+?");
    const shortcuts = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(shortcuts).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Help" })).toHaveCount(0);
    await shortcuts.getByRole("button", { name: "Help, the user guide" }).click();
    await expect(shortcuts).toBeHidden();
    await expect(page.getByRole("dialog", { name: "Help" })).toBeVisible();
    await expect(page).toHaveURL(/[?&]help=contents/);
  });

  test("a job's next step opens the article for that moment", async ({ page, viewportInfo, manifest }) => {
    test.skip(viewportInfo.name !== "desktop-1440", "Help chrome is checked once, at desktop width");
    const { errors } = collectPageErrors(page);
    await page.goto(`/jobs/${manifest.routeTokens.billingJobId}`);
    await waitForAppReady(page);
    const next = page.getByTestId("job-next-step");
    await expect(next).toContainText("Collect");
    await next.getByTestId("help-link").click();
    await expect(next.getByTestId("help-link")).toHaveAttribute("data-article", "record-a-payment");
    const help = page.getByRole("dialog", { name: "Help" });
    await expect(help.getByRole("heading", { name: "Record a payment" })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/jobs/${manifest.routeTokens.billingJobId}\\?help=record-a-payment`));
    await expectNoCrash(page);
    expect(errors, errors.join("\n")).toEqual([]);
  });
});

test.describe("help — who can see it", () => {
  test("an agent does not get an owner-only article", async ({ page, viewportInfo, browser }) => {
    test.skip(viewportInfo.name !== "desktop-1440", "Role check runs once");
    test.skip(!qaEnv.agentPassword, "QA_AGENT_PASSWORD is not configured, so no agent is seeded");

    const context = await browser.newContext({
      viewport: { width: viewportInfo.width, height: viewportInfo.height },
      storageState: undefined,
      serviceWorkers: "block",
    });
    const agent = await context.newPage();
    try {
      await agent.goto("/login");
      await submitLoginForm(agent, {
        email: qaEnv.agentEmail,
        password: qaEnv.agentPassword,
        slug: "rooftop",
      });
      await agent.waitForURL(/\/dashboard(\?.*)?$/, { timeout: 30_000 });
      await waitForAppReady(agent);

      await agent.goto("/dashboard?help=invite-a-teammate");
      await waitForAppReady(agent);
      const help = agent.getByRole("dialog", { name: "Help" });
      await expect(help.getByText("There is no help article by that name for your role.")).toBeVisible();

      await agent.keyboard.press("ControlOrMeta+k");
      await agent.getByRole("textbox", { name: "Search workspace" }).fill("invite teammate");
      await expect(agent.getByRole("button", { name: "Invite a teammate" })).toHaveCount(0);

      await agent.keyboard.press("Escape");
      await agent.getByRole("dialog", { name: "Help" }).getByRole("button", { name: "See all help" }).click();
      await expect(help.getByRole("button", { name: "Invite a teammate" })).toHaveCount(0);
      await expect(help.getByRole("button", { name: /Your first job/ })).toHaveCount(0);
      await expect(help.getByRole("button", { name: "Use Today" })).toBeVisible();
    } finally {
      await context.close();
    }

    // The owner's session still has the article.
    await page.goto("/dashboard?help=invite-a-teammate");
    await waitForAppReady(page);
    await expect(page.getByRole("dialog", { name: "Help" }).getByRole("heading", { name: "Invite a teammate" })).toBeVisible();
  });

  test("every article opens with its own title", async ({ page, viewportInfo, browser }) => {
    test.skip(viewportInfo.name !== "desktop-1440", "Article sweep runs once");
    test.skip(!qaEnv.agentPassword, "QA_AGENT_PASSWORD is not configured, so no agent is seeded");
    test.setTimeout(180_000);
    const { errors } = collectPageErrors(page);

    await page.goto("/dashboard");
    await waitForAppReady(page);
    const ownerList = await page.request.get("/api/help");
    expect(ownerList.ok()).toBeTruthy();
    const ownerArticles = (await ownerList.json()).articles as { id: string; title: string; roles?: string[] }[];
    expect(ownerArticles.length).toBeGreaterThan(20);
    for (const article of ownerArticles) {
      await page.goto(`/dashboard?help=${article.id}`);
      await expect(
        page.getByRole("dialog", { name: "Help" }).getByRole("heading", { name: article.title, exact: true }),
      ).toBeVisible();
    }

    const context = await browser.newContext({
      viewport: { width: viewportInfo.width, height: viewportInfo.height },
      storageState: undefined,
      serviceWorkers: "block",
    });
    const agent = await context.newPage();
    try {
      await agent.goto("/login");
      await submitLoginForm(agent, {
        email: qaEnv.agentEmail,
        password: qaEnv.agentPassword,
        slug: "rooftop",
      });
      await agent.waitForURL(/\/dashboard(\?.*)?$/, { timeout: 30_000 });
      const agentList = await agent.request.get("/api/help");
      expect(agentList.ok()).toBeTruthy();
      const agentArticles = (await agentList.json()).articles as { id: string; title: string }[];
      const agentIds = new Set(agentArticles.map((article) => article.id));
      expect(agentIds.has("invite-a-teammate")).toBe(false);
      expect(agentIds.has("start-here")).toBe(false);
      expect(agentIds.has("use-today")).toBe(true);
      for (const article of agentArticles) {
        await agent.goto(`/dashboard?help=${article.id}`);
        await expect(
          agent.getByRole("dialog", { name: "Help" }).getByRole("heading", { name: article.title, exact: true }),
        ).toBeVisible();
      }
    } finally {
      await context.close();
    }

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("a public client page does not show staff help", async ({ page, viewportInfo, manifest, freshContext }) => {
    test.skip(viewportInfo.name !== "desktop-1440", "Public check runs once");
    await page.goto("/dashboard");
    await waitForAppReady(page);
    const response = await page.request.post(`/api/portal/generate/${manifest.routeTokens.billingJobId}`);
    expect(response.ok(), await response.text()).toBeTruthy();
    const body = (await response.json()) as { token?: string };
    expect(body.token).toBeTruthy();

    const { page: client } = await freshContext();
    await client.goto(`/public/portal/${body.token}`);
    await waitForAppReady(client);
    await expect(client.getByTestId("portal-stage")).toBeVisible();
    await expect(client.getByTestId("help-panel")).toHaveCount(0);
    await expect(client.getByRole("button", { name: "Account and preferences" })).toHaveCount(0);
    await expect(client.getByRole("button", { name: "Open menu" })).toHaveCount(0);
  });
});

test.describe("help — phone", () => {
  test("the phone menu opens the same panel", async ({ page, viewportInfo }) => {
    test.skip(viewportInfo.name !== "phone-390", "Phone width only");
    const { errors } = collectPageErrors(page);
    await page.goto("/dashboard");
    await waitForAppReady(page);
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("dialog", { name: "Menu" }).getByRole("button", { name: "Help" }).click();
    const help = page.getByRole("dialog", { name: "Help" });
    await expect(help).toBeVisible();
    await expect(help.getByRole("heading", { name: "Help" })).toBeVisible();
    await help.getByRole("button", { name: "Use Today" }).click();
    await expect(help.getByRole("heading", { name: "Use Today" })).toBeVisible();
    await expect(page).toHaveURL(/[?&]help=use-today/);
    const box = await help.boundingBox();
    expect(box?.width ?? 0).toBeLessThanOrEqual(viewportInfo.width);
    expect(await horizontalOverflow(page), "help panel overflows the phone").toBe(0);
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
