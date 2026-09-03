/**
 * The QA viewport matrix.
 *
 * These sizes are chosen to sit either side of the application's REAL
 * breakpoints rather than being round numbers picked arbitrarily. Verified in
 * crm_frontend:
 *
 *   tailwind.config.js  - no `screens` override, so Tailwind defaults apply:
 *                         sm:640  md:768  lg:1024  xl:1280
 *   src/app/globals.css - hand-written queries at (max-width: 767px) where
 *                         data tables collapse into stacked cards, plus
 *                         (min-width: 640px) and a
 *                         (hover: none) and (pointer: coarse) touch-target rule
 *   src/components/app-shell.js
 *                       - the mobile bottom nav is `lg:hidden`, so mobile
 *                         navigation is active below 1024px
 *
 * The consequence worth knowing: 768px is a genuinely distinct hybrid state.
 * Tables have returned (>= md) but navigation is still mobile (< lg). That
 * combination exists at no other width, which is exactly why tablet earns a
 * slot in the matrix.
 */

export type ViewportName = "desktop-1440" | "laptop-1280" | "tablet-768" | "phone-390";

export type NavigationMode = "sidebar" | "mobile";

export type TableLayout = "table" | "stacked-cards";

export interface QaViewport {
  name: ViewportName;
  width: number;
  height: number;
  /** Whether Playwright should emulate a touch device. */
  isMobile: boolean;
  hasTouch: boolean;
  /** Which navigation chrome is expected to be present at this width. */
  navigation: NavigationMode;
  /** Whether data tables render as tables or as stacked cards here. */
  tables: TableLayout;
  /** Why this specific width is in the matrix. */
  rationale: string;
}

export const VIEWPORTS: readonly QaViewport[] = Object.freeze([
  {
    name: "desktop-1440",
    width: 1440,
    height: 900,
    isMobile: false,
    hasTouch: false,
    navigation: "sidebar",
    tables: "table",
    rationale: "Full desktop layout, comfortably above the xl (1280) breakpoint.",
  },
  {
    name: "laptop-1280",
    width: 1280,
    height: 800,
    isMobile: false,
    hasTouch: false,
    navigation: "sidebar",
    tables: "table",
    rationale: "Sits exactly on the xl breakpoint, where desktop type/spacing shifts.",
  },
  {
    name: "tablet-768",
    width: 768,
    height: 1024,
    isMobile: false,
    hasTouch: true,
    navigation: "mobile",
    tables: "table",
    rationale:
      "Hybrid state: >= md so tables are restored, but < lg so navigation is still mobile.",
  },
  {
    name: "phone-390",
    width: 390,
    height: 844,
    isMobile: true,
    hasTouch: true,
    navigation: "mobile",
    tables: "stacked-cards",
    rationale:
      "Below the 767px rule, so tables collapse to cards and the bottom nav is active.",
  },
]);

export function getViewport(name: ViewportName): QaViewport {
  const found = VIEWPORTS.find((viewport) => viewport.name === name);
  if (!found) throw new Error(`Unknown viewport: ${name}`);
  return found;
}

/** Viewports used by the Phase 2 smoke suite (all of them). */
export const SMOKE_VIEWPORTS: readonly ViewportName[] = Object.freeze([
  "desktop-1440",
  "laptop-1280",
  "tablet-768",
  "phone-390",
]);
