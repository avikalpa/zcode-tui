// queue rm — task cancellation semantics (fleet ledger hygiene).
import { describe, test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdEnqueue } from "../src/bin/queue";
import { SCHEMA_SQL, rmTask, type TaskRow } from "../src/queue/core";

function freshDb(): Database {
  const db = new Database(":memory:");
  db.run("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA_SQL);
  return db;
}

let seq = 0;
function insertTask(db: Database, status: TaskRow["status"], id?: string): string {
  const now = Date.now();
  const tid = id ?? `ztq-test-${++seq}`;
  db.query(`INSERT INTO tasks (id,route,title,prompt,prompt_file,prompt_sha256,workspace,model,priority,status,
    attempts,max_attempts,next_eligible_at,created_at,updated_at,started_at,finished_at,last_error,last_exit,run_log,result_ref,expect_file)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(tid, "codex", "t", "p", "/f", "sha", "/w", "", 100, status, 0, 3,
      now, now, now, status === "running" ? now : null, (status === "completed" || status === "failed") ? now : null,
      "", null, "", "", "");
  return tid;
}

describe("queue rm", () => {
  test("cancels a queued task", () => {
    const db = freshDb();
    const id = insertTask(db, "queued");
    const r = rmTask(db, id);
    expect(r.ok).toBe(true);
    const row = db.query("SELECT status, last_error, finished_at FROM tasks WHERE id=?").get(id) as Record<string, unknown>;
    expect(row.status).toBe("cancelled");
    expect(row.last_error).toBe("cancelled via queue rm");
    expect(row.finished_at).toBeGreaterThan(0);
  });

  test("cancels retry_wait and cooldown_wait tasks", () => {
    const db = freshDb();
    for (const st of ["retry_wait", "cooldown_wait"] as const) {
      const id = insertTask(db, st);
      expect(rmTask(db, id).ok).toBe(true);
      expect((db.query("SELECT status FROM tasks WHERE id=?").get(id) as { status: string }).status).toBe("cancelled");
    }
  });

  test("refuses a running task", () => {
    const db = freshDb();
    const id = insertTask(db, "running");
    const r = rmTask(db, id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("running");
    expect((db.query("SELECT status FROM tasks WHERE id=?").get(id) as { status: string }).status).toBe("running");
  });

  test("refuses completed, failed and already-cancelled tasks", () => {
    const db = freshDb();
    for (const st of ["completed", "failed", "cancelled"] as const) {
      const id = insertTask(db, st);
      const r = rmTask(db, id);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("terminal");
    }
  });

  test("unknown id reports unknown (CLI exits 2)", () => {
    const db = freshDb();
    const r = rmTask(db, "ztq-nope");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown");
  });
});

describe("queue enqueue --eligible-at (dispatch-hardening)", () => {
  test("future eligibility is stored and reported", () => {
    const db = freshDb();
    const pf = join(tmpdir(), `ztq-elig-${Date.now()}.md`);
    writeFileSync(pf, "eligible-at probe body\n");
    const at = Date.now() + 3_600_000;
    cmdEnqueue(db, { route: "codex", "prompt-file": pf, workspace: "/w", title: "elig test", "eligible-at": String(at) });
    const row = db.query("SELECT next_eligible_at, status FROM tasks WHERE title='elig test'").get() as Record<string, unknown>;
    expect(row.status).toBe("queued");
    expect(Number(row.next_eligible_at)).toBe(at);
    rmSync(pf);
  });
  test("ISO-8601 strings parse", () => {
    const db = freshDb();
    const pf = join(tmpdir(), `ztq-elig-iso-${Date.now()}.md`);
    writeFileSync(pf, "iso body\n");
    cmdEnqueue(db, { route: "codex", "prompt-file": pf, workspace: "/w", title: "elig iso", "eligible-at": "2030-01-01T00:00:00Z" });
    const row = db.query("SELECT next_eligible_at FROM tasks WHERE title='elig iso'").get() as Record<string, unknown>;
    expect(Number(row.next_eligible_at)).toBe(Date.parse("2030-01-01T00:00:00Z"));
    rmSync(pf);
  });
});

describe("queue CLI surface (dispatch-hardening)", () => {
  test("enqueue --eligible-at parses end-to-end through the real CLI", () => {
    const dir = mkdtempSync(join(tmpdir(), "ztq-cli-"));
    const pf = join(dir, "brief.md");
    writeFileSync(pf, "cli surface body\n");
    const at = Date.now() + 7_200_000;
    const p = Bun.spawnSync(["bun", "run", "src/bin/queue.ts", "enqueue",
      "--route", "codex", "--prompt-file", pf, "--workspace", dir,
      "--title", "cli-elig", "--eligible-at", String(at),
      "--state-dir", join(dir, "state")], { cwd: import.meta.dir + "/.." });
    expect(p.exitCode).toBe(0);
    const out = new TextDecoder().decode(p.stdout);
    expect(out).toContain("eligible_at=");
    rmSync(dir, { recursive: true, force: true });
  });
});
