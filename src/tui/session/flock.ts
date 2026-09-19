// Ported from opencode v2.0.8 packages/util/src/flock.ts (Flock.withLock).
// Adaptations, per this TUI's dependency plane: the reference leans on the
// `effect` runtime and its Hash util — both dropped. The lock is a
// mkdir-based critical section keeping the reference's breaker pattern
// (single contender cleans a stale lock) and its 60s mtime staleness for
// crashed owners; the reference also writes a heartbeat file, which a
// sub-millisecond critical section here does not need. The wait is
// synchronous with a small bounded budget (default 500ms) because our
// callers are UI event handlers, not server tasks — on budget exhaustion
// the critical section runs UNLOCKED (the pre-port behaviour) instead of
// freezing the render loop; writeJsonAtomic-style rename keeps the file
// valid either way.

import { mkdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

export interface FlockOptions {
  dir?: string;
  staleMs?: number;
  timeoutMs?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

const DEFAULTS = {
  staleMs: 60_000,
  timeoutMs: 500,
  baseDelayMs: 20,
  maxDelayMs: 100,
};

function code(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "code" in err) {
    const value = (err as { code?: unknown }).code;
    if (typeof value === "string") return value;
  }
  return undefined;
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function stale(lockDir: string, staleMs: number): boolean {
  try {
    return Date.now() - statSync(lockDir).mtimeMs > staleMs;
  } catch {
    return false; // vanished between EEXIST and stat — treat as held
  }
}

function backoff(base: number, max: number): number {
  // The reference jitters ±30% around the exponential step.
  const step = Math.min(max, base * 2);
  const jitter = Math.floor(step * 0.3);
  return step + Math.floor(Math.random() * (2 * jitter + 1)) - jitter;
}

export function withLockSync<T>(filePath: string, fn: () => T, options: FlockOptions = {}): T {
  const opts = { ...DEFAULTS, ...options };
  const lockDir = path.join(
    options.dir ?? path.join(path.dirname(filePath), "locks"),
    `${path.basename(filePath)}.lock`,
  );
  const breakerPath = `${lockDir}.breaker`;
  let lockParentReady = false;
  const deadline = Date.now() + opts.timeoutMs;
  let delay = opts.baseDelayMs;
  for (;;) {
    try {
      // The locks/ parent cannot be assumed to exist — a cleaned (or
      // first-run) config dir made every locked write throw ENOENT
      // (measured 2026-09-19: the model dialog's enter-select died before
      // closeDialog and cascade-failed the harness). Ensure it recursively,
      // ONCE, outside the EEXIST probe: mkdirSync(recursive) never throws
      // EEXIST, so the lock dir itself must stay non-recursive or the
      // contention signal is lost.
      if (!lockParentReady) {
        mkdirSync(path.dirname(lockDir), { recursive: true, mode: 0o700 });
        lockParentReady = true;
      }
      mkdirSync(lockDir, { mode: 0o700 });
    } catch (err) {
      if (code(err) !== "EEXIST") throw err;
      if (!stale(lockDir, opts.staleMs)) {
        if (Date.now() >= deadline) return fn(); // budget out — unlocked fallback
        sleepSync(delay);
        delay = backoff(opts.baseDelayMs, opts.maxDelayMs);
        continue;
      }
      // Stale lock: only one contender may clean it — the breaker owns that.
      try {
        mkdirSync(breakerPath, { mode: 0o700 });
      } catch (claimErr) {
        if (code(claimErr) !== "EEXIST") throw claimErr;
        if (stale(breakerPath, opts.staleMs)) {
          rmSync(breakerPath, { recursive: true, force: true });
        }
        if (Date.now() >= deadline) return fn();
        sleepSync(delay);
        delay = backoff(opts.baseDelayMs, opts.maxDelayMs);
        continue;
      }
      // Breaker owned: re-verify staleness, then recover the lock dir.
      if (stale(lockDir, opts.staleMs)) {
        rmSync(lockDir, { recursive: true, force: true });
      }
      rmSync(breakerPath, { recursive: true, force: true });
      continue; // race the re-mkdir on the next turn
    }
    try {
      return fn();
    } finally {
      rmSync(lockDir, { recursive: true, force: true });
    }
  }
}
