// The user-owned AutoClaw plan record.
//
// SEPARATION BOUNDARY (owner, 2026-10-23 — docs/spec-zcode-feature-carryforward.md §12):
// zcode-tui ships NO logins, NO AutoClaw/ZCode code, NO identity constants.
// Everything AutoClaw-specific (app identity, endpoints, credentials) is MINED
// at runtime from the user's own installed AutoClaw app (`zcode-tui autoclaw
// setup`) and stored in THIS file on the user's machine. The repo only carries
// the mining procedure. This file is what replicates across the fleet via the
// auth-sync plane (auth/sync.ts), so any host can serve the plan.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const PLAN_FILE = join(homedir(), ".config", "zcode-tui", "autoclaw-plan.json");

export interface PlanIdentity { appId: string; appKey: string; product: string }
export interface PlanEndpoint { base: string; proxyPath: string; modelConfigPath: string }
export interface PlanAuth { accessToken: string; refreshToken: string; deviceId: string; updatedAt: string }
export interface PlanRefresh { path: string; fallbackPath: string; sourceId: string }
export interface PlanClient { version: string; lang: string; channel: string; traceSource: string }

export interface AutoclawPlan {
  schemaVersion: 1;
  minedFrom: string;
  minedAt: string;
  identity: PlanIdentity;
  endpoint: PlanEndpoint;
  auth: PlanAuth;
  refresh: PlanRefresh;
  client: PlanClient;
  /** The pi coding agent version the user's own app ships (pins the optional vendor install). */
  pi?: { version: string };
}

export function readPlan(path = PLAN_FILE): AutoclawPlan | null {
  try {
    const plan = JSON.parse(readFileSync(path, "utf8")) as AutoclawPlan;
    if (plan?.schemaVersion !== 1) return null;
    if (!plan.identity?.appId || !plan.endpoint?.base || !plan.auth?.accessToken) return null;
    return plan;
  } catch {
    return null;
  }
}

/** Atomic write, owner-only perms: this file carries live credentials. */
export function writePlan(plan: AutoclawPlan, path = PLAN_FILE): void {
  mkdirSync(join(path, ".."), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(plan, null, 2) + "\n");
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

export function planExists(path = PLAN_FILE): boolean {
  return existsSync(path);
}

/** sha256 fingerprint, first 16 hex — for doctor output; never logs secrets. */
export function planFingerprint(plan: AutoclawPlan): string {
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  return createHash("sha256")
    .update(`${plan.identity.appId}|${plan.auth.refreshToken}|${plan.endpoint.base}`)
    .digest("hex")
    .slice(0, 16);
}

/** The bundle's own Bearer rule: the server returns tokens that may already carry the prefix. */
export function bearer(token: string): string {
  const t = token.trim();
  return /^Bearer\s+/i.test(t) ? t : `Bearer ${t}`;
}
