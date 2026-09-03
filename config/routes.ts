/**
 * The single source of truth for CRM routes under test.
 *
 * Enumerated from crm_frontend/src/app (Next.js App Router) rather than
 * assumed. No test file should contain a hard-coded URL - import from here.
 *
 * Tier 1 routes have tests today. Tier 2 routes are catalogued so later phases
 * can widen coverage without another discovery pass.
 */

import type { ViewportName } from "./viewports.ts";

export type RouteKind =
  | "dashboard"
  | "list"
  | "detail"
  | "form"
  | "calendar-kanban"
  | "settings-admin"
  | "auth"
  | "public"
  | "other";

/** Which application shell wraps the route. */
export type RouteShell = "app" | "auth" | "public" | "none";

export interface QaRoute {
  /** Stable identifier, also used in artifact filenames. */
  id: string;
  /**
   * URL path. `{token}` placeholders are resolved from the seed manifest by
   * resolveRoutePath().
   */
  path: string;
  label: string;
  kind: RouteKind;
  tier: 1 | 2;
  shell: RouteShell;
  authRequired: boolean;
  /** Exact <h1> text AppShell renders, where it is static. */
  heading?: string;
  /** Roles that can reach the route. Empty means any authenticated role. */
  requiresRole?: readonly string[];
  /** Source file, for traceability back to the app. */
  source: string;
  notes?: string;
}

/**
 * Tier 1 - covered by the Phase 2 smoke suite.
 *
 * Chosen for breadth of layout archetype rather than count: a dashboard, three
 * list pages, two detail pages, a form, an admin page and the login form
 * between them exercise every distinct shell and table treatment in the app.
 */
export const TIER_1_ROUTES: readonly QaRoute[] = Object.freeze([
  {
    id: "login",
    path: "/login",
    label: "Login",
    kind: "auth",
    tier: 1,
    shell: "auth",
    authRequired: false,
    source: "src/app/login/page.js",
  },
  {
    id: "dashboard",
    path: "/dashboard",
    label: "Dashboard",
    kind: "dashboard",
    tier: 1,
    shell: "app",
    authRequired: true,
    heading: "Dashboard",
    source: "src/app/dashboard/page.js",
  },
  {
    id: "leads",
    path: "/leads",
    label: "Leads",
    kind: "list",
    tier: 1,
    shell: "app",
    authRequired: true,
    heading: "Leads",
    source: "src/app/leads/page.js",
    notes: "Also hosts the kanban board via the leads:view-mode toggle.",
  },
  {
    id: "lead-detail",
    path: "/leads/{leadId}",
    label: "Lead detail",
    kind: "detail",
    tier: 1,
    shell: "app",
    authRequired: true,
    source: "src/app/leads/[id]/page.js",
  },
  {
    id: "lead-new",
    path: "/leads/new",
    label: "New lead",
    kind: "form",
    tier: 1,
    shell: "app",
    authRequired: true,
    source: "src/app/leads/new/page.js",
  },
  {
    id: "jobs",
    path: "/jobs",
    label: "Jobs",
    kind: "list",
    tier: 1,
    shell: "app",
    authRequired: true,
    heading: "Jobs",
    source: "src/app/jobs/page.js",
  },
  {
    id: "job-detail",
    path: "/jobs/{jobId}",
    label: "Job detail",
    kind: "detail",
    tier: 1,
    shell: "app",
    authRequired: true,
    source: "src/app/jobs/[id]/page.js",
    notes: "Richest page in the app: estimates, invoices, measurements, tasks, files, activity.",
  },
  {
    id: "tasks",
    path: "/tasks",
    label: "Tasks",
    kind: "list",
    tier: 1,
    shell: "app",
    authRequired: true,
    heading: "Tasks",
    source: "src/app/tasks/page.js",
    notes: "Also hosts the calendar via the tasks:view-mode toggle.",
  },
  {
    id: "invoices",
    path: "/invoices",
    label: "Invoices",
    kind: "list",
    tier: 1,
    shell: "app",
    authRequired: true,
    heading: "Invoices",
    source: "src/app/invoices/page.js",
  },
  {
    id: "files",
    path: "/files",
    label: "Files",
    kind: "list",
    tier: 1,
    shell: "app",
    authRequired: true,
    heading: "Files",
    source: "src/app/files/page.js",
  },
  {
    id: "users",
    path: "/users",
    label: "Users",
    kind: "settings-admin",
    tier: 1,
    shell: "app",
    authRequired: true,
    heading: "Users",
    requiresRole: ["owner", "admin"],
    source: "src/app/users/page.js",
  },
]);

/**
 * Tier 2 - catalogued, not yet tested. Phases 3-6 draw from this list.
 */
