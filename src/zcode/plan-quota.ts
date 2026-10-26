// Coding-plan quota windows + the reset-token plane (unofficial client).
//
// Wire contracts mined from the user's ZCode desktop bundle (app.asar,
// 2026-10-25) and live-validated with the user's own credentials:
//
// - Quota windows: GET https://api.z.ai/api/monitor/usage/quota/limit
//   Authorization: Bearer <coding-plan api key>
//   → {code:0, data:{limits:[{type:"CREDIT_LIMIT", unit:3|6 (5h|week),
//     number, usage, currentValue, remaining, percentage (used%),
//     nextResetTime (epoch ms)}], level:"pro"|...}}
//
// - Reset tokens ("erratic custom gifts from z.ai", owner words):
//   base https://zcode.z.ai, paths /api/v1/coding-plan/reset/{status,use,
//   opportunity,history/read}. Headers: Authorization Bearer <zcodejwttoken>,
//   X-Bigmodel-Authorization <oauth:zai:access_token>, Bigmodel-Target-Type
//   PERSONAL (desktop bundle RP/createCodingPlanResetHeaders).
//   status → {available_five_hour_resets:[{expire_at}],
//   available_week_resets:[{expire_at}], latest_*_reset_history:{used_at},
//   has_unread_history}. use → POST {idempotency_key ≤64ch,
//   reset_type:"fiveHour"|"week"} → {used:true}. opportunity → POST
//   {idempotency_key} → {granted:true} | code 3301 {granted:false,
//   next_try_at}; HTTP 429 = throttled.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { readCredential } from "./credentials";

const QUOTA_BASE = process.env.ZCODE_QUOTA_ORIGIN ?? "https://api.z.ai";
const RESET_BASE = process.env.ZCODE_RESET_ORIGIN ?? "https://zcode.z.ai";

export interface QuotaWindow {
  window: string;
  number: number;
  usage: number;
  currentValue: number;
  remaining: number;
  /** percent USED, as the server sends it */
  percentageUsed: number;
  nextResetTime: number;
}

export interface QuotaSnapshot {
  level: string | null;
  windows: QuotaWindow[];
}

/** Fallback: provider_config.json's apiKey (the desktop writes it too). */
function planApiKey(): string {
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), ".zcode", "v2", "provider_config.json"), "utf8"));
    const m = JSON.stringify(cfg).match(/"apiKey"\s*:\s*"([^"]+)"/);
    return m ? m[1] : "";
  } catch { return ""; }
}

export async function codingPlanQuota(fetchImpl: typeof fetch = fetch): Promise<QuotaSnapshot | { error: string }> {
  const key = process.env.ZCODE_CODING_PLAN_API_KEY
    ?? readCredential("account-provider:coding-plan:account:zai-individual-coding-plan:account:8020b14a-1e62-4fd2-869f-8267e7101f2e:api-key")
    ?? planApiKey();
  if (!key) return { error: "no coding-plan api key in ~/.zcode/v2/credentials.json" };
  let res: Response;
  try {
    res = await fetchImpl(`${QUOTA_BASE}/api/monitor/usage/quota/limit`, {
      headers: { Authorization: `Bearer ${key}` },
    });
  } catch (e) {
    return { error: `network: ${(e as Error).message}` };
  }
  let doc: any;
  try { doc = await res.json(); } catch { return { error: `http ${res.status} (non-JSON)` }; }
  // the quota endpoint answers code:200 (not the code:0 the reset plane uses)
  if ((doc?.code !== 0 && doc?.code !== 200) || !Array.isArray(doc?.data?.limits)) return { error: `envelope code ${doc?.code} ${String(doc?.msg ?? "").slice(0, 80)}` };
  const windows: QuotaWindow[] = (doc.data.limits as Array<Record<string, unknown>>).map((l) => {
    const unit = Number(l.unit);
    return {
      // z.ai grants windows erratically (owner 2026-10-26: start-plan gifts
      // land "on any model quota as they wish") — never DROP an unknown unit
      // type; label it so the view stays honest.
      window: unit === 3 ? "5h" : unit === 6 ? "week" : `unit-${unit}`,
      number: Number(l.number ?? 0),
      usage: Number(l.usage ?? 0),
      currentValue: Number(l.currentValue ?? 0),
      remaining: Number(l.remaining ?? 0),
      percentageUsed: Number(l.percentage ?? 0),
      nextResetTime: Number(l.nextResetTime ?? 0),
    };
  });
  return { level: typeof doc.data.level === "string" ? doc.data.level.trim() : null, windows };
}

