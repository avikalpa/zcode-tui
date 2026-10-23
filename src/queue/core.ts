// Queue core — pure policy + state logic for the zcode-tui worker queue.
// Fleet law (owner 2026-10-22): Z.AI first-party subscription routes
// (zai-coding-plan, autoclaw) are NOT consumed Mon-Fri 11:30-15:30 IST
// (docs.z.ai devpack/overview: peak 1x vs off-peak 0.5x). opencode free
// tiers and codex are different funding routes and stay peak-exempt.
// zai-offpeak is the ZCode idle-time privilege: ticket creation costs no
// plan quota and the SERVER schedules the run — exempt from our gate.
import { createHash } from "node:crypto";

export type RouteName =
  | "zai-coding-plan"
  | "zai-offpeak"
  | "opencode-free"
  | "codex"
  | "autoclaw";

export const ROUTE_NAMES: RouteName[] = [
  "zai-coding-plan",
  "zai-offpeak",
  "opencode-free",
  "codex",
  "autoclaw",
];

/** Routes whose consumption burns Z.AI subscription quota at peak rate. */
export const PEAK_GATED_ROUTES: RouteName[] = ["zai-coding-plan", "autoclaw"];

export type TaskStatus =
  | "queued" // eligible as soon as its route is
  | "running" // dispatched, in flight (one per route)
  | "retry_wait" // failed, backing off 30/60/120s + jitter
  | "cooldown_wait" // refused with a server cooldown ("...in X hr Y min")
  | "completed" // terminal — never retried
  | "failed"; // terminal (attempt cap or deterministic error)

export const TERMINAL_STATUSES: TaskStatus[] = ["completed", "failed"];
export const PENDING_STATUSES: TaskStatus[] = ["queued", "retry_wait", "cooldown_wait"];

export interface TaskRow {
  id: string;
  route: RouteName;
  title: string;
  prompt: string;
  prompt_file: string;
  prompt_sha256: string;
  workspace: string;
  model: string;
  priority: number;
  status: TaskStatus;
  attempts: number;
  max_attempts: number;
  next_eligible_at: number;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  finished_at: number | null;
  last_error: string;
  last_exit: number | null;
  run_log: string;
  result_ref: string;
  expect_file: string;
}

// ---------------------------------------------------------------------------
// Peak window (IST, fixed offset — India has no DST)
// ---------------------------------------------------------------------------

export const IST_OFFSET_MIN = 330;
const PEAK_START_MIN = 11 * 60 + 30; // 11:30 IST
const PEAK_END_MIN = 15 * 60 + 30; // 15:30 IST
export const MIN_USEFUL_RUN_MIN = 20; // below this, defer instead of starting
export const PEAK_SHUTDOWN_MARGIN_MIN = 5;

function istParts(now: Date): { weekday: number; minutes: number; istMs: number } {
  const istMs = now.getTime() + IST_OFFSET_MIN * 60_000;
  const d = new Date(istMs);
  return { weekday: d.getUTCDay(), minutes: d.getUTCHours() * 60 + d.getUTCMinutes(), istMs };
}

export function isPeak(route: RouteName, now: Date = new Date()): boolean {
  if (!PEAK_GATED_ROUTES.includes(route)) return false;
  const { weekday, minutes } = istParts(now);
  if (weekday === 0 || weekday === 6) return false;
  return minutes >= PEAK_START_MIN && minutes < PEAK_END_MIN;
}

/** Minutes until the next peak window starts (0 if inside one). */
export function minutesToPeak(now: Date = new Date()): number {
  if (isPeak("zai-coding-plan", now)) return 0;
  const { minutes } = istParts(now);
  let day = minutes >= PEAK_START_MIN ? 1 : 0; // today's start already passed?
  // Advance past weekends (IST calendar days).
  while ([0, 6].includes(new Date(now.getTime() + IST_OFFSET_MIN * 60_000 + day * 86_400_000).getUTCDay())) day++;
  return day * 24 * 60 + PEAK_START_MIN - minutes;
}

/** Minutes until the current peak window ends (0 if not in peak). */
export function minutesToPeakEnd(now: Date = new Date()): number {
  if (!isPeak("zai-coding-plan", now)) return 0;
  const { minutes } = istParts(now);
  return PEAK_END_MIN - minutes;
}

