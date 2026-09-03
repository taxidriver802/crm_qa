/**
 * Loads and validates the QA harness environment.
 *
 * Every secret in the harness enters through this module and leaves it only
 * via `redact*` helpers. Nothing here prints a raw password, token, or
 * connection string, and `process.env` is never logged wholesale.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path to the crm_qa repository root. */
export const QA_ROOT = path.resolve(HERE, "..");

const ENV_FILE = path.join(QA_ROOT, ".env.qa.local");

if (!fs.existsSync(ENV_FILE)) {
  throw new Error(
    `Missing ${path.relative(QA_ROOT, ENV_FILE)}.\n` +
      `Copy .env.qa.example to .env.qa.local and fill in real values. ` +
      `.env.qa.local is gitignored and must never be committed.`,
  );
}

dotenv.config({ path: ENV_FILE, quiet: true });

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing required QA environment variable: ${name}. See .env.qa.example.`,
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function port(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${name} must be a valid port number, got: ${raw}`);
  }
  return value;
}

function resolveRepoPath(name: string, fallback: string): string {
  const raw = optional(name, fallback);
  const resolved = path.resolve(QA_ROOT, raw);
  if (!fs.existsSync(resolved)) {
    throw new Error(`${name} points at a missing directory: ${resolved}`);
  }
  return resolved;
}

// --- Redaction --------------------------------------------------------------

/**
 * Renders a Postgres connection string safe for logs and artifacts by
 * replacing the password with `***`. Returns a placeholder rather than the
 * original string if parsing fails, so a malformed URL can never leak.
 */
export function redactUrl(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    const user = url.username ? `${url.username}:***@` : "";
    return `${url.protocol}//${user}${url.host}${url.pathname}`;
  } catch {
    return "<unparseable connection string>";
  }
}

/** Masks a secret entirely, keeping only its length as a sanity signal. */
export function redactSecret(value: string | undefined): string {
  if (!value) return "<unset>";
  return `*** (${value.length} chars)`;
}

/**
 * Scrubs known secret values out of arbitrary text before it is printed or
 * written to disk. Used as a last line of defence around child-process output.
 */
export function scrubSecrets(text: string): string {
  let out = text;
  for (const secret of collectSecretValues()) {
    if (secret.length >= 6) {
      out = out.split(secret).join("***");
    }
  }
  return out;
}

/** Every value the harness considers secret. Never write these anywhere. */
export function collectSecretValues(): string[] {
  const values = [
    process.env.QA_JWT_SECRET,
    process.env.QA_OWNER_PASSWORD,
    process.env.QA_AGENT_PASSWORD,
  ];

  for (const key of ["QA_DATABASE_URL", "QA_ADMIN_DATABASE_URL"]) {
    const raw = process.env[key];
    if (!raw) continue;
    values.push(raw);
    try {
      const password = new URL(raw).password;
      if (password) values.push(decodeURIComponent(password));
    } catch {
      // Shape is validated elsewhere; nothing to collect here.
    }
  }

  return values.filter((value): value is string => Boolean(value));
}

// --- Resolved configuration -------------------------------------------------

const isolatedWorkspace = optional("QA_ISOLATED_WORKSPACE", "0") === "1";
if (isolatedWorkspace) {
  throw new Error(
    "QA_ISOLATED_WORKSPACE=1 is not implemented until Phase 6. " +
      "Phase 2 runs against the working copies at CRM_FRONTEND_PATH / CRM_BACKEND_PATH. " +
      "Set QA_ISOLATED_WORKSPACE=0.",
  );
}

const frontendMode = optional("QA_FRONTEND_MODE", "build");
if (frontendMode !== "build" && frontendMode !== "dev") {
  throw new Error(`QA_FRONTEND_MODE must be "build" or "dev", got: ${frontendMode}`);
}

const frontendPort = port("QA_FRONTEND_PORT", 3100);
const backendPort = port("QA_BACKEND_PORT", 4100);

// Guard against pointing QA at the normal development ports.
for (const [name, value] of [
  ["QA_FRONTEND_PORT", frontendPort],
  ["QA_BACKEND_PORT", backendPort],
] as const) {
  if (value === 3000 || value === 4000) {
    throw new Error(
      `${name}=${value} collides with the normal development ports (3000/4000). ` +
        `QA must use separate ports so a dev instance is never disturbed.`,
    );
  }
}

export const qaEnv = {
  qaRoot: QA_ROOT,

  frontendPath: resolveRepoPath("CRM_FRONTEND_PATH", "../crm_frontend"),
  backendPath: resolveRepoPath("CRM_BACKEND_PATH", "../crm_backend"),

  frontendPort,
  backendPort,
  baseUrl: optional("QA_BASE_URL", `http://localhost:${frontendPort}`).replace(/\/$/, ""),
  backendUrl: `http://localhost:${backendPort}`,

  dbName: required("QA_DB_NAME"),
  databaseUrl: required("QA_DATABASE_URL"),
  adminDatabaseUrl: required("QA_ADMIN_DATABASE_URL"),

  jwtSecret: required("QA_JWT_SECRET"),

  ownerEmail: required("QA_OWNER_EMAIL"),
  ownerPassword: required("QA_OWNER_PASSWORD"),
  agentEmail: optional("QA_AGENT_EMAIL", "qa-agent@crm.local"),
  agentPassword: process.env.QA_AGENT_PASSWORD?.trim() || "",

  frontendMode,
  isolatedWorkspace,

  /** Staged, isolated copy of the frontend. Keeps crm_frontend/.next untouched. */
  stagedFrontendPath: path.join(QA_ROOT, ".qa-build", "frontend"),
  artifactsPath: path.join(QA_ROOT, "qa-artifacts"),
  authStatePath: path.join(QA_ROOT, "tests", "fixtures", ".auth", "owner.json"),
  seedManifestPath: path.join(QA_ROOT, "tests", "fixtures", "seed-manifest.json"),
};

/** A log-safe description of the resolved configuration. */
export function describeConfig(): string {
  return [
    `frontend path   : ${qaEnv.frontendPath}`,
    `backend path    : ${qaEnv.backendPath}`,
    `staged frontend : ${qaEnv.stagedFrontendPath}`,
    `frontend url    : ${qaEnv.baseUrl} (mode: ${qaEnv.frontendMode})`,
    `backend url     : ${qaEnv.backendUrl}`,
    `qa database     : ${redactUrl(qaEnv.databaseUrl)}`,
    `admin database  : ${redactUrl(qaEnv.adminDatabaseUrl)}`,
    `jwt secret      : ${redactSecret(qaEnv.jwtSecret)}`,
    `owner account   : ${qaEnv.ownerEmail} / ${redactSecret(qaEnv.ownerPassword)}`,
  ].join("\n");
}