function resetHeaders(): Record<string, string> | null {
  const jwt = readCredential("zcodejwttoken");
  const maas = readCredential("oauth:zai:access_token");
  if (!jwt || !maas) return null;
  return {
    Authorization: /^Bearer\s/i.test(jwt) ? jwt : `Bearer ${jwt}`,
    "X-Bigmodel-Authorization": maas,
    "Bigmodel-Target-Type": "PERSONAL",
  };
}

export interface ResetStatus {
  availableFiveHour: number[];
  availableWeek: number[];
  latestFiveHourUsedAt: number | null;
  latestWeekUsedAt: number | null;
  hasUnreadHistory: boolean;
}

export async function resetStatus(fetchImpl: typeof fetch = fetch): Promise<ResetStatus | { error: string }> {
  const headers = resetHeaders();
  if (!headers) return { error: "missing zcodejwttoken or oauth:zai:access_token in ~/.zcode/v2/credentials.json" };
  let res: Response;
  try {
    res = await fetchImpl(`${RESET_BASE}/api/v1/coding-plan/reset/status`, { headers });
  } catch (e) {
    return { error: `network: ${(e as Error).message}` };
  }
  let doc: any;
  try { doc = await res.json(); } catch { return { error: `http ${res.status} (non-JSON)` }; }
  if (doc?.code !== 0 || !doc?.data) return { error: `envelope code ${doc?.code} ${String(doc?.msg ?? "").slice(0, 80)}` };
  const d = doc.data;
  return {
    availableFiveHour: (d.available_five_hour_resets ?? []).map((r: { expire_at: number }) => Number(r.expire_at)),
    availableWeek: (d.available_week_resets ?? []).map((r: { expire_at: number }) => Number(r.expire_at)),
    latestFiveHourUsedAt: d.latest_five_hour_reset_history ? Number(d.latest_five_hour_reset_history.used_at) : null,
    latestWeekUsedAt: d.latest_week_reset_history ? Number(d.latest_week_reset_history.used_at) : null,
    hasUnreadHistory: Boolean(d.has_unread_history),
  };
}

export type ResetKind = "fiveHour" | "week";

/** Apply one owned reset token. idempotencyKey ≤ 64 chars — reuse the same
 *  key when retrying an ambiguous failure so the server dedupes. */
export async function resetUse(kind: ResetKind, idempotencyKey: string, fetchImpl: typeof fetch = fetch): Promise<{ used: boolean } | { error: string }> {
  const headers = resetHeaders();
  if (!headers) return { error: "missing zcodejwttoken or oauth:zai:access_token" };
  const key = idempotencyKey.trim();
  if (!key || key.length > 64) return { error: "idempotency key must be 1..64 chars" };
  let res: Response;
  try {
    res = await fetchImpl(`${RESET_BASE}/api/v1/coding-plan/reset/use`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ idempotency_key: key, reset_type: kind }),
    });
  } catch (e) {
    return { error: `network: ${(e as Error).message}` };
  }
  let doc: any;
  try { doc = await res.json(); } catch { return { error: `http ${res.status} (non-JSON)` }; }
  if (doc?.code !== 0) return { error: `envelope code ${doc?.code} ${String(doc?.msg ?? "").slice(0, 100)}` };
  return { used: doc.data?.used === true };
}

export async function resetOpportunity(idempotencyKey: string, fetchImpl: typeof fetch = fetch): Promise<{ granted: boolean; nextTryAt: number | null } | { error: string }> {
  const headers = resetHeaders();
  if (!headers) return { error: "missing zcodejwttoken or oauth:zai:access_token" };
  const key = idempotencyKey.trim();
  if (!key || key.length > 64) return { error: "idempotency key must be 1..64 chars" };
  let res: Response;
  try {
    res = await fetchImpl(`${RESET_BASE}/api/v1/coding-plan/reset/opportunity`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ idempotency_key: key }),
    });
  } catch (e) {
    return { error: `network: ${(e as Error).message}` };
  }
  if (res.status === 429) return { error: "opportunity throttled (HTTP 429)" };
  let doc: any;
  try { doc = await res.json(); } catch { return { error: `http ${res.status} (non-JSON)` }; }
  if (doc?.code === 3301) {
    return { granted: false, nextTryAt: Number(doc.data?.next_try_at ?? 0) || null };
  }
  if (doc?.code !== 0) return { error: `envelope code ${doc?.code} ${String(doc?.msg ?? "").slice(0, 100)}` };
  return { granted: doc.data?.granted === true, nextTryAt: null };
}
