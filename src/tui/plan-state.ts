// Presentation-only projection of user-owned plan files. Never expose auth,
// endpoints, app identity, or raw errors to the renderer.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readPlan } from "../autoclaw/plan";
import { fetchModelCatalog } from "../autoclaw/gateway";

export interface PlanCatalogModel { id: string; name: string }
// Baseline model metadata (2026-10-23), not app identity or executable
// routes. Used only when a plan exists but discovery
// is offline and there is no cache; successful discovery stays authoritative.
const KNOWN_AUTOCLAW_MODELS: readonly PlanCatalogModel[] = [
  { id: "zai_auto", name: "Auto" },
  { id: "zai_auto-fast", name: "Auto-Fast" },
  { id: "zaicoding_glm-5.3", name: "GLM-5.3" },
  { id: "zai_glm-5.3-flash", name: "GLM-5.3-Flash" },
];
export interface PlanMeter { label: string; used: number; limit: number }
export interface PlanState {
  entitlements: { label: string; status: string }[];
  meters: PlanMeter[];
  codingCache: boolean;
  codingCacheAgeMs?: number;
  autoclaw: {
    present: boolean;
    credentialAgeMs: number | null;
    credentialReady: boolean;
    models: PlanCatalogModel[];
    catalogSource: "live" | "cache" | "fallback" | "unavailable";
  };
}
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const label = (s: string) => s.replace(/^builtin:/, "").replace(/[-_]/g, " ");
const readJson = (path: string): unknown => {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return undefined; }
};
export function catalogModels(value: unknown): PlanCatalogModel[] {
  const rows = record(value).models;
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    const m = record(row);
    if (typeof m.id !== "string" || !m.id.trim() || seen.has(m.id)) return [];
    seen.add(m.id);
    return [{ id: m.id, name: typeof m.name === "string" && m.name.trim() ? m.name : m.id }];
  });
}
// Cache versions vary. Consume only explicit finite used/limit pairs; never
// infer remaining quota from tokens, entitlements, or a failed request.
export function codingPlanSummary(value: unknown, now = Date.now()): Pick<PlanState, "entitlements" | "meters" | "codingCache" | "codingCacheAgeMs"> {
  const cache = record(value);
  const items = record(record(cache.entryStatus).items);
  const entitlements = Object.entries(items).map(([key, item]) => ({
    label: label(key), status: typeof record(item).status === "string" ? String(record(item).status) : "unknown",
  }));
  const meters: PlanMeter[] = [];
  const visit = (v: unknown, path: string[], depth: number) => {
    if (depth > 5) return;
    const row = record(v);
    if (typeof row.used === "number" && Number.isFinite(row.used) && row.used >= 0 &&
        typeof row.limit === "number" && Number.isFinite(row.limit) && row.limit > 0) {
      meters.push({ label: label(path.filter((p) => !["entryStatus", "items", "usage"].includes(p)).join(" · ")) || "Plan usage", used: row.used, limit: row.limit });
      return;
    }
    for (const [key, child] of Object.entries(row)) if (child && typeof child === "object") visit(child, [...path, key], depth + 1);
  };
  visit(cache, [], 0);
  const updatedAt = record(cache.entryStatus).updatedAt;
  const updated = typeof updatedAt === "number" ? updatedAt : typeof updatedAt === "string" ? Date.parse(updatedAt) : NaN;
  return { entitlements, meters, codingCache: Object.keys(cache).length > 0,
    codingCacheAgeMs: Number.isFinite(updated) && updated >= 0 && updated <= now ? now - updated : undefined };
}
export function readPlanState(home = homedir(), now = Date.now()): PlanState {
  const planPath = join(home, ".config/zcode-tui/autoclaw-plan.json");
  const plan = record(readJson(planPath));
  const auth = record(plan.auth);
  const updated = typeof auth.updatedAt === "string" ? Date.parse(auth.updatedAt) : NaN;
  const models = catalogModels(readJson(join(home, ".local/state/zcode-tui/autoclaw-model-catalog.json")));
  const present = existsSync(planPath);
  return {
    ...codingPlanSummary(readJson(join(home, ".zcode/v2/coding-plan-cache.json")), now),
    autoclaw: {
      present,
      credentialReady: typeof auth.accessToken === "string" && auth.accessToken.length > 0,
      credentialAgeMs: Number.isFinite(updated) && updated <= now ? now - updated : null,
      models: models.length ? models : present ? KNOWN_AUTOCLAW_MODELS.map((m) => ({ ...m })) : [],
      catalogSource: models.length ? "cache" : present ? "fallback" : "unavailable",
    },
  };
}
async function liveCatalog(): Promise<Awaited<ReturnType<typeof fetchModelCatalog>>> {
  const plan = readPlan();
  if (!plan) return { ok: false, failure: "not_configured" };
  return fetchModelCatalog(plan, ((input, init) =>
    fetch(input, { ...init, signal: AbortSignal.timeout(4000) })) as typeof fetch);
}
export async function refreshPlanCatalog(state: PlanState, load = liveCatalog): Promise<PlanState> {
  try {
    const result = await load();
    const models = result.ok ? catalogModels(result) : [];
    if (models.length) return { ...state, autoclaw: {
      ...state.autoclaw, models, catalogSource: "live",
    } };
  } catch { /* Offline: the cached catalog remains usable. */ }
  return state;
}
export function credentialAge(ms: number | null): string {
  if (ms === null) return "unknown";
  if (ms < 60_000) return "just updated";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m old`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h old`;
  return `${Math.floor(ms / 86_400_000)}d old`;
}
export function meterText(meter: PlanMeter, width = 12): string {
  const ratio = Math.max(0, Math.min(1, meter.used / meter.limit));
  const filled = Math.round(ratio * width);
  return `${"━".repeat(filled)}${"─".repeat(width - filled)} ${meter.used.toLocaleString("en-US")} / ${meter.limit.toLocaleString("en-US")} (${Math.round(meter.used / meter.limit * 100)}%)`;
}
