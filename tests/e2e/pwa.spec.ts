/**
 * Staff PWA checks. Default Playwright blocks service workers; this file allows
 * them. Phone and desktop Chromium are enough — tablet/laptop projects skip.
 *
 * Real-device install, iOS cookies, and notched safe areas are manual:
 * docs/pwa-manual.md.
 */

import { test, expect } from "../fixtures/test.ts";
import type { Page } from "@playwright/test";

test.use({ serviceWorkers: "allow" });

function skipUnusedViewport(name: string) {
  test.skip(
    name !== "phone-390" && name !== "desktop-1440",
    "PWA checks run on phone-390 and desktop-1440",
  );
}

async function waitForController(page: Page) {
  await expect
    .poll(async () =>
      page.evaluate(() => Boolean(navigator.serviceWorker?.controller)),
    )
    .toBe(true);
}

test.describe("PWA", () => {
  test("manifest is installable without a portrait lock", async ({
    page,
    viewportInfo,
  }) => {
    skipUnusedViewport(viewportInfo.name);

    const response = await page.request.get("/manifest.webmanifest");
    expect(response.ok()).toBeTruthy();
    const manifest = await response.json();

    expect(manifest.scope).toBe("/");
    expect(manifest.id).toBe("/");
    expect(manifest.orientation).toBeUndefined();
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          src: "/icons/icon-192.png",
          sizes: "192x192",
          type: "image/png",
          purpose: "any",
        }),
        expect.objectContaining({
          src: "/icons/icon-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "any",
        }),
        expect.objectContaining({
          src: "/icons/icon-512-maskable.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable",
        }),
      ]),
    );

    for (const href of [
      "/icons/icon-192.png",
      "/icons/icon-512.png",
      "/icons/icon-512-maskable.png",
      "/icons/apple-touch-icon.png",
    ]) {
      const icon = await page.request.get(href);
      expect(icon.ok(), href).toBeTruthy();
      expect(icon.headers()["content-type"] || "").toContain("image/png");
    }
  });

  test("service worker registers on login", async ({
    browser,
    viewportInfo,
  }) => {
    skipUnusedViewport(viewportInfo.name);

    const context = await browser.newContext({ serviceWorkers: "allow" });
    const page = await context.newPage();
    try {
      await page.goto("/login");
      await expect
        .poll(async () =>
          page.evaluate(async () => {
            const registration =
              await navigator.serviceWorker.getRegistration();
            return Boolean(registration?.active);
          }),
        )
        .toBe(true);
    } finally {
      await context.close();
    }
  });

  test("service worker registers on the dashboard and does not cache api or public responses", async ({
    page,
    viewportInfo,
  }) => {
    skipUnusedViewport(viewportInfo.name);

    await page.goto("/dashboard");
    await waitForController(page);

    await page.evaluate(async () => {
      await fetch("/public/intake/pwa-cache-probe", { credentials: "omit" });
      await fetch("/api/auth/me", { credentials: "include" });
      const names = await caches.keys();
      for (const name of names) {
        const cache = await caches.open(name);
        const keys = await cache.keys();
        for (const request of keys) {
          const path = new URL(request.url).pathname;
          if (
            path.startsWith("/api") ||
            path.startsWith("/uploads") ||
            path.startsWith("/public")
          ) {
            throw new Error(`unexpected cache entry ${path}`);
          }
        }
      }
    });
  });

  test("offline reload shows the branded shell", async ({
    page,
    viewportInfo,
  }) => {
    skipUnusedViewport(viewportInfo.name);

    await page.goto("/dashboard");
    await waitForController(page);
    await page.context().setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "Can't reach the CRM" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  });
});
