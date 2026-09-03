/**
 * Fixed constants that make QA runs deterministic.
 *
 * Nothing in this file may depend on the current date, a random source, or
 * machine state. These values are the contract that keeps seeded data - and
 * therefore rendered dates, totals and ordering - byte-identical across runs.
 */

/**
 * The anchor every seeded timestamp is offset from.
 *
 * Because this is a fixed absolute instant rather than "now", every absolute
 * date the UI renders is stable forever. This is the primary determinism
 * mechanism for visual regression in Phase 4.
 */
export const QA_SEED_ANCHOR = new Date("2026-03-02T09:00:00.000Z");

/**
 * The instant the browser clock is pinned to during tests.
 *
 * Deliberately offset a few hours past the anchor so "today", "overdue" and
 * "due soon" all resolve consistently against the fixed seed data. This is a
 * supporting consistency device, not the primary determinism mechanism:
 * relative-time UI cannot be stabilised by fixed data alone.
 */
export const QA_NOW = new Date("2026-03-16T15:00:00.000Z");

/** Returns a fixed instant offset from the seed anchor, in whole days. */
export function anchorPlusDays(days: number, hour = 9): Date {
  const date = new Date(QA_SEED_ANCHOR);
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(hour, 0, 0, 0);
  return date;
}

/** Same as {@link anchorPlusDays} but relative to the pinned "now". */
export function nowPlusDays(days: number, hour = 12): Date {
  const date = new Date(QA_NOW);
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(hour, 0, 0, 0);
  return date;
}

/**
 * localStorage values pinned before every test.
 *
 * The app persists theme, palette, sidebar and list-view-mode choices in
 * localStorage. Left unset, a run would inherit whatever the previous run or
 * the browser default produced. Pinning them makes the starting UI state an
 * explicit input rather than ambient state.
 *
 * Keys verified against:
 *   crm_frontend/src/theme/registry.js        -> "crm-palette"
 *   crm_frontend/src/components/app-shell.js  -> "crm-desktop-sidebar"
 *   crm_frontend/src/app/leads/page.js        -> "leads:view-mode"
 *   crm_frontend/src/app/tasks/page.js        -> "tasks:view-mode"
 *   next-themes default storage key           -> "theme"
 */
export const PINNED_LOCAL_STORAGE: Record<string, string> = {
  theme: "light",
  "crm-palette": "rooftop",
  "crm-desktop-sidebar": "1",
  "leads:view-mode": "list",
  "tasks:view-mode": "list",
};

/** The auth cookie set by the backend on successful login. */
export const AUTH_COOKIE_NAME = "access_token";

/**
 * Database names the harness must never touch, at any cost.
 * Enforced by assertSafeQaTarget() in db/admin.ts.
 */
export const PROTECTED_DATABASES = Object.freeze([
  "crm_dev",
  "postgres",
  "overnight_dev",
  "template0",
  "template1",
  "jasoncox",
]);

/** QA databases must match this pattern. */
export const QA_DB_NAME_PATTERN = /^crm_qa(_[a-z0-9_]+)?$/;
