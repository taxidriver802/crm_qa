/**
 * The seed manifest: a record of the ids the database actually generated.
 *
 * Tests read route parameters from here rather than assuming serial ids start
 * at 1, so an insert-order change surfaces as a clear manifest error instead
 * of a confusing 404.
 *
 * The manifest holds ids and emails only - never passwords, tokens or
 * cookies - but it is gitignored regardless, since it is generated output.
 */

import fs from "node:fs";
import path from "node:path";
import { qaEnv } from "../config/env.ts";

export interface SeedManifest {
  generatedFrom: {
    seedAnchor: string;
    pinnedNow: string;
    database: string;
  };
  users: {
    ownerId: string;
    ownerEmail: string;
    agentId: string | null;
    agentEmail: string | null;
  };
  leads: Record<string, number>;
  jobs: Record<string, number>;
  tasks: Record<string, number>;
  estimates: Record<string, number>;
  invoices: Record<string, number>;
  files: Record<string, number>;
  routeTokens: Record<string, number>;
}

export function writeManifest(manifest: SeedManifest): void {
  fs.mkdirSync(path.dirname(qaEnv.seedManifestPath), { recursive: true });
  fs.writeFileSync(qaEnv.seedManifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(
    `[qa-seed] manifest written: ${path.relative(qaEnv.qaRoot, qaEnv.seedManifestPath)}`,
  );
}

export function readManifest(): SeedManifest {
  if (!fs.existsSync(qaEnv.seedManifestPath)) {
    throw new Error(
      `Seed manifest not found at ${qaEnv.seedManifestPath}.\n` +
        `Run "npm run qa:db:setup" (or "npm run qa:db:seed") first.`,
    );
  }
  return JSON.parse(fs.readFileSync(qaEnv.seedManifestPath, "utf8")) as SeedManifest;
}

export function manifestExists(): boolean {
  return fs.existsSync(qaEnv.seedManifestPath);
}
