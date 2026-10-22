// Queue tests — policy math (peak window IST, cooldown parser, backoff
// ladder) + dispatcher state machine with a fake spawner and fake clock.
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseCooldownMs, backoffMs, isPeak, minutesToPeak, minutesToPeakEnd, maxRunMinutes,
  classifyFailure, ROUTES, type RouteName,
} from "./core";
import { QueueServer, openDb, buildCommand, type SpawnFn } from "../bin/queue";

// 2026-10-26 is a Monday; IST = UTC+5:30 → 11:30 IST == 06:00 UTC.
const mon = (hUtc: number, mUtc = 0) => new Date(Date.UTC(2026, 9, 26, hUtc, mUtc));
const sat = (hUtc: number, mUtc = 0) => new Date(Date.UTC(2026, 9, 24, hUtc, mUtc)); // Saturday
const fri = (hUtc: number, mUtc = 0) => new Date(Date.UTC(2026, 9, 23, hUtc, mUtc)); // Friday

describe("peak window (IST, Mon-Fri 11:30-15:30)", () => {
  test("boundaries", () => {
    expect(isPeak("zai-coding-plan", mon(5, 59))).toBe(false);  // 11:29 IST
    expect(isPeak("zai-coding-plan", mon(6, 0))).toBe(true);    // 11:30 IST
    expect(isPeak("zai-coding-plan", mon(9, 59))).toBe(true);   // 15:29 IST
    expect(isPeak("zai-coding-plan", mon(10, 0))).toBe(false);  // 15:30 IST
  });
  test("weekends and exempt routes", () => {
    expect(isPeak("zai-coding-plan", sat(7))).toBe(false);
    expect(isPeak("autoclaw", mon(7))).toBe(true);
    expect(isPeak("opencode-free", mon(7))).toBe(false);
    expect(isPeak("zai-offpeak", mon(7))).toBe(false);
    expect(isPeak("codex", mon(7))).toBe(false);
  });
  test("minutesToPeak / minutesToPeakEnd", () => {
    expect(minutesToPeak(mon(3, 30))).toBe(150);  // 09:00 IST → 11:30
    expect(minutesToPeak(mon(7))).toBe(0);        // 12:30 IST, inside peak
    expect(minutesToPeakEnd(mon(7, 30))).toBe(150); // 13:00 IST → 15:30
    // Friday 16:00 IST → Monday 11:30 IST = 67.5h
    expect(minutesToPeak(fri(10, 30))).toBe(67 * 60 + 30);
    // Saturday 09:00 IST → Monday 11:30 IST = 50.5h
    expect(minutesToPeak(sat(3, 30))).toBe(2 * 24 * 60 + 150);
  });
  test("maxRunMinutes mirrors the policy module", () => {
    expect(maxRunMinutes("zai-coding-plan", mon(3, 30))).toBe(145); // 150-5 margin
    expect(maxRunMinutes("zai-coding-plan", mon(5, 40))).toBe(0);   // 10min to peak < floor
    expect(maxRunMinutes("zai-coding-plan", mon(7))).toBe(0);       // in peak
    expect(maxRunMinutes("opencode-free", mon(7))).toBe(0);         // not gated: 0 means n/a
  });
});

describe("parseCooldownMs (refusal messages)", () => {
  test("ZCode free-tier refusal", () => {
    expect(parseCooldownMs("Free tier limit reached. You can create another task in 4 hr 38 min."))
      .toBe((4 * 60 + 38) * 60_000);
  });
  test("variants", () => {
    expect(parseCooldownMs("try again in 2 hours 5 minutes")).toBe(125 * 60_000);
    expect(parseCooldownMs("retry in 90 min")).toBe(90 * 60_000);
    expect(parseCooldownMs("back in 45s")).toBe(45_000);
    expect(parseCooldownMs("wait in 3 hr")).toBe(3 * 3_600_000);
    expect(parseCooldownMs("cooldown 4 hr 38 min applies")).toBe(278 * 60_000);
    expect(parseCooldownMs("nothing to parse here")).toBeNull();
  });
});