export const TIER_2_ROUTES: readonly QaRoute[] = Object.freeze([
  { id: "root", path: "/", label: "Root redirect", kind: "other", tier: 2, shell: "none", authRequired: false, source: "src/app/page.js" },
  { id: "accept-invite", path: "/accept-invite", label: "Accept invite", kind: "auth", tier: 2, shell: "auth", authRequired: false, source: "src/app/accept-invite/page.js", notes: "Requires a ?token= query param." },
  { id: "lead-edit", path: "/leads/{leadId}/edit", label: "Edit lead", kind: "form", tier: 2, shell: "app", authRequired: true, source: "src/app/leads/[id]/edit/page.js" },
  { id: "job-new", path: "/jobs/new", label: "New job", kind: "form", tier: 2, shell: "app", authRequired: true, source: "src/app/jobs/new/page.js" },
  { id: "job-edit", path: "/jobs/{jobId}/edit", label: "Edit job", kind: "form", tier: 2, shell: "app", authRequired: true, source: "src/app/jobs/[id]/edit/page.js" },
  { id: "task-detail", path: "/tasks/{taskId}", label: "Task detail", kind: "detail", tier: 2, shell: "app", authRequired: true, source: "src/app/tasks/[id]/page.js" },
  { id: "task-new", path: "/tasks/new", label: "New task", kind: "form", tier: 2, shell: "app", authRequired: true, source: "src/app/tasks/new/page.js" },
  { id: "task-edit", path: "/tasks/{taskId}/edit", label: "Edit task", kind: "form", tier: 2, shell: "app", authRequired: true, source: "src/app/tasks/[id]/edit/page.js" },
  { id: "invoice-detail", path: "/invoices/{invoiceId}", label: "Invoice detail", kind: "detail", tier: 2, shell: "app", authRequired: true, source: "src/app/invoices/[id]/page.js" },
  { id: "invoice-new", path: "/invoices/new", label: "New invoice", kind: "form", tier: 2, shell: "app", authRequired: true, source: "src/app/invoices/new/page.js" },
  { id: "estimate-detail", path: "/estimates/{estimateId}", label: "Estimate detail", kind: "detail", tier: 2, shell: "app", authRequired: true, source: "src/app/estimates/[id]/page.js" },
  { id: "estimate-new", path: "/estimates/new", label: "New estimate", kind: "form", tier: 2, shell: "app", authRequired: true, source: "src/app/estimates/new/page.js" },
  { id: "estimate-edit", path: "/estimates/{estimateId}/edit", label: "Edit estimate", kind: "form", tier: 2, shell: "app", authRequired: true, source: "src/app/estimates/[id]/edit/page.js" },
  { id: "reports", path: "/reports", label: "Reports", kind: "dashboard", tier: 2, shell: "app", authRequired: true, source: "src/app/reports/page.js" },
  { id: "reports-product", path: "/reports/product", label: "Product metrics", kind: "dashboard", tier: 2, shell: "app", authRequired: true, requiresRole: ["owner", "admin"], source: "src/app/reports/product/page.js" },
  { id: "automation", path: "/automation", label: "Automation", kind: "settings-admin", tier: 2, shell: "app", authRequired: true, requiresRole: ["owner", "admin"], source: "src/app/automation/page.js" },
  { id: "integrations", path: "/integrations", label: "Integrations", kind: "settings-admin", tier: 2, shell: "app", authRequired: true, source: "src/app/integrations/page.js" },
  { id: "integrations-abc", path: "/integrations/abc", label: "ABC Supply", kind: "settings-admin", tier: 2, shell: "app", authRequired: true, source: "src/app/integrations/abc/page.js" },
  { id: "integrations-quickbooks", path: "/integrations/quickbooks", label: "QuickBooks", kind: "settings-admin", tier: 2, shell: "app", authRequired: true, source: "src/app/integrations/quickbooks/page.js" },
  { id: "public-portal", path: "/public/portal/{portalToken}", label: "Customer portal", kind: "public", tier: 2, shell: "public", authRequired: false, source: "src/app/public/portal/[token]/page.js" },
  { id: "public-estimate", path: "/public/estimate/{estimateToken}", label: "Public estimate", kind: "public", tier: 2, shell: "public", authRequired: false, source: "src/app/public/estimate/[token]/page.js" },
]);

export const ALL_ROUTES: readonly QaRoute[] = Object.freeze([
  ...TIER_1_ROUTES,
  ...TIER_2_ROUTES,
]);

export function getRoute(id: string): QaRoute {
  const found = ALL_ROUTES.find((route) => route.id === id);
  if (!found) throw new Error(`Unknown route id: ${id}`);
  return found;
}

/** Tier 1 routes that require an authenticated session. */
export const TIER_1_AUTHENTICATED = TIER_1_ROUTES.filter((route) => route.authRequired);

/**
 * Substitutes `{token}` placeholders using ids captured by the seed.
 * Throws rather than producing a URL containing a literal brace, so a missing
 * manifest entry fails loudly instead of hitting a 404 that looks like a bug.
 */
export function resolveRoutePath(
  route: QaRoute,
  tokens: Record<string, string | number>,
): string {
  return route.path.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = tokens[key];
    if (value === undefined || value === null || value === "") {
      throw new Error(
        `Route "${route.id}" needs token "${key}" but the seed manifest did not provide it.`,
      );
    }
    return String(value);
  });
}

/** Viewports each Tier 1 route is exercised at during the smoke suite. */
export function smokeViewportsFor(_route: QaRoute): readonly ViewportName[] {
  return ["desktop-1440", "laptop-1280", "tablet-768", "phone-390"];
}