/**
 * Wall-clock minutes a peak-gated run may still consume (mirrors
 * tools/zai_peak_window.py max_run_minutes): 0 = do not start now.
 */
export function maxRunMinutes(route: RouteName, now: Date = new Date()): number {
  if (isPeak(route, now)) return 0;
  const avail = minutesToPeak(now) - PEAK_SHUTDOWN_MARGIN_MIN;
  return avail >= MIN_USEFUL_RUN_MIN ? avail : 0;
}

// ---------------------------------------------------------------------------
// Failure classification
// ---------------------------------------------------------------------------

/** Parse a refusal cooldown ("...in 4 hr 38 min" / "in 90 min" / "in 45s") → ms. */
export function parseCooldownMs(text: string): number | null {
  if (!text) return null;
  const hrMin = text.match(/in\s+(\d+)\s*(?:hr|hour)s?[\s,]+(\d+)\s*(?:min|minute)s?/i);
  if (hrMin) return ((Number(hrMin[1]) * 60 + Number(hrMin[2])) * 60) * 1000;
  const hr = text.match(/in\s+(\d+)\s*(?:hr|hour)s?/i);
  if (hr) return Number(hr[1]) * 3_600_000;
  const min = text.match(/in\s+(\d+)\s*(?:min|minute)s?/i);
  if (min) return Number(min[1]) * 60_000;
  const sec = text.match(/in\s+(\d+)\s*(?:sec|second|s)s?\b/i);
  if (sec) return Number(sec[1]) * 1000;
  // Bare "4 hr 38 min" without the "in" anchor (message body variant).
  const bare = text.match(/(\d+)\s*hr[s]?[\s,]+(\d+)\s*min/i);
  if (bare) return ((Number(bare[1]) * 60 + Number(bare[2])) * 60) * 1000;
  // Gateway ISO timer ("next take at 2026-10-23T12:00:00.000Z").
  const iso = text.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)/);
  if (iso) {
    const delta = new Date(iso[1]).getTime() - Date.now();
    if (delta > 0) return delta;
  }
  return null;
}

const REFUSAL_CONTEXT = /limit|quota|tier|rate|again|cooldown|capacity|free tier|usage|throttl/i;
const STRONG_USAGE_LIMIT = /free usage limit|usage limit reached|rate limit|quota (exceeded|reached)/i;
/** Service-side transient refusals (OffPeakCreate ticket service: "Cannot
 *  verify … try again later" — measured 2026-10-23) park longer than the
 *  30/60/120s ladder; minutes-scale retries only burn dispatcher turns. */
export const SERVICE_TRANSIENT_PARK_MS = 2 * 3_600_000;
const SERVICE_TRANSIENT = /cannot verify|try again later|service is unreachable|temporarily unavailable/i;
/** Heuristic park for route-level limits that refuse without a timestamp. */
export const UNTIMED_LIMIT_PARK_MS = 3 * 3_600_000;
const AUTHISH = /auth|credential|api[ _-]?key|permission|forbidden|unauthorized|invalid model|unsupported model/i;

export type FailureKind = "cooldown" | "auth" | "retry" | "terminal-cap";

export interface FailurePlan {
  kind: FailureKind;
  next_eligible_at?: number;
  cooldownMs?: number;
  note: string;
}

/**
 * Classify a failed dispatch from its captured output tail.
 * - cooldown: refusal message with a parseable wait → defer task AND route.
 * - auth: deterministic credential/config errors → terminal, no retry.
 * - retry: transient → 30/60/120s + jitter ladder.
 * - terminal-cap: retry ladder exhausted.
 */