describe("backoff ladder 30/60/120s + jitter", () => {
  test("bounds", () => {
    for (let i = 0; i < 50; i++) {
      const b1 = backoffMs(1), b2 = backoffMs(2), b3 = backoffMs(3), b4 = backoffMs(4);
      if (b1 < 30_000 || b1 >= 45_000) throw new Error(`b1 ${b1}`);
      if (b2 < 60_000 || b2 >= 75_000) throw new Error(`b2 ${b2}`);
      if (b3 < 120_000 || b3 >= 135_000) throw new Error(`b3 ${b3}`);
      if (b4 < 120_000 || b4 >= 135_000) throw new Error(`b4 ${b4}`);
    }
  });
});

describe("classifyFailure", () => {
  const t0 = 1_700_000_000_000;
  test("refusal with cooldown", () => {
    const p = classifyFailure("Free tier limit reached. You can create another task in 1 hr 30 min.", 1, 3, t0);
    expect(p.kind).toBe("cooldown");
    expect(p.cooldownMs).toBe(90 * 60_000);
    expect(p.next_eligible_at).toBe(t0 + 90 * 60_000 + 60_000);
  });
  test("quota without parseable time retries", () => {
    expect(classifyFailure("quota exhausted for today", 1, 3, t0).kind).toBe("retry");
  });
  test("strong usage limit without time parks the route (heuristic)", () => {
    const p = classifyFailure("Error: Free usage limit reached. Connect a provider or subscribe to keep going.", 1, 3, t0);
    expect(p.kind).toBe("cooldown");
    expect(p.cooldownMs).toBe(3 * 3_600_000);
  });
  test("service-transient refusal parks the route 2h", () => {
    const p = classifyFailure("idle create: last tool error: {\"error\":{\"message\":\"Cannot verify whether this session already has a pending idle-time task; try again later.\"}}", 1, 3, t0);
    expect(p.kind).toBe("cooldown");
    expect(p.cooldownMs).toBe(2 * 3_600_000);
  });
  test("auth is terminal", () => {
    expect(classifyFailure("Error: invalid api key", 1, 3, t0).kind).toBe("auth");
  });
  test("cap", () => {
    expect(classifyFailure("boom", 3, 3, t0).kind).toBe("terminal-cap");
    expect(classifyFailure("boom", 1, 3, t0).kind).toBe("retry");
  });
});

// ---------------------------------------------------------------------------
// Dispatcher state machine (fake spawner + fake clock)
// ---------------------------------------------------------------------------

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ztq-test-")); });

function makeServer(spawnFn: SpawnFn, now: () => number, routes: RouteName[] = ["opencode-free", "codex", "zai-coding-plan", "zai-offpeak"]) {
  const db = openDb(dir);
  const srv = new QueueServer(db, {
    pollMs: 1000, metricsMs: 60_000, stateDir: dir, dryRun: false,
    routes, spawnFn, now, log: () => {},
  });
  return { db, srv };
}

