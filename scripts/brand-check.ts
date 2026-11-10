/**
 * One Joist mark, one monogram rule, no customer brand in the product.
 *
 *   1. Every generated icon file still matches the one drawing
 *      (crm_frontend/src/assets/brand/joist-mark.svg): runs the generator's
 *      --check, and fails if the mark's geometry appears in any other file.
 *   2. The generated PNG/ICO files have the sizes the manifest and the head
 *      tags promise.
 *   3. The frontend tile and the backend invite email compute the same
 *      initials for every name in crm_backend/test/fixtures/monogram-cases.json.
 *   4. Every palette's --on-accent is readable on its --accent (the
 *      monogram tile), the orange palette is labelled Ember with id rooftop,
 *      and the other palettes keep their labels and accents.
 *   5. No Rooftop Realty identity is left in the frontend source.
 *
 * Reads source files only. No database, no server.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { qaEnv } from "../config/env.ts";

const failures: string[] = [];
const notes: string[] = [];
const fe = (...parts: string[]) => path.join(qaEnv.frontendPath, ...parts);
const be = (...parts: string[]) => path.join(qaEnv.backendPath, ...parts);
const scratch = path.join(qaEnv.qaRoot, "qa-artifacts", "brand-check");
fs.mkdirSync(scratch, { recursive: true });

/** Load a dependency-free module from either repo as ESM (strips TS types). */
async function load<T>(file: string, name: string): Promise<T> {
  const ext = file.endsWith(".ts") ? ".mts" : ".mjs";
  const copy = path.join(scratch, `${name}${ext}`);
  fs.copyFileSync(file, copy);
  return (await import(`${pathToFileURL(copy).href}?t=${Date.now()}`)) as T;
}

// --- 1. one drawing ---------------------------------------------------------
const generator = spawnSync("node", ["scripts/generate-pwa-icons.mjs", "--check"], {
  cwd: qaEnv.frontendPath,
  encoding: "utf8",
});
if (generator.status !== 0) {
  failures.push(`icon files drifted from the drawing:\n${generator.stderr || generator.stdout}`);
} else {
  notes.push(generator.stdout.trim().split("\n").pop() || "icons match");
}

const GEOMETRY = "M16 12h4v14H6v-6h10z";
const GENERATED = new Set(
  [
    "src/assets/brand/joist-mark.svg",
    "src/app/icon.svg",
    "public/icons/icon-192.svg",
    "public/icons/icon-512.svg",
    "public/offline.html",
  ].map((file) => fe(file)),
);
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|jsx|ts|tsx|css|svg|html|md)$/.test(entry.name)) out.push(full);
  }
  return out;
}
const sourceFiles = [...walk(fe("src")), ...walk(fe("public"))];
for (const file of sourceFiles) {
  if (GENERATED.has(file)) continue;
  if (fs.readFileSync(file, "utf8").includes(GEOMETRY)) {
    failures.push(`the mark is redrawn outside its source: ${path.relative(qaEnv.frontendPath, file)}`);
  }
}

// --- 2. sizes -----------------------------------------------------------------
function pngSize(buffer: Buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}
const PNGS: Array<[string, number]> = [
  ["public/icons/icon-192.png", 192],
  ["public/icons/icon-512.png", 512],
  ["public/icons/icon-512-maskable.png", 512],
  ["src/app/apple-icon.png", 180],
];
for (const [file, size] of PNGS) {
  const got = pngSize(fs.readFileSync(fe(file)));
  if (!got || got.width !== size || got.height !== size) {
    failures.push(`${file} should be ${size}x${size}, is ${got ? `${got.width}x${got.height}` : "not a PNG"}`);
  }
}
const ico = fs.readFileSync(fe("src/app/favicon.ico"));
const frames: number[] = [];
for (let i = 0; i < ico.readUInt16LE(4); i += 1) {
  const entry = 6 + 16 * i;
  const length = ico.readUInt32LE(entry + 8);
  const offset = ico.readUInt32LE(entry + 12);
  const size = pngSize(ico.subarray(offset, offset + length));
  if (size) frames.push(size.width);
}
if (frames.join(",") !== "16,32,48") {
  failures.push(`favicon.ico should hold 16, 32 and 48px frames, holds ${frames.join(", ") || "none"}`);
}
if (fs.existsSync(fe("public/icons/apple-touch-icon.png"))) {
  failures.push("public/icons/apple-touch-icon.png is back; the Apple icon is src/app/apple-icon.png");
}

// --- 3. one monogram rule -----------------------------------------------------
type Monogram = { companyMonogram: (name: string) => string };
const cases: Array<[string, string]> = JSON.parse(
  fs.readFileSync(be("test/fixtures/monogram-cases.json"), "utf8"),
);
const frontMonogram = await load<Monogram>(fe("src/lib/monogram.js"), "monogram-frontend");
const backMonogram = await load<Monogram>(be("src/lib/monogram.ts"), "monogram-backend");
for (const [name, expected] of cases) {
  const front = frontMonogram.companyMonogram(name);
  const back = backMonogram.companyMonogram(name);
  if (front !== expected || back !== expected) {
    failures.push(`monogram ${JSON.stringify(name)}: expected ${expected}, app ${front}, email ${back}`);
  }
}
notes.push(`${cases.length} monogram cases agree in the app and the email`);

// --- 4. palettes --------------------------------------------------------------
type Palette = { id: string; label: string; light: Record<string, string> };
function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
// Labels and accents as they were before this pass; only rooftop's label moves.
const EXPECTED: Record<string, { label: string; accent: string }> = {
  rooftop: { label: "Ember", accent: "#f97316" },
  azure: { label: "Azure", accent: "#2563eb" },
  slate: { label: "Slate", accent: "#0f766e" },
};
const themeDir = fe("src/theme/themes");
const contrasts: string[] = [];
for (const file of fs.readdirSync(themeDir).filter((f) => f.endsWith(".js"))) {
  const mod = await load<Record<string, Palette>>(path.join(themeDir, file), `theme-${file}`);
  const palette = Object.values(mod)[0];
  const accent = palette.light["--accent"];
  const ink = palette.light["--on-accent"];
  const ratio = contrast(accent, ink);
  contrasts.push(`${palette.label} ${ratio.toFixed(1)}`);
  // The monogram is 13–16px semibold on the accent: hold it to the 3:1 of
  // large text and UI marks.
  if (ratio < 3) failures.push(`${palette.label}: --on-accent on --accent is ${ratio.toFixed(2)}:1, under 3:1`);
  const want = EXPECTED[palette.id];
  if (want && (want.label !== palette.label || want.accent !== accent.toLowerCase())) {
    failures.push(`${palette.id}: expected ${want.label} ${want.accent}, found ${palette.label} ${accent}`);
  }
}
notes.push(`monogram ink on accent: ${contrasts.join(", ")}`);

// --- 5. no customer identity in the product ----------------------------------
// Docs may name Rooftop Realty (it is a tenant with its own logo); code may not.
for (const file of sourceFiles.filter((f) => !f.endsWith(".md"))) {
  const text = fs.readFileSync(file, "utf8");
  for (const banned of ["Rooftop Realty", "mainlogo", "Buy & Sell"]) {
    if (text.includes(banned)) {
      failures.push(`${path.relative(qaEnv.frontendPath, file)} still says "${banned}"`);
    }
  }
}

if (failures.length) {
  console.error(`[brand-check] FAILED\n  - ${failures.join("\n  - ")}`);
  process.exit(1);
}
console.log(`[brand-check] ok\n  - ${notes.join("\n  - ")}`);
