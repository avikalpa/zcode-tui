// zcode-tui usage — plan limits + consumption surfaces (unofficial client).
//
//   zcode-tui usage [--range all|7d|30d] [--json]
//
// What is honestly knowable today (measured 2026-10-23):
// - Z.AI Coding Plan: entitlement state (~/.zcode/v2/coding-plan-cache.json)
//   + live token telemetry from the app-server's usage/stats (all|7d|30d:
//   totals, cache-hit rate, sessions, per-day per-model). The server does
//   NOT expose remaining-quota/limit windows on this build — the peak-window
//   law (Mon-Fri 11:30-15:30 IST) is the fleet's burn-rate protection.
// - Idle-time (off-peak) tasks: no quota endpoint on this build
//   (v4/offPeak/lifecycle absent; offPeak/list not routed). Surfaced: local
//   index state (queued/running/completed today) + any known creation
//   cooldown from the worker queue's route_state. Observed allowance: ~3
//   creates/24h (our refusal history — observational, not an official number).
// - AutoClaw Credits plan: NOT addressable from ZCode/zcode-tui (the
//   packaged runtime bundle carries zero AutoClaw provider vocabulary —
//   measured 2026-10-23). Read it from the AutoClaw harness itself.
import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { Database } from "bun:sqlite";
import { AppServer } from "../protocol/client";
import { isPeak, minutesToPeak, minutesToPeakEnd, type RouteName } from "../queue/core";

const { values } = parseArgs({
  options: {
    range: { type: "string", default: "7d" },
    json: { type: "boolean", default: false },
  },
});
const range = ["all", "7d", "30d"].includes(String(values.range)) ? String(values.range) : "7d";

interface UsageSnapshot {
  coding_plan: Record<string, unknown>;
  idle_tasks: Record<string, unknown>;
  autoclaw: { addressable: false; note: string };
}

