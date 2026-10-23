// queue rm — task cancellation semantics (fleet ledger hygiene).
import { describe, test, expect } from "bun:test";
import { Database } from "bun:sqlite";
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
