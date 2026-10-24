// zt-plans — monitor every ZAI plan the orchestrator routes against
// (owner directive 2026-10-24: "monitoring of all sorts of zai plans should
// be possible for zcode-tui cli verb so that orchestrator agents can take
// an intelligent decision on it").
//
// Endpoints (mined from the desktop bundle, measured live 2026-10-24):
//   GET https://zcode.z.ai/api/v1/zcode-plan/billing/current
//     -> {code:0, data:{server_time, plans:[{plan_id,name,status,starts_at,
//        ends_at,priority,entitlements:[{show_name,capabilities,grant_units,
//        period,effective_at}]}]}}          — the grants per active plan
//   GET https://zcode.z.ai/api/v1/zcode-plan/billing/balance?app_version=X
//     -> remaining units per entitlement (desktop-only auth shape; 3001 from
//        a bare CLI — reported as null, never guessed)
//   GET https://zcode.z.ai/api/v1/off-peak/ticket/availability
//     -> idle-task take window (can_take_number / next_take_at)
//
// Model routing law this feeds (owner 2026-10-24): GLM-5.3 FULL runs ONLY
// while a start-plan entitlement for model:glm-5.3 is active; when absent or
// exhausted, full-model dreams route as GLM-5.3-Flash max. `--json` carries
// the same verdict in machine form: glm53_full_allowed.
import { parseArgs } from "node:util";
import { join } from "node:path";
import { codingPlanApiKey, cloudJwt, gatewayOrigin } from "../queue/offpeak-gateway";

const { values } = parseArgs({
  strict: false,
  options: {
    json: { type: "boolean", default: false },
    // Skip network probes (offline triage): read the local coding-plan
    // cache entry statuses only.
    offline: { type: "boolean", default: false },
  },
});

export interface Entitlement {
  show_name: string;
  capabilities: string[];
  grant_units: number;
  period: string;
  effective_at: number;
  priority: number;
}
export interface PlanRow {
  plan_id: string;
  name: string;
  status: string;
  starts_at: number;
  ends_at: number;
  priority: number;
  entitlements: Entitlement[];
}
export interface PlansReport {
  generated_at: number;
  server_time?: number;
  plans: PlanRow[];
  glm53_full_allowed: boolean;
  glm53_full_grant_units?: number;
  glm53_full_ends_at?: number;
  glm53_full_route_ready: boolean;
  offpeak?: { can_take: boolean; next_take_at?: number };
  balance: "unavailable-from-cli (3001: desktop-only auth shape)" | null;
  balance_remaining?: null;
  note: string;
}

/** Can the runtime actually ROUTE GLM-5.3 full to a start-plan provider?
 *  The desktop's account provider (account:zai-start-plan) is not in the
 *  headless registry until the desktop syncs/refreshes it — until then any
 *  GLM-5.3 session from the CLI would draw the CODING plan (owner law:
 *  forbidden). Gate = enabled start-plan provider entry listing GLM-5.3. */