function insertTask(db: ReturnType<typeof openDb>, over: Record<string, unknown> = {}) {
  const now = 1_700_000_000_000;
  db.query(`INSERT INTO tasks (id,route,title,prompt,prompt_file,prompt_sha256,workspace,model,priority,status,
    attempts,max_attempts,next_eligible_at,created_at,updated_at,started_at,finished_at,last_error,last_exit,run_log,result_ref)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(
      String(over.id ?? "ztq-test"), String(over.route ?? "opencode-free"), String(over.title ?? "t"), "do the thing",
      "/tmp/p.md", "x", "/tmp", String(over.model ?? ""), 100, "queued",
      Number(over.attempts ?? 0), Number(over.max_attempts ?? 3), Number(over.next_eligible_at ?? 0),
      now, now, null, null, "", null, "", "",
    );
}

const fakeSpawn = (rc: number, out: string): SpawnFn =>
  async () => ({ code: rc, signal: null, stdout: out, stderr: "", timedOut: false });

describe("QueueServer state machine", () => {
  test("success completes and is never re-dispatched", async () => {
    const { db, srv } = makeServer(fakeSpawn(0, "ok"), () => 1_700_000_000_000);
    insertTask(db);
    await srv.tick();
    const row = db.query(`SELECT status, result_ref, attempts FROM tasks`).get() as { status: string; result_ref: string; attempts: number };
    expect(row.status).toBe("completed");
    expect(row.attempts).toBe(1);
    await srv.tick(); // nothing pending — no error, no re-dispatch
    const n = db.query(`SELECT COUNT(*) n FROM tasks WHERE status='completed'`).get() as { n: number };
    expect(n.n).toBe(1);
  });

  test("three failures → terminal failed; terminal never retried", async () => {
    const { db, srv } = makeServer(fakeSpawn(1, "error: boom"), () => 1_700_000_000_000);
    insertTask(db);
    for (let i = 0; i < 3; i++) {
      await srv.tick();
      await new Promise((r) => setTimeout(r, 20)); // let the fire-and-forget dispatch land
      db.query(`UPDATE tasks SET next_eligible_at=0 WHERE status='retry_wait'`).run();
    }
    const row = db.query(`SELECT status, attempts FROM tasks`).get() as { status: string; attempts: number };
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(3);
    await srv.tick();
    expect((db.query(`SELECT COUNT(*) n FROM tasks WHERE status='failed'`).get() as { n: number }).n).toBe(1);
  });

  test("refusal cooldown parks the route and does not burn attempts", async () => {
    const { db, srv } = makeServer(fakeSpawn(3, "Free tier limit reached. You can create another task in 1 hr 30 min."), () => 1_700_000_000_000);
    insertTask(db, { route: "zai-offpeak" });
    await srv.tick();
    const row = db.query(`SELECT status, attempts FROM tasks`).get() as { status: string; attempts: number };
    expect(row.status).toBe("cooldown_wait");
    expect(row.attempts).toBe(0); // net zero — the refusal is not the task's fault
    const rs = db.query(`SELECT cooldown_until FROM route_state WHERE route='zai-offpeak'`).get() as { cooldown_until: number };
    expect(rs.cooldown_until).toBeGreaterThan(1_700_000_000_000 + 90 * 60_000);
    await srv.tick(); // still parked
    expect((db.query(`SELECT COUNT(*) n FROM tasks WHERE status='cooldown_wait'`).get() as { n: number }).n).toBe(1);
  });

  test("one in-flight dispatch per route; routes parallelize", async () => {
    let busy = 0, maxBusy = 0;
    const slow: SpawnFn = async () => {
      busy++; maxBusy = Math.max(maxBusy, busy);
      await new Promise((r) => setTimeout(r, 200));
      busy--;
      return { code: 0, signal: null, stdout: "", stderr: "", timedOut: false };
    };
    const { db, srv } = makeServer(slow, () => 1_700_000_000_000);
    insertTask(db, { id: "a", route: "opencode-free" });
    insertTask(db, { id: "b", route: "opencode-free" });
    insertTask(db, { id: "c", route: "codex" });
    await srv.tick(); // a and c dispatch concurrently; b waits (same route as a)
    await new Promise((r) => setTimeout(r, 250));
    const st = db.query(`SELECT id,status FROM tasks ORDER BY id`).all() as { id: string; status: string }[];
    const m = Object.fromEntries(st.map((r) => [r.id, r.status]));
    expect(m["a"]).toBe("completed");
    expect(m["c"]).toBe("completed");
    expect(m["b"]).toBe("queued"); // one in-flight per route held it back
    await srv.tick(); // b's turn
    await new Promise((r) => setTimeout(r, 250));
    expect((db.query(`SELECT status FROM tasks WHERE id='b'`).get() as { status: string }).status).toBe("completed");
    expect(maxBusy).toBe(2); // a+c overlapped; b never overlapped a
  });

  test("peak window defers zai-coding-plan but not opencode-free", async () => {
    // Monday 13:00 IST — inside the peak window
    const { db, srv } = makeServer(fakeSpawn(0, "ok"), () => Date.UTC(2026, 9, 26, 7, 30), ["zai-coding-plan", "opencode-free"]);
    insertTask(db, { id: "z", route: "zai-coding-plan" });
    insertTask(db, { id: "o", route: "opencode-free" });
    await srv.tick();
    const m = Object.fromEntries((db.query(`SELECT id,status FROM tasks`).all() as { id: string; status: string }[]).map((r) => [r.id, r.status]));
    expect(m["z"]).toBe("queued");
    expect(m["o"]).toBe("completed");
  });

  test("zai-offpeak success requires the ZT-IDLE-CREATE marker", async () => {
    const { db, srv } = makeServer(fakeSpawn(0, 'ZT-IDLE-CREATE {"ok":true,"offPeakTaskId":"offpeak-abc","queuePosition":2}'), () => 1_700_000_000_000);
    insertTask(db, { route: "zai-offpeak" });
    await srv.tick();
    const row = db.query(`SELECT status, result_ref FROM tasks`).get() as { status: string; result_ref: string };
    expect(row.status).toBe("completed");
    expect(row.result_ref).toBe("offpeak-abc");
  });

  test("zai-offpeak rc0 without marker retries (honest success check)", async () => {
    const { db, srv } = makeServer(fakeSpawn(0, "nothing relevant"), () => 1_700_000_000_000);
    insertTask(db, { route: "zai-offpeak" });
    await srv.tick();
    expect((db.query(`SELECT status FROM tasks`).get() as { status: string }).status).toBe("retry_wait");
  });

  test("stale running rows are reclaimed on boot", () => {
    const { db, srv } = makeServer(fakeSpawn(0, "ok"), () => 1_700_000_000_000 + 60 * 60_000);
    insertTask(db, { attempts: 1, status: "running" });
    db.query(`UPDATE tasks SET updated_at=? WHERE id='ztq-test'`).run(1_700_000_000_000);
    srv.reclaimStale();
    expect((db.query(`SELECT status FROM tasks`).get() as { status: string }).status).toBe("queued");
    // at cap → failed
    db.query(`UPDATE tasks SET status='running', attempts=3, updated_at=?`).run(1_700_000_000_000);
    srv.reclaimStale();
    expect((db.query(`SELECT status FROM tasks`).get() as { status: string }).status).toBe("failed");
  });

  test("autoclaw is config-ready but never dispatched", async () => {
    const { db, srv } = makeServer(fakeSpawn(0, "ok"), () => 1_700_000_000_000, ["autoclaw"]);
    insertTask(db, { route: "autoclaw" });
    await srv.tick();
    expect((db.query(`SELECT status FROM tasks`).get() as { status: string }).status).toBe("queued");
  });
});

describe("buildCommand", () => {
  test("zai-coding-plan carries the peak budget", () => {
    const cmd = buildCommand(
      { route: "zai-coding-plan" } as never,
      { repo: "/repo", stateDir: "/st", promptFile: "/st/p.md", runLog: "/st/r.json", budgetMin: 145 },
    );
    expect(cmd.cmd.join(" ")).toContain("--max-run-min 145");
    expect(cmd.cmd.join(" ")).toContain("run.ts");
  });
  test("zai-offpeak rides ssh to jojo with prompt on stdin", () => {
    const built = buildCommand(
      { route: "zai-offpeak", title: "hello", workspace: "/tmp", model: "", prompt: "do the thing" } as never,
      { repo: "/repo", stateDir: "/st", promptFile: "/st/p.md", runLog: "/st/r.json", budgetMin: 0 },
    );
    expect(built.cmd[0]).toBe("ssh");
    expect(built.cmd[1]).toBe("jojo");
    expect(built.cmd.join(" ")).toContain("idle.ts create");
    expect(built.stdin).toBe("do the thing");
  });
  test("opencode-free default model", () => {
    const built = buildCommand(
      { route: "opencode-free", model: "", workspace: "/tmp" } as never,
      { repo: "/repo", stateDir: "/st", promptFile: "/p", runLog: "/r", budgetMin: 0 },
    );
    expect(built.cmd.join(" ")).toContain("opencode/glm-5.3-flash-free");
  });
  test("route table honesty", () => {
    expect(ROUTES.autoclaw.available).toBe(false);
    expect(ROUTES["zai-coding-plan"].peakGated).toBe(true);
    expect(ROUTES["zai-offpeak"].peakGated).toBe(false);
  });
});

afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ } });
