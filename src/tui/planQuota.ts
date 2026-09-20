// Plan-quota surface (owner directive 2026-09-20: show the Z.AI Coding
// Plan quota — usage and weekly quota left). The design fork RESOLVED
// live (probe 2026-09-20): the synced coding-plan api key authenticates
// the desktop's own monitor endpoints directly — Bearer <key> against
// api.z.ai/api/monitor/usage/quota/limit and /api/biz/subscription/list
// both answer 200. Fork (b) it is: the surface is TUI-owned, no host
// verb. Fail-soft everywhere — any failure just starves the Usage
// section; it must never block the status dialog. The api key never
// renders and never logs (the auth/sync.ts law: fingerprints only).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { configDir, extractProviderApiKey } from "../auth/sync";

export interface QuotaLimit {
  label: string;
  used: number;
  total: number;
  remaining: number;
  percentage: number;
  nextResetMs: number | null;
}

export interface PlanQuotaSnapshot {
  level: string | null;
  limits: QuotaLimit[];
  planName: string | null;
  planStatus: string | null;
  planRenews: string | null;
  fetchedAt: number;
}

export interface UsageStatsSummary {
  totalTokens: number;
  totalSessions: number;
  totalTurns: number;
  activeDays: number;
}

const QUOTA_URL = "https://api.z.ai/api/monitor/usage/quota/limit";
const SUBSCRIPTION_URL = "https://api.z.ai/api/biz/subscription/list";
const TIMEOUT_MS = 15_000;

// The desktop pairs unit/number as: unit 3 x number 5 = the five-hour
// rolling window, unit 6 x number 1 = the weekly window (live payload
// 2026-09-20). Anything else stays generic.
function limitLabel(unit: number, count: number): string {
  if (unit === 3 && count === 5) return "5-hour";
  if (unit === 6 && count === 1) return "Weekly";
  return "Plan window";
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function parseQuotaLimit(raw: unknown): QuotaLimit | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const used = num(r.currentValue);
  const total = num(r.usage);
  if (used === null || total === null || total <= 0) return null;
  return {
    label: limitLabel(num(r.unit) ?? -1, num(r.number) ?? -1),
    used,
    total,
    remaining: num(r.remaining) ?? Math.max(0, total - used),
    percentage: num(r.percentage) ?? Math.round((used / total) * 100),
    nextResetMs: num(r.nextResetTime),
  };
}

export function parseQuotaPayload(payload: unknown): PlanQuotaSnapshot | null {
  const data = (payload as { data?: unknown } | null)?.data;
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  const limits = Array.isArray(d.limits)
    ? d.limits.map(parseQuotaLimit).filter((l): l is QuotaLimit => l !== null)
    : [];
  return {
    level: typeof d.level === "string" ? d.level : null,
    limits,
    planName: null,
    planStatus: null,
    planRenews: null,
    fetchedAt: Date.now(),
  };
}

function lastDate(s: string): string | null {
  const all = s.match(/\d{4}-\d{2}-\d{2}/g);
  return all && all.length > 0 ? all[all.length - 1] : null;
}

export function parseSubscriptionPayload(payload: unknown): { name: string | null; status: string | null; renews: string | null } {
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return { name: null, status: null, renews: null };
  for (const raw of data) {
    if (typeof raw !== "object" || raw === null) continue;
    const s = raw as Record<string, unknown>;
    if (typeof s.status === "string" && s.status.toUpperCase() === "VALID") {
      const renews =
        (typeof s.nextRenewTime === "string" ? lastDate(s.nextRenewTime) : null) ??
        (typeof s.valid === "string" ? lastDate(s.valid) : null);
      return {
        name: typeof s.productName === "string" ? s.productName : null,
        status: s.status,
        renews,
      };
    }
  }
  return { name: null, status: null, renews: null };
}

async function getJson(url: string, apiKey: string): Promise<unknown> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

export function readStoredApiKey(home?: string): string | null {
  try {
    const raw = readFileSync(join(configDir(home ?? ""), "auth-provider-config.json"), "utf8");
    return extractProviderApiKey(raw);
  } catch {
    return null;
  }
}

// Quota is the load-bearing half; the subscription list is decoration — a
// failure there leaves the plan row out without failing the snapshot.
export async function fetchPlanQuota(apiKey: string): Promise<PlanQuotaSnapshot> {
  const [quota, subscription] = await Promise.all([
    getJson(QUOTA_URL, apiKey),
    getJson(SUBSCRIPTION_URL, apiKey).catch(() => null),
  ]);
  const snapshot = parseQuotaPayload(quota);
  if (!snapshot) throw new Error("quota payload unreadable");
  if (subscription !== null) {
    const sub = parseSubscriptionPayload(subscription);
    snapshot.planName = sub.name;
    snapshot.planStatus = sub.status;
    snapshot.planRenews = sub.renews;
  }
  return snapshot;
}

export function parseUsageStats(payload: unknown): UsageStatsSummary | null {
  const summary = (payload as { summary?: unknown } | null)?.summary;
  if (typeof summary !== "object" || summary === null) return null;
  const s = summary as Record<string, unknown>;
  const totalTokens = num(s.totalTokens);
  if (totalTokens === null) return null;
  return {
    totalTokens,
    totalSessions: num(s.totalSessions) ?? 0,
    totalTurns: num(s.totalTurns) ?? 0,
    activeDays: num(s.activeDays) ?? 0,
  };
}

// 31966197 -> "31.9M"; 47172 -> "47.2k"; 1063 -> "1063"
export function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

// nextResetMs -> "in 2h 14m" | "in 38m" | the UTC date once it is far.
export function formatReset(nextResetMs: number | null, now: number): string {
  if (nextResetMs === null) return "";
  const delta = nextResetMs - now;
  if (delta <= 0) return "now";
  const mins = Math.round(delta / 60_000);
  if (mins < 60) return `in ${mins}m`;
  if (mins < 48 * 60) {
    const h = Math.floor(mins / 60);
    return `in ${h}h ${mins % 60}m`;
  }
  const d = new Date(nextResetMs);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function quotaBar(percentage: number, width = 10): string {
  const filled = Math.max(0, Math.min(width, Math.round((percentage / 100) * width)));
  return "█".repeat(filled) + "░".repeat(width - filled);
}
