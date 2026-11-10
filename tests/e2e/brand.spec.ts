/**
 * Joist and the company: two brands that never compete.
 *
 * Joist (the product) owns the tab icon, the installed app, signed-out
 * screens, the offline page and error screens with no company on them. The
 * company owns everything once it is known: the rail, the signed-in title,
 * sign-in after its slug resolves, and its customer pages, where Joist is one
 * muted "Powered by Joist" line.
 *
 * Source-level guarantees (one drawing, generated copies in sync, the same
 * initials in the app and the email, palette contrast) are in
 * scripts/brand-check.ts. The invite email's attribution is covered by
 * crm_backend test/brand.test.ts; QA sends no mail.
 *
 * Most checks are the same at every width, so they run on desktop-1440 and
 * phone-390 only.
 */

import { request as playwrightRequest } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";
import { test, expect } from "../fixtures/test.ts";
import { qaEnv } from "../../config/env.ts";
import { OWNER, submitLoginForm } from "../utils/auth.ts";
import { waitForAppReady } from "../utils/app-ready.ts";

const TILE = [0x36, 0x3a, 0x43];
const ROOFTOP_LOGO = "/public/companies/rooftop/logo";

function onlyMainViewports(name: string) {
  test.skip(name !== "desktop-1440" && name !== "phone-390", "brand checks run on desktop-1440 and phone-390");
}

/** A company made through the real register endpoint, in its own cookie jar. */
async function registerCompany(
  name: string,
  slug: string,
  palette_id?: string,
): Promise<{ api: APIRequestContext; email: string; password: string; slug: string }> {
  const api = await playwrightRequest.newContext({ baseURL: qaEnv.baseUrl });
  const email = `${slug}@brand.qa`;
  const password = "Brandpass1!";
  const res = await api.post("/api/auth/register", {
    data: { first_name: "Brand", last_name: "Owner", email, password, company_name: name, slug, palette_id },
  });
  expect(res.status(), await res.text()).toBe(201);
  return { api, email, password, slug };
}

function uniqueSlug(prefix: string, viewport: string) {
  return `${prefix}-${viewport.replace(/[^a-z0-9]/g, "")}-${Date.now().toString(36)}`;
}

async function authBrand(page: Page) {
  return page.locator("[data-auth-brand]").getAttribute("data-auth-brand");
}

