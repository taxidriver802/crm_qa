/**
 * The public host's headers, as a browser receives them from the frontend.
 * Step 1 of crm_backend/docs/EXPERIMENT_SAAS.md (prospects 1 and 2).
 *
 * Pages carry the frontend's frame and sniffing rules (next.config.mjs).
 * /api/* reaches the backend through Next's rewrite and must arrive with
 * helmet's headers intact: the sandbox on the public logo route is what keeps
 * a logo uploaded before raster-only from running script on this origin.
 *
 * Headers don't depend on the viewport, so this runs on desktop-1440 only.
 */

import { test, expect } from "../fixtures/test.ts";

function desktopOnly(name: string) {
  test.skip(name !== "desktop-1440", "Headers do not depend on the viewport; runs on desktop-1440");
}

test.describe("public host", () => {
  test("pages refuse to be framed and name their referrer policy", async ({ request, viewportInfo }) => {
    desktopOnly(viewportInfo.name);
    for (const path of ["/login", "/register"]) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(200);
      const headers = res.headers();
      expect(headers["content-security-policy"], path).toContain("frame-ancestors 'none'");
      expect(headers["content-security-policy"], path).toContain("object-src 'none'");
      expect(headers["x-frame-options"], path).toBe("DENY");
      expect(headers["x-content-type-options"], path).toBe("nosniff");
      expect(headers["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
    }
  });

  test("/api keeps the backend's headers through the rewrite, and health checks the database", async ({
    request,
    viewportInfo,
  }) => {
    desktopOnly(viewportInfo.name);
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, service: "crm-backend", database: "ok" });

    // helmet's rules, not the page rules: file previews frame /api/uploads
    // from the app's own pages, so /api keeps frame-ancestors 'self'.
    const headers = res.headers();
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'self'");
    expect(headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(headers["x-content-type-options"]).toBe("nosniff");
  });

  test("the public company logo is served sandboxed", async ({ request, viewportInfo }) => {
    desktopOnly(viewportInfo.name);
    const res = await request.get("/api/public/companies/rooftop/logo");
    expect(res.status()).toBe(200);
    const headers = res.headers();
    expect(headers["content-security-policy"]).toContain("sandbox");
    expect(headers["content-security-policy"]).toContain("default-src 'none'");
    expect(headers["x-content-type-options"]).toBe("nosniff");
  });
});