export function classifyFailure(
  tail: string,
  attempts: number,
  maxAttempts: number,
  nowMs: number,
): FailurePlan {
  const cd = parseCooldownMs(tail);
  if (cd !== null && cd > 0 && REFUSAL_CONTEXT.test(tail)) {
    return { kind: "cooldown", cooldownMs: cd, next_eligible_at: nowMs + cd + 60_000, note: "refusal cooldown parsed" };
  }
  if (STRONG_USAGE_LIMIT.test(tail)) {
    // Route-level exhaustion refusing WITHOUT a timestamp (measured:
    // opencode "Free usage limit reached" carries no time). Park the route
    // on a heuristic window instead of burning every queued task to cap.
    return { kind: "cooldown", cooldownMs: UNTIMED_LIMIT_PARK_MS, next_eligible_at: nowMs + UNTIMED_LIMIT_PARK_MS, note: "untimed usage limit — heuristic 3h park" };
  }
  if (SERVICE_TRANSIENT.test(tail)) {
    return { kind: "cooldown", cooldownMs: SERVICE_TRANSIENT_PARK_MS, next_eligible_at: nowMs + SERVICE_TRANSIENT_PARK_MS, note: "service-side transient — heuristic 2h park" };
  }
  if (AUTHISH.test(tail)) {
    return { kind: "auth", note: "deterministic auth/config error — no retry" };
  }
  if (attempts >= maxAttempts) {
    return { kind: "terminal-cap", note: `attempt cap ${maxAttempts} reached` };
  }
  return { kind: "retry", next_eligible_at: nowMs + backoffMs(attempts), note: "backoff" };
}

/** 30/60/120s (by attempt number, 1-indexed) + up to 15s jitter. */
export function backoffMs(attempt: number): number {
  const ladder = [30_000, 60_000, 120_000];
  const base = ladder[Math.min(Math.max(attempt, 1), ladder.length) - 1];
  return base + Math.floor(Math.random() * 15_000);
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

// ---------------------------------------------------------------------------
// Route definitions (executors live in the serve command; this is policy)
// ---------------------------------------------------------------------------

export interface RouteDef {
  name: RouteName;
  desc: string;
  peakGated: boolean;
  available: boolean;
  unavailableReason?: string;
  defaultModel?: string;
  /** Idle-ticket creation must land where a polling runtime executes them. */
  remoteHost?: "jojo";
  /** Hard dispatch timeout, minutes (route default; serve may override). */
  taskTimeoutMin: number;
  /** run.ts budget-stop exit (4) semantics apply. */
  budgetStopExit?: number;
}

export const ROUTES: Record<RouteName, RouteDef> = {
  "zai-coding-plan": {
    name: "zai-coding-plan",
    desc: "zcode-tui run sessions on the Z.AI Coding Plan (credit-metered)",
    peakGated: true,
    available: true,
    taskTimeoutMin: 60,
    budgetStopExit: 4,
  },
  "zai-offpeak": {
    name: "zai-offpeak",
    desc: "ZCode idle-time tasks via the OffPeakCreate tool (free off-peak privilege; server-scheduled)",
    peakGated: false, // zero plan-quota cost; the server owns the schedule
    available: true,
    remoteHost: "jojo", // jojo's task index + desktop execute queued tickets
    taskTimeoutMin: 15,
  },
  "opencode-free": {
    name: "opencode-free",
    desc: "opencode CLI free tier (peak-exempt) — primary dream volume",
    peakGated: false,
    available: true,
    defaultModel: "opencode/glm-5.3-flash-free",
    taskTimeoutMin: 30,
  },
  codex: {
    name: "codex",
    desc: "codex exec spillover (peak-exempt)",
    peakGated: false,
    available: true,
    taskTimeoutMin: 45,
  },
  autoclaw: {
    name: "autoclaw",
    desc: "AutoClaw credits plane (config-ready)",
    peakGated: true,
    available: false,
    unavailableReason:
      "provider absent from the app-server model registry (workspace/readState shows zai/* Coding Plan entries only, measured 2026-10-22) — upstream ask open",
    taskTimeoutMin: 60,
  },
};

// ---------------------------------------------------------------------------
// SQLite schema (bun:sqlite, WAL — crash-safe; serve reclaims stale runs)
// ---------------------------------------------------------------------------

export const SCHEMA_SQL = `
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  route TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL,
  prompt_file TEXT NOT NULL,
  prompt_sha256 TEXT NOT NULL,
  workspace TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  priority INTEGER NOT NULL DEFAULT 100,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  next_eligible_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  last_error TEXT NOT NULL DEFAULT '',
  last_exit INTEGER,
  run_log TEXT NOT NULL DEFAULT '',
  result_ref TEXT NOT NULL DEFAULT '',
  expect_file TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_tasks_route_status ON tasks(route, status, next_eligible_at);
CREATE TABLE IF NOT EXISTS route_state (
  route TEXT PRIMARY KEY,
  cooldown_until INTEGER NOT NULL DEFAULT 0,
  cooldown_reason TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`;