test.describe("Joist brand", () => {
  test("the tab, the installed app and the head tags are Joist", async ({ freshContext, viewportInfo }) => {
    onlyMainViewports(viewportInfo.name);
    const { page } = await freshContext();
    await page.goto("/login");
    await expect(page).toHaveTitle("Joist");

    const icons = await page.evaluate(() =>
      [...document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]')].map((l) => ({
        rel: l.getAttribute("rel"),
        href: (l.getAttribute("href") || "").split("?")[0],
        type: l.getAttribute("type"),
        sizes: l.getAttribute("sizes"),
      })),
    );
    expect(icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rel: "icon", href: "/icon.svg", type: "image/svg+xml" }),
        expect.objectContaining({ rel: "icon", href: "/favicon.ico" }),
        expect.objectContaining({ rel: "apple-touch-icon", href: "/apple-icon.png", sizes: "180x180" }),
      ]),
    );
    expect(icons).toHaveLength(3);

    const svg = await (await page.request.get("/icon.svg")).text();
    expect(svg).toContain('class="joist-flange"');

    // The Next.js starter favicon was a single black triangle frame; this is
    // three PNG frames of the mark.
    const ico = Buffer.from(await (await page.request.get("/favicon.ico")).body());
    expect(ico.readUInt16LE(4)).toBe(3);

    const manifest = await (await page.request.get("/manifest.webmanifest")).json();
    expect(manifest.name).toBe("Joist");
    expect(manifest.short_name).toBe("Joist");
    expect(manifest.description).toBe("The job, from first contact to paid.");
    expect(JSON.stringify(manifest)).not.toMatch(/Rooftop|Buy & Sell|Gutters/);

    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute("content", "Joist");
  });

  test("generated icons have their sizes, and the maskable mark stays in the safe circle", async ({
    freshContext,
    viewportInfo,
  }) => {
    onlyMainViewports(viewportInfo.name);
    const { page } = await freshContext();
    await page.goto("/offline.html");

    const result = await page.evaluate(async (tile) => {
      async function load(src: string) {
        const img = new Image();
        img.src = src;
        await img.decode();
        return img;
      }
      function pixels(img: HTMLImageElement, size: number) {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, size, size);
        return ctx.getImageData(0, 0, size, size).data;
      }
      const sizes: Record<string, number[]> = {};
      for (const src of ["/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-512-maskable.png", "/apple-icon.png"]) {
        const img = await load(src);
        sizes[src] = [img.naturalWidth, img.naturalHeight];
      }

      // Android masks to a circle of radius 40%: outside it, only tile.
      const maskable = pixels(await load("/icons/icon-512-maskable.png"), 512);
      let outside = 0;
      let glyphInside = 0;
      for (let y = 0; y < 512; y += 1) {
        for (let x = 0; x < 512; x += 1) {
          const i = (y * 512 + x) * 4;
          const isTile =
            Math.abs(maskable[i] - tile[0]) < 6 &&
            Math.abs(maskable[i + 1] - tile[1]) < 6 &&
            Math.abs(maskable[i + 2] - tile[2]) < 6;
          const r = Math.hypot(x + 0.5 - 256, y + 0.5 - 256);
          if (r > 0.4 * 512 && !isTile) outside += 1;
          if (r <= 0.4 * 512 && !isTile) glyphInside += 1;
        }
      }

      // At 16px the mark still has its orange flange and its light web.
      const tiny = pixels(await load("/icon.svg"), 16);
      let orange = 0;
      let light = 0;
      for (let i = 0; i < tiny.length; i += 4) {
        if (tiny[i] > 230 && tiny[i + 1] > 90 && tiny[i + 1] < 130 && tiny[i + 2] < 50) orange += 1;
        if (tiny[i] > 230 && tiny[i + 1] > 230 && tiny[i + 2] > 230) light += 1;
      }
      return { sizes, outside, glyphInside, orange, light };
    }, TILE);

    expect(result.sizes).toEqual({
      "/icons/icon-192.png": [192, 192],
      "/icons/icon-512.png": [512, 512],
      "/icons/icon-512-maskable.png": [512, 512],
      "/apple-icon.png": [180, 180],
    });
    expect(result.outside, "pixels of the mark outside the maskable safe circle").toBe(0);
    expect(result.glyphInside).toBeGreaterThan(10_000);
    expect(result.orange, "orange flange pixels at 16px").toBeGreaterThanOrEqual(12);
    expect(result.light, "light web pixels at 16px").toBeGreaterThanOrEqual(12);
  });

  test("sign-in shows Joist until a company is known, then only that company", async ({
    freshContext,
    viewportInfo,
  }) => {
    onlyMainViewports(viewportInfo.name);
    const other = await registerCompany("The Gutter Guys LLC", uniqueSlug("gutter-guys", viewportInfo.name), "violet");
    const { page } = await freshContext();
    await page.goto("/login");
    await waitForAppReady(page);

    // No company: the lockup, mark beside the word, at 24px or more.
    await expect.poll(() => authBrand(page)).toBe("joist");
    const lockup = page.locator('[data-auth-brand] [data-brand="joist"]');
    await expect(lockup).toHaveText("Joist");
    const mark = lockup.locator('[data-brand-mark="joist"]');
    const box = await mark.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(24);
    expect(box!.height).toBe(box!.width);

    // Rooftop Realty: its own logo, which actually loads.
    await page.getByLabel("Company slug").fill("rooftop");
    await expect.poll(() => authBrand(page)).toBe("company");
    const logo = page.locator('[data-auth-brand] img[data-company-mark="logo"]');
    await expect(logo).toHaveAttribute("src", new RegExp(`${ROOFTOP_LOGO}$`));
    await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(512);
    await expect(page.locator('[data-auth-brand] [data-brand="joist"]')).toHaveCount(0);
    await expect(page.locator("[data-auth-brand]")).toContainText("Rooftop Realty");

    // Another company: its own initials, and nothing of Rooftop's on screen.
    await page.getByLabel("Company slug").fill(other.slug);
    await expect(page.locator(`img[src$="${ROOFTOP_LOGO}"]`)).toHaveCount(0);
    const tile = page.locator('[data-auth-brand] [data-company-mark="monogram"]');
    await expect(tile).toHaveAttribute("data-monogram", "GG");
    await expect(page.locator("[data-auth-brand]")).toContainText("The Gutter Guys LLC");

    // And back: the logo returns and the initials leave.
    await page.getByLabel("Company slug").fill("rooftop");
    await expect(logo).toBeVisible();
    await expect(page.locator('[data-company-mark="monogram"]')).toHaveCount(0);

    // A slug that names no company falls back to Joist.
    await page.getByLabel("Company slug").fill(`${other.slug}-nope`);
    await expect(page.getByText("Unknown company")).toBeVisible();
    await expect.poll(() => authBrand(page)).toBe("joist");
    await other.api.dispose();
  });

  test("a remembered company appears without Joist flashing first", async ({ freshContext, viewportInfo }) => {
    onlyMainViewports(viewportInfo.name);
    const { page } = await freshContext();
    await page.addInitScript(() => {
      window.localStorage.setItem("crm-company-slug", "rooftop");
      const seen: string[] = [];
      (window as unknown as { __brands: string[] }).__brands = seen;
      const record = () => {
        const value = document.querySelector("[data-auth-brand]")?.getAttribute("data-auth-brand");
        if (value && seen[seen.length - 1] !== value) seen.push(value);
      };
      new MutationObserver(record).observe(document, { subtree: true, childList: true, attributes: true });
      document.addEventListener("DOMContentLoaded", record);
    });

    // The server's HTML holds a quiet tile, not Joist.
    const html = await (await page.request.get("/login")).text();
    expect(html).toContain('data-auth-brand="pending"');

    await page.goto("/login");
    await expect.poll(() => authBrand(page)).toBe("company");
    await expect(page.locator(`[data-auth-brand] img[src$="${ROOFTOP_LOGO}"]`)).toBeVisible();
    const seen = await page.evaluate(() => (window as unknown as { __brands: string[] }).__brands);
    expect(seen).not.toContain("joist");
    expect(seen[seen.length - 1]).toBe("company");
  });

  test("register is Joist's and does not wear a remembered company's palette", async ({
    freshContext,
    viewportInfo,
  }) => {
    onlyMainViewports(viewportInfo.name);
    const { page } = await freshContext();
    await page.addInitScript(() => {
      window.localStorage.setItem("crm-company-slug", "rooftop");
      window.localStorage.setItem("crm-company-palette", "violet");
      window.localStorage.removeItem("crm-palette");
    });
    await page.goto("/register");
    await waitForAppReady(page);
    await expect.poll(() => authBrand(page)).toBe("joist");
    await expect(page.locator("html")).toHaveAttribute("data-palette", "rooftop");

    await page.getByLabel("Company name").fill("Summit Exteriors Corp");
    await page.getByRole("button", { name: "Choose a company mark" }).click();
    const initials = page.getByRole("radio", { name: "Initials" });
    await expect(initials).toBeChecked();
    await expect(initials.locator('[data-company-mark="monogram"]')).toHaveAttribute("data-monogram", "SE");
  });

  test("the staff shell is Rooftop's: its logo, its title, no Joist", async ({ page, viewportInfo }) => {
    onlyMainViewports(viewportInfo.name);
    await page.goto("/dashboard");
    await waitForAppReady(page);

    const where = viewportInfo.navigation === "sidebar" ? ".rail-brand" : ".topbar-brand";
    await expect(page.locator(`${where} img[data-company-mark="logo"]`)).toHaveAttribute(
      "src",
      new RegExp(`${ROOFTOP_LOGO}$`),
    );
    await expect(page).toHaveTitle("Rooftop Realty CRM");
    await expect(page.locator('[data-brand="powered-by"]')).toHaveCount(0);
    await expect(page.locator('[data-brand-mark="joist"]')).toHaveCount(0);
  });

  test("a new company shows its own initials in its own accent, and switching back shows Rooftop's", async ({
    browser,
    viewportInfo,
  }) => {
    onlyMainViewports(viewportInfo.name);
    const slug = uniqueSlug("gutter-guys", viewportInfo.name);
    const made = await registerCompany("The Gutter Guys LLC", slug, "violet");
    await made.api.dispose();

    // A plain, signed-out context with no pinned personal palette, so the
    // company's palette is the active one and theme-color can follow it.
    // (Without storageState: undefined it would inherit the owner session.)
    const context = await browser.newContext({
      baseURL: qaEnv.baseUrl,
      storageState: undefined,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    try {
      await page.goto("/login");
      await submitLoginForm(page, { email: made.email, password: made.password, slug });
      await page.waitForURL(/\/dashboard/);
      await waitForAppReady(page);

      const where = viewportInfo.navigation === "sidebar" ? ".rail-brand" : ".topbar-brand";
      const tile = page.locator(`${where} [data-company-mark="monogram"]`);
      await expect(tile).toHaveAttribute("data-monogram", "GG");
      await expect(page).toHaveTitle("The Gutter Guys LLC CRM");
      await expect(page.locator(`img[src$="${ROOFTOP_LOGO}"]`)).toHaveCount(0);
      await expect(page.locator('[data-brand-mark="joist"]')).toHaveCount(0);

      await expect(page.locator("html")).toHaveAttribute("data-palette", "violet");
      const colours = await page.evaluate((selector) => {
        const el = document.querySelector(selector) as HTMLElement;
        const root = getComputedStyle(document.documentElement);
        const probe = document.createElement("span");
        document.body.append(probe);
        const toRgb = (value: string) => {
          probe.style.color = value;
          return getComputedStyle(probe).color;
        };
        const out = {
          tileBg: getComputedStyle(el).backgroundColor,
          tileInk: getComputedStyle(el).color,
          accent: toRgb(root.getPropertyValue("--accent").trim()),
          onAccent: toRgb(root.getPropertyValue("--on-accent").trim()),
          bg: toRgb(root.getPropertyValue("--bg").trim()),
          themeColor: toRgb(document.querySelector('meta[name="theme-color"]')?.getAttribute("content") || ""),
        };
        probe.remove();
        return out;
      }, `${where} [data-company-mark="monogram"]`);
      expect(colours.tileBg).toBe(colours.accent);
      expect(colours.tileInk).toBe(colours.onAccent);
      expect(colours.themeColor, "theme-color follows the company's palette").toBe(colours.bg);

      // Same browser, back to Rooftop Realty: nothing of the last company stays.
      await page.request.post("/api/auth/logout");
      await page.goto("/login");
      await waitForAppReady(page);
      await expect(page.locator('[data-auth-brand] [data-company-mark="monogram"]')).toHaveAttribute(
        "data-monogram",
        "GG",
      );
      await submitLoginForm(page, OWNER);
      await page.waitForURL(/\/dashboard/);
      await waitForAppReady(page);
      await expect(page.locator(`${where} img[data-company-mark="logo"]`)).toHaveAttribute(
        "src",
        new RegExp(`${ROOFTOP_LOGO}$`),
      );
      await expect(page.locator('[data-company-mark="monogram"]')).toHaveCount(0);
      await expect(page).toHaveTitle("Rooftop Realty CRM");
      await expect(page.locator("html")).toHaveAttribute("data-palette", "rooftop");
    } finally {
      await context.close();
    }
  });

  test("a customer page carries the company and one muted Powered by Joist line", async ({
    page,
    freshContext,
    manifest,
    viewportInfo,
  }) => {
    onlyMainViewports(viewportInfo.name);
    const minted = await page.request.post(`/api/portal/generate/${manifest.jobs["webb-reroof"]}`);
    expect(minted.ok()).toBeTruthy();
    const { token } = await minted.json();

    const { page: client } = await freshContext();
    await client.goto(`/public/portal/${token}`);
    await waitForAppReady(client);
    await expect(client.locator("[data-public-brand]")).toHaveAttribute("data-public-brand", "company");
    await expect(client.locator(`header img[src$="${ROOFTOP_LOGO}"]`)).toBeVisible();
    const line = client.locator('[data-brand="powered-by"]');
    await expect(line).toHaveCount(1);
    await expect(line).toHaveText("Powered by Joist");
    await expect(line.locator("a")).toHaveCount(0);
    const soft = await client.evaluate(() => {
      const probe = document.createElement("span");
      probe.style.color = getComputedStyle(document.documentElement).getPropertyValue("--text-soft").trim();
      document.body.append(probe);
      const value = getComputedStyle(probe).color;
      probe.remove();
      return value;
    });
    await expect(line).toHaveCSS("color", soft);
    await expect(client.locator('[data-brand-mark="joist"]')).toHaveCount(0);

    // A dead link has no company to show: Joist, and no attribution line.
    await client.goto("/public/portal/not-a-real-token");
    await waitForAppReady(client);
    await expect(client.locator("[data-public-brand]")).toHaveAttribute("data-public-brand", "joist");
    await expect(client.locator('[data-brand="powered-by"]')).toHaveCount(0);
  });

  test("while the company loads, its mark is a quiet tile and nothing else", async ({
    page,
    freshContext,
    manifest,
    viewportInfo,
  }) => {
    onlyMainViewports(viewportInfo.name);
    const { token } = await (
      await page.request.post(`/api/portal/generate/${manifest.jobs["webb-reroof"]}`)
    ).json();

    const { page: client } = await freshContext();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await client.route("**/api/public/portal/**", async (route) => {
      await held;
      await route.continue();
    });
    await client.goto(`/public/portal/${token}`);
    const brand = client.locator("[data-public-brand]");
    await expect(brand).toHaveAttribute("data-public-brand", "pending");
    await expect(client.locator('[data-company-mark="pending"]')).toBeVisible();
    await expect(client.locator('[data-brand-mark="joist"]')).toHaveCount(0);
    await expect(client.locator(`img[src$="${ROOFTOP_LOGO}"]`)).toHaveCount(0);
    release();
    await expect(brand).toHaveAttribute("data-public-brand", "company");
  });

  test("404: Joist when no company is on screen, nothing extra inside the shell", async ({
    page,
    freshContext,
    viewportInfo,
  }) => {
    onlyMainViewports(viewportInfo.name);
    const { page: visitor } = await freshContext();
    const response = await visitor.goto("/public/no-such-page");
    expect(response?.status()).toBe(404);
    await expect(visitor.locator("[data-status-brand]")).toHaveAttribute("data-status-brand", "joist");
    await expect(visitor.locator('[data-brand="joist"]')).toHaveText("Joist");
    await expect(visitor.getByRole("heading", { name: "This page doesn’t exist" })).toBeVisible();

    await page.goto("/no-such-page");
    await waitForAppReady(page);
    await expect(page.getByRole("heading", { name: "This page doesn’t exist" })).toBeVisible();
    await expect(page.locator("[data-status-brand]")).toHaveAttribute("data-status-brand", "company");
    await expect(page.locator('[data-brand="joist"]')).toHaveCount(0);
    const where = viewportInfo.navigation === "sidebar" ? ".rail-brand" : ".topbar-brand";
    await expect(page.locator(`${where} img[data-company-mark="logo"]`)).toBeVisible();
  });

  test("the orange palette is Ember, its rooftop id still resolves, the others are unchanged", async ({
    page,
    freshContext,
    viewportInfo,
  }) => {
    onlyMainViewports(viewportInfo.name);
    // PINNED_LOCAL_STORAGE stores crm-palette=rooftop, as saved preferences do.
    await page.goto("/settings?tab=workspace");
    await waitForAppReady(page);
    await expect(page.locator("html")).toHaveAttribute("data-palette", "rooftop");
    await expect(page.getByTestId("settings-workspace")).toContainText("Palette: Ember");

    const accents = await page.evaluate(() => {
      const out: Record<string, string> = {};
      for (const id of ["rooftop", "azure", "slate"]) {
        const el = document.createElement("div");
        el.setAttribute("data-palette", id);
        document.body.append(el);
        out[id] = getComputedStyle(el).getPropertyValue("--accent").trim();
        el.remove();
      }
      return out;
    });
    expect(accents).toEqual({ rooftop: "#f97316", azure: "#2563eb", slate: "#0f766e" });

    // The picker people see lists Ember and never Rooftop.
    const { page: visitor } = await freshContext();
    await visitor.goto("/login");
    await waitForAppReady(visitor);
    await visitor.getByRole("button", { name: "Color palettes" }).click();
    const group = visitor.getByRole("radiogroup", { name: "Color palette" });
    await expect(group.getByRole("radio", { name: /Ember/ })).toBeVisible();
    await expect(group.getByRole("radio", { name: /Azure/ })).toBeVisible();
    await expect(group.getByRole("radio", { name: /Slate/ })).toBeVisible();
    await expect(group.getByRole("radio", { name: /Rooftop/ })).toHaveCount(0);
  });
});
