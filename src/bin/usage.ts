// zcode-tui usage — per-plan quota windows, reset tokens, consumption (unofficial client).
//
//   zcode-tui usage [--range all|7d|30d] [--json]
//   zcode-tui usage --reset-opportunity            # ask z.ai for a grant window
//   zcode-tui usage --reset-use 5h|week [--idem KEY] [--yes]   # apply an owned reset token
//
// Live surfaces (mined from the user's ZCode desktop bundle + validated live
// 2026-10-25 — see src/zcode/plan-quota.ts for the wire contracts):
// - coding-plan quota windows (5h + week) with resets-at timestamps
// - owned reset tokens (the erratic custom gifts) — listed, and APPLIABLE
//   here: the desktop's "Get N reset quotas" flow, on our terms
// - AutoClaw credits (managed-plane wallet read through the mined plan)
// - off-peak ticket plane availability
import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { Database } from "bun:sqlite";
import { AppServer } from "../protocol/client";
import { isPeak, minutesToPeak, minutesToPeakEnd } from "../queue/core";
import { planExists, readPlan } from "../autoclaw/plan";
import { fetchCreditsBalance } from "../autoclaw/gateway";
import {
  codingPlanQuota, resetStatus, resetUse, resetOpportunity, type ResetKind,
} from "../zcode/plan-quota";
import { ticketAvailability } from "../queue/offpeak-gateway";

function bar(usedPct: number, width = 24): string {
  const used = Math.max(0, Math.min(100, Math.round(usedPct)));
  const on = Math.round((used / 100) * width);
  return "█".repeat(on) + "░".repeat(width - on);
}

