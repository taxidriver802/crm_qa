/**
 * One source of help words.
 *
 * The guide (crm_backend/docs/guide/using-the-crm.md) is the only copy of
 * the articles. The backend parses it (`npm run help:articles`). The
 * frontend keeps no words — only which article answers which moment
 * (crm_frontend/src/lib/help.js). This fails when the guide itself is
 * inconsistent, or when an id the UI asks for is not an article the
 * guide serves.
 *
 * It reads source and the parser's JSON. It does not open the database.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { qaEnv } from "../config/env.ts";

const failures: string[] = [];

function block(src: string, name: string): string {
  const match = src.match(new RegExp(`export const ${name}\\s*=\\s*\\{([\\s\\S]*?)\\};`));
  if (!match) {
    failures.push(`could not find ${name} in src/lib/help.js`);
    return "";
  }
  return match[1];
}

/** Article ids the UI names: object values, not keys. */
function articleIds(src: string): string[] {
  const ids = new Set<string>();
  for (const name of ["NEXT_STEP_ARTICLE", "INVOICE_STEP_ARTICLE", "EMPTY_TODAY_ARTICLE"]) {
    for (const match of block(src, name).matchAll(/:\s*["']([a-z0-9-]+)["']/g)) {
      ids.add(match[1]);
    }
  }
  const start = src.match(/export const START_HERE\s*=\s*["']([a-z0-9-]+)["']/);
  if (!start) failures.push("could not find START_HERE in src/lib/help.js");
  else ids.add(start[1]);
  return [...ids];
}

const helpJs = fs.readFileSync(path.join(qaEnv.frontendPath, "src/lib/help.js"), "utf8");
const wanted = articleIds(helpJs);

const parsed = spawnSync("npm", ["run", "help:articles", "--silent"], {
  cwd: qaEnv.backendPath,
  encoding: "utf8",
});

const stdout = parsed.stdout || "";
const jsonStart = stdout.indexOf("{");
const jsonEnd = stdout.lastIndexOf("}");
let guide: { articles?: { id: string }[]; errors?: string[] } | null = null;
if (jsonStart >= 0 && jsonEnd > jsonStart) {
  try {
    guide = JSON.parse(stdout.slice(jsonStart, jsonEnd + 1));
  } catch (error) {
    failures.push(`help:articles did not print JSON (${error instanceof Error ? error.message : error})`);
  }
} else {
  failures.push(
    `help:articles produced no JSON (exit ${parsed.status}). ${String(parsed.stderr || "").slice(0, 500)}`,
  );
}

const served = new Set((guide?.articles || []).map((article) => article.id));
const guideErrors = guide?.errors || [];
if (guideErrors.length) {
  failures.push(`guide problems:\n${guideErrors.map((error) => `  - ${error}`).join("\n")}`);
}
if (parsed.status !== 0 && guideErrors.length === 0) {
  failures.push(`help:articles exited ${parsed.status}`);
}

const missing = wanted.filter((id) => !served.has(id));
if (missing.length) {
  failures.push(
    `the UI asks for articles the guide does not serve: ${missing.join(", ")}`,
  );
}

if (wanted.length === 0) {
  failures.push("no article ids were read from src/lib/help.js");
}

if (failures.length) {
  console.error(`[help-source] FAILED\n${failures.map((line) => `  - ${line}`).join("\n")}`);
  process.exit(1);
}

console.log(
  `[help-source] ${wanted.length} UI article ids are served by the guide (${served.size} articles).`,
);
