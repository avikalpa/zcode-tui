import { existsSync } from "node:fs";
// Read the shared store's input history for the current project.
// WAL-safe: short read-only queries, busy_timeout, never a write txn.
import { Database } from "bun:sqlite";

export function projectIdForCwd(cwd: string): string {
  return "proj_" + cwd.replaceAll("/", "-").replace(/^-+/, "");
}

export function recentInputs(cwd: string, limit = 50): string[] {
  const dbPath = `${process.env.HOME}/.zcode/cli/db/db.sqlite`;
  if (!existsSync(dbPath)) return [];
  let db: Database;
  try {
    db = new Database(dbPath, { readonly: true });
    db.exec("PRAGMA busy_timeout = 2000");
  } catch {
    return [];
  }
  try {
    const rows = db
      .query(
        `SELECT text FROM input_history
         WHERE project_id = ? AND kind IN ('prompt','steered_input')
         ORDER BY time_created DESC LIMIT ?`,
      )
      .all(projectIdForCwd(cwd), limit) as { text: string }[];
    return rows.map((r) => r.text).filter((t) => t.length > 0);
  } catch {
    return [];
  } finally {
    db.close();
  }
}