function resetsIn(ms: number): string {
  const min = Math.max(0, Math.round((ms - Date.now()) / 60000));
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60), m = min % 60;
  if (h < 48) return `${h}h ${m}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function fmtTokens(n: number | undefined): string {
  if (n === undefined || Number.isNaN(n)) return "?";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  return `${n}`;
}

async function main() {
  const { values } = parseArgs({
    allowPositionals: true,
    options: {
      range: { type: "string", default: "7d" },
      json: { type: "boolean", default: false },
      "reset-opportunity": { type: "boolean", default: false },
      "reset-use": { type: "string" },
      idem: { type: "string" },
      yes: { type: "boolean", default: false },
    },
  });
  const range = ["all", "7d", "30d"].includes(String(values.range)) ? String(values.range) : "7d";

  // ---- reset actions (explicit, before the read-only report) --------------
  if (values["reset-opportunity"] || values["reset-use"]) {
    const idem = String(values.idem ?? `ztq-${Date.now().toString(36)}`);
    if (values["reset-opportunity"]) {
      const r = await resetOpportunity(idem);
      if ("error" in r) { console.error(`usage: reset opportunity FAILED: ${r.error}`); process.exit(1); }
      console.log(r.granted
        ? `reset opportunity GRANTED (idem ${idem}) — a new token should appear in reset status`
        : `not granted — server says try again at ${r.nextTryAt ? new Date(r.nextTryAt).toLocaleString() : "later"}`);
      process.exit(0);
    }
    const kindRaw = String(values["reset-use"]);
    const kind: ResetKind | null = kindRaw === "5h" ? "fiveHour" : kindRaw === "week" ? "week" : null;
    if (!kind) { console.error("usage: --reset-use takes 5h or week"); process.exit(2); }
    const before = await resetStatus();
    if ("error" in before) { console.error(`usage: cannot read reset status: ${before.error}`); process.exit(1); }
    const owned = kind === "fiveHour" ? before.availableFiveHour.length : before.availableWeek.length;
    if (owned === 0) { console.error(`usage: no ${kindRaw} reset tokens owned — try --reset-opportunity`); process.exit(1); }
    if (!values.yes) {
      console.log(`about to APPLY one ${kindRaw} reset token (${owned} owned, ${owned - 1} will remain).`);
      console.log(`re-run with --yes to confirm (idempotency key: ${idem}).`);
      process.exit(0);
    }
    const r = await resetUse(kind, idem);
    if ("error" in r) { console.error(`usage: reset apply FAILED: ${r.error} (retry with the SAME --idem ${idem} if ambiguous)`); process.exit(1); }
    const after = await resetStatus();
    const left = "error" in after ? "?" : String((kind === "fiveHour" ? after.availableFiveHour.length : after.availableWeek.length));
    console.log(`reset APPLIED (${kindRaw}) — used:${r.used}, ${left} ${kindRaw} tokens remain. Quota windows refresh server-side immediately.`);
    process.exit(0);
  }

  // ---- read-only report ----------------------------------------------------
  const quota = await codingPlanQuota();
  const resets = await resetStatus();
  const plan = planExists() ? readPlan() : null;
  const credits = plan ? await fetchCreditsBalance(plan).catch(() => null) : null;
  const creditsOk = credits !== null && "ok" in credits && credits.ok ? credits : null;
  const creditsErr = credits !== null && "ok" in credits && !credits.ok ? credits.failure : null;
  const idleAvail = await ticketAvailability().catch(() => null);

  // live telemetry from the runtime (consumption, not quota)
  let telemetry: Record<string, unknown> = {};
  const sv = new AppServer({}, { onStderr: () => {} });
  try {
    const res = (await sv.request("usage/stats", { range }, 30000)) as Record<string, any>;
    const s = res.summary ?? {};
    telemetry = {
      range,
      totalTokens: s.totalTokens,
      cacheHitRate: s.cacheHitRate,
      sessions: s.totalSessions,
      activeDays: s.activeDays,
      favoriteModel: s.favoriteModel?.modelId,
    };
  } catch (e) {
    telemetry = { error: e instanceof Error ? e.message : String(e) };
  } finally {
    try { await sv.close(); } catch { /* already closed */ }
  }

  let idleIndex: Record<string, unknown> = {};
  try {
    const db = new Database(join(homedir(), ".zcode", "v2", "tasks-index.sqlite"), { readonly: true });
    const counts = Object.fromEntries((db.query(`SELECT status, COUNT(*) n FROM off_peak_tasks GROUP BY status`).all() as { status: string; n: number }[]).map((r) => [r.status, r.n]));
    db.close();
    idleIndex = counts;
  } catch { idleIndex = { note: "no tasks-index on this host" }; }

  if (values.json) {
    console.log(JSON.stringify({ quota, resets, autoclaw: creditsOk?.credits ?? creditsErr ?? null, offpeak: { availability: idleAvail, index: idleIndex }, telemetry, peakWindow: { active: isPeak("zai-coding-plan"), minutesToPeakEnd: minutesToPeakEnd() } }, null, 1));
    return;
  }

  console.log("=== Z.AI Coding Plan ===");
  if ("error" in quota) console.log(`  quota windows: UNREADABLE — ${quota.error}`);
  else {
    console.log(`  level: [${quota.level ?? "?"}]`);
    for (const w of quota.windows) {
      const left = 100 - w.percentageUsed;
      console.log(`  ${w.window.padEnd(5)} ${bar(w.percentageUsed)}  ${left}% left · used ${fmtTokens(w.currentValue)}/${fmtTokens(w.usage + w.currentValue)} · resets in ${resetsIn(w.nextResetTime)} (${new Date(w.nextResetTime).toLocaleTimeString()})`);
    }
  }
  if ("error" in resets) console.log(`  reset tokens: UNREADABLE — ${resets.error}`);
  else {
    console.log(`  reset tokens: 5h ×${resets.availableFiveHour.length}${resets.availableFiveHour.length ? ` (nearest expires ${resetsIn(Math.min(...resets.availableFiveHour))})` : ""} · week ×${resets.availableWeek.length}`);
    console.log(`  apply: zcode-tui usage --reset-use 5h|week (--yes to confirm) · ask for more: --reset-opportunity`);
  }
  const t = telemetry as Record<string, any>;
  console.log(`  telemetry(${range}): ${t.error ? `ERROR ${t.error}` : `${fmtTokens(t.totalTokens)} tok · cache-hit ${(100 * (t.cacheHitRate ?? 0)).toFixed(1)}% · sessions ${t.sessions} · favorite ${t.favoriteModel ?? "?"}`}`);
  console.log(`  peak window: ${isPeak("zai-coding-plan") ? `ACTIVE — ends in ${minutesToPeakEnd()}m` : `clear — next in ${minutesToPeak()}m (Mon-Fri 11:30-15:30 IST)`}`);

  console.log("=== AutoClaw credits ===");
  if (!planExists()) console.log("  no plan file on this host (zcode-tui autoclaw setup / sync)");
  else if (creditsErr) console.log(`  wallet read failed: ${JSON.stringify(creditsErr).slice(0, 120)}`);
  else if (creditsOk) console.log(`  ${creditsOk.credits.totalPoints.toLocaleString()} credits left · wallets: ${creditsOk.credits.wallets.map((w) => `${w.scope || "main"} ${w.balance.toLocaleString()}`).join(", ") || "n/a"}`);
  else console.log("  wallet read failed (see autoclaw doctor)");

  console.log("=== Idle-time (off-peak) ===");
  console.log(`  index: ${JSON.stringify(idleIndex)}`);
  console.log(`  gateway: ${idleAvail ? (((idleAvail as { canCreateNow?: boolean }).canCreateNow === true) ? "CAN CREATE NOW" : idleAvail.nextTakeAt ? `cooldown — unlocks ${new Date(idleAvail.nextTakeAt).toLocaleTimeString()} (in ${Math.max(0, Math.round((idleAvail.nextTakeAt - Date.now()) / 60000))}m)` : `unavailable ${idleAvail.error ?? ""}`) : "availability unreachable"}`);
}

if (import.meta.main) await main();