export function glm53FullRouteReady(cfgPath: string): boolean {
  try {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    for (const [pid, v] of Object.entries((cfg.provider ?? {}) as Record<string, any>)) {
      if (!/start-plan/i.test(pid)) continue;
      if (v?.enabled !== true) continue;
      if (Object.keys(v?.models ?? {}).some((m) => /^GLM-5\.3$/i.test(m))) return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function get(path: string, authHeaders: Record<string, string>): Promise<{ status: number; body: any }> {
  const res = await fetch(gatewayOrigin() + path, { headers: { "content-type": "application/json", ...authHeaders } });
  let body: any = null;
  try { body = await res.json(); } catch { /* non-json (404 pages etc.) */ }
  return { status: res.status, body };
}

/** The orchestrator's gate: is GLM-5.3 FULL usable right now? True only when
 *  a START-plan entitlement carrying capability model:glm-5.3 is active
 *  (effective, unexpired). Coding-plan grants never satisfy this — owner law:
 *  full never rides the regular coding plan. */
export function glm53FullVerdict(plans: PlanRow[], nowSec: number): { allowed: boolean; units?: number; endsAt?: number } {
  let best: { units: number; endsAt: number } | null = null;
  for (const p of plans) {
    const isStartPlan = /start[-_ ]?plan/i.test(p.plan_id) || /start[-_ ]?plan|dev day/i.test(p.name);
    if (!isStartPlan || p.status?.toLowerCase() !== "active") continue;
    if (p.ends_at && nowSec >= p.ends_at) continue;
    for (const e of p.entitlements ?? []) {
      const coversFull = (e.capabilities ?? []).some((c) => /^model:glm-5\.3$/i.test(c));
      if (!coversFull) continue;
      if (e.effective_at && nowSec < e.effective_at) continue;
      if (!best || p.ends_at > best.endsAt) best = { units: e.grant_units, endsAt: p.ends_at };
    }
  }
  return best ? { allowed: true, units: best.units, endsAt: best.endsAt } : { allowed: false };
}

export async function main() {
  if (values.offline) {
    // local cache only — plan availability statuses from the last desktop sync
    try {
      const { readFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const cache = JSON.parse(readFileSync(join(process.env.HOME ?? "", ".zcode", "v2", "coding-plan-cache.json"), "utf8"));
      if (values.json) {
        console.log(JSON.stringify({ offline: true, entryStatus: cache.entryStatus?.items ?? {} }, null, 1));
      } else {
        console.log("zcode-tui plans (offline cache):");
        for (const [k, v] of Object.entries(cache.entryStatus?.items ?? {})) {
          console.log(`  ${k.padEnd(28)} ${(v as any).status}${(v as any).reason ? ` (${(v as any).reason})` : ""}`);
        }
      }
      return;
    } catch (e) {
      console.error(`zt-plans: offline cache unreadable: ${String(e).slice(0, 120)}`);
      process.exit(1);
    }
  }

  const key = codingPlanApiKey();
  const jwt = cloudJwt();
  const authHeaders: Record<string, string> = {
    "x-coding-plan-api-key": key,
    ...(jwt ? { authorization: `Bearer ${jwt}` } : {}),
  };

  const report: PlansReport = {
    generated_at: Date.now(),
    plans: [],
    glm53_full_allowed: false,
    glm53_full_route_ready: false,
    balance: null,
    note: "grant totals from billing/current; remaining units unavailable from the CLI (desktop-only balance auth)",
  };

  const cur = await get("/api/v1/zcode-plan/billing/current", authHeaders);
  if (cur.status === 200 && cur.body?.code === 0) {
    report.server_time = cur.body.data?.server_time;
    report.plans = (cur.body.data?.plans ?? []) as PlanRow[];
    const nowSec = report.server_time ?? Math.floor(Date.now() / 1000);
    const verdict = glm53FullVerdict(report.plans, nowSec);
    report.glm53_full_grant_units = verdict.units;
    report.glm53_full_ends_at = verdict.endsAt;
    report.glm53_full_route_ready = glm53FullRouteReady(join(process.env.HOME ?? "", ".zcode", "v2", "config.json"));
    // The full model is usable only when BOTH hold: an active start-plan
    // grant AND a routable start-plan provider (else the CLI session would
    // silently draw the coding plan — owner law forbids that).
    report.glm53_full_allowed = verdict.allowed && report.glm53_full_route_ready;
  } else {
    report.note = `billing/current failed: HTTP ${cur.status} ${JSON.stringify(cur.body).slice(0, 160)}`;
  }

  try {
    const op = await get("/api/v1/off-peak/ticket/availability", authHeaders);
    const d = op.body?.data ?? op.body;
    report.offpeak = { can_take: Boolean(d?.can_take_number), next_take_at: d?.next_take_at };
  } catch { /* offpeak probe optional */ }

  // Balance (remaining units): the desktop resolves this with a runtime-scoped
  // auth shape a bare CLI cannot replicate; 3001 is the honest answer.
  try {
    const b = await get("/api/v1/zcode-plan/billing/balance?app_version=3.16.3", authHeaders);
    report.balance = b.status === 200 && b.body?.code === 0 ? null : "unavailable-from-cli (3001: desktop-only auth shape)";
  } catch {
    report.balance = "unavailable-from-cli (3001: desktop-only auth shape)";
  }

  if (values.json) {
    console.log(JSON.stringify(report, null, 1));
    return;
  }
  console.log(`zcode-tui plans @ ${new Date(report.generated_at).toISOString()}`);
  if (!report.plans.length) {
    console.log(`  (no plan data — ${report.note})`);
  }
  for (const p of report.plans) {
    const ends = p.ends_at ? new Date(p.ends_at * 1000).toISOString().slice(0, 16) : "?";
    console.log(`  ${p.name} [${p.status}] ${p.plan_id} ends=${ends} priority=${p.priority}`);
    for (const e of p.entitlements ?? []) {
      console.log(`    - ${e.show_name}: grant=${(e.grant_units / 1e6).toFixed(0)}M tokens (${e.period}) from ${new Date(e.effective_at * 1000).toISOString().slice(0, 16)}`);
    }
  }
  console.log(`  GLM-5.3 FULL ${report.glm53_full_allowed ? "ALLOWED (start-plan grant active)" : "BLOCKED — route as GLM-5.3-Flash max (owner law)"}`);
  if (report.offpeak) console.log(`  off-peak idle task: ${report.offpeak.can_take ? "available now" : `not available (next ${report.offpeak.next_take_at ? new Date(report.offpeak.next_take_at).toISOString().slice(0, 16) : "?"})`}`);
  console.log(`  balance/remaining: ${report.balance}`);
}

main().catch((e) => {
  console.error(`zt-plans: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