async function main() {
  const snap: UsageSnapshot = {
    coding_plan: {}, idle_tasks: {},
    autoclaw: { addressable: false, note: "AutoClaw plan is a foreign runtime (0 provider vocabulary in the ZCode bundle, measured 2026-10-23) — read limits from the AutoClaw harness." },
  };

  // 1. entitlements (local cache, desktop-maintained)
  try {
    const cache = JSON.parse(readFileSync(join(homedir(), ".zcode", "v2", "coding-plan-cache.json"), "utf8"));
    snap.coding_plan.entitlements = cache.entryStatus?.items ?? {};
  } catch { snap.coding_plan.entitlements = "unavailable (no coding-plan-cache.json)"; }

  // 2. live telemetry from the runtime
  const sv = new AppServer({}, { onStderr: () => {} });
  try {
    const res = (await sv.request("usage/stats", { range }, 30000)) as Record<string, any>;
    const s = res.summary ?? {};
    const days = (res.dailyModelUsage ?? []) as { date: string; models: { modelId: string; totalTokens: number }[] }[];
    const today = days.at(-1);
    snap.coding_plan.telemetry = {
      range,
      totalTokens: s.totalTokens,
      cacheHitRate: s.cacheHitRate,
      sessions: s.totalSessions,
      turns: s.totalTurns,
      activeDays: s.activeDays,
      peakDayTokens: s.peakDayTokens,
      favoriteModel: s.favoriteModel?.modelId,
      latestDay: today ? { date: today.date, tokens: today.models.reduce((a, m) => a + m.totalTokens, 0), byModel: Object.fromEntries(today.models.map((m) => [m.modelId, m.totalTokens])) } : null,
      peakWindowNow: isPeak("zai-coding-plan"),
      minutesToPeak: isPeak("zai-coding-plan") ? 0 : minutesToPeak(),
      minutesToPeakEnd: minutesToPeakEnd(),
      quotaWindows: "not exposed by the server on this build (measured 2026-10-23) — peak-window law protects burn rate",
    };
  } catch (e) {
    snap.coding_plan.telemetry = { error: e instanceof Error ? e.message : String(e) };
  } finally {
    try { await sv.close(); } catch { /* already closed */ }
  }

  // 3. idle-task state (local index, read-only) + known cooldown
  try {
    const db = new Database(join(homedir(), ".zcode", "v2", "tasks-index.sqlite"), { readonly: true });
    const dayAgo = Date.now() - 86_400_000;
    const counts = Object.fromEntries((db.query(`SELECT status, COUNT(*) n FROM off_peak_tasks GROUP BY status`).all() as { status: string; n: number }[]).map((r) => [r.status, r.n]));
    const today = (db.query(`SELECT COUNT(*) n FROM off_peak_tasks WHERE queued_at > ?`).get(dayAgo) as { n: number }).n;
    db.close();
    snap.idle_tasks = {
      indexStatuses: counts,
      createdLast24h: today,
      observedAllowance: "~3 creates / 24h (from our refusal history — observational, not official)",
      quotaEndpoint: "none on this build (v4/offPeak/lifecycle Method-not-found; offPeak/list not routed)",
    };
  } catch { snap.idle_tasks = { indexStatuses: "unavailable (no tasks-index.sqlite)" }; }
  try {
    const qdb = new Database(join(homedir(), ".local", "state", "zcode-tui", "queue", "queue.sqlite3"), { readonly: true });
    const rs = qdb.query(`SELECT route, cooldown_until, cooldown_reason FROM route_state WHERE cooldown_until > ?`).all(Date.now()) as { route: string; cooldown_until: number; cooldown_reason: string }[];
    qdb.close();
    if (rs.length) snap.idle_tasks.knownCooldowns = rs.map((r) => ({ route: r.route, until: new Date(r.cooldown_until).toISOString(), reason: r.cooldown_reason.slice(0, 120) }));
  } catch { /* no queue state on this host */ }

  if (values.json) {
    console.log(JSON.stringify(snap, null, 1));
    return;
  }
  const cp = snap.coding_plan as Record<string, any>;
  console.log("=== Z.AI Coding Plan ===");
  for (const [k, v] of Object.entries(cp.entitlements as Record<string, any> ?? {}))
    console.log(`  ${k.padEnd(30)} ${v.status}${v.reason ? ` (${v.reason})` : ""}`);
  const t = cp.telemetry as Record<string, any> ?? {};
  if (t.error) console.log(`  telemetry: ERROR ${t.error}`);
  else {
    console.log(`  tokens(${t.range}): ${(t.totalTokens / 1e9).toFixed(2)}B  cache-hit ${(100 * t.cacheHitRate).toFixed(1)}%  sessions ${t.sessions}  active-days ${t.activeDays}`);
    console.log(`  latest day: ${t.latestDay?.date} = ${((t.latestDay?.tokens ?? 0) / 1e6).toFixed(1)}M tokens (${Object.entries(t.latestDay?.byModel ?? {}).map(([m, n]) => `${m} ${(Number(n) / 1e6).toFixed(1)}M`).join(", ")})`);
    console.log(`  peak window: ${t.peakWindowNow ? `ACTIVE — ends in ${t.minutesToPeakEnd}m` : `clear — next in ${t.minutesToPeak}m (Mon-Fri 11:30-15:30 IST)`}`);
  }
  console.log(`  quota windows: ${t.quotaWindows ?? "?"}`);
  console.log("=== Idle-time (off-peak) tasks ===");
  const it = snap.idle_tasks as Record<string, any>;
  console.log(`  index: ${JSON.stringify(it.indexStatuses)}  created-24h: ${it.createdLast24h}`);
  console.log(`  allowance: ${it.observedAllowance}`);
  if (it.knownCooldowns?.length)
    for (const c of it.knownCooldowns) console.log(`  cooldown: ${c.route} until ${c.until} (${c.reason})`);
  else console.log("  cooldown: none known");
  console.log("=== AutoClaw Credits plan ===");
  console.log(`  ${snap.autoclaw.note}`);
}

if (import.meta.main) await main();
