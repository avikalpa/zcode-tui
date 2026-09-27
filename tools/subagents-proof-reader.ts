// Proof-reader one-shot (R62 SUB stage): the protocol truth channel for the
// subagent proof family. Runs CONCURRENTLY with the PTY TUI while a typed
// yolo ask spawns a real child; polls session/list + session/subagents and
// reports the model-generated facts the screen needles ride (the child
// title and summary vary per run — the transcript cannot be needleed for
// them) plus protocol-certain settle. Lines on stdout: "READER
// session=<id>", optional "RUNNING <json>", then "VERDICT <json>" with exit
// 0 = an ended child, 1 = timeout. Pattern per tools/subagents-probe.ts;
// must run IN-TREE (node_modules), bun at ~/.bun/bin on dev.
//
// LOCK RULE (two live fires taught it): older proof sessions keep their
// subagent activity forever, and back-to-back proof runs put the previous
// run's ended child inside any session-freshness window — so the only safe
// anchor is the CHILD's own startedAt: a candidate qualifies only through
// an item that started at/after the reader's start (minus a small clock
// margin). A previous run's child can never re-qualify.
import { AppServer } from "../src/protocol/client";

function onAsk(msg: unknown) {
  return String((msg as any)?.method) === "session/requestRuntimePreferences"
    ? { nativeSearchEnhancementsEnabled: false }
    : {};
}

function rowsOf(list: any): any[] {
  return list?.sessions ?? list?.items ?? (Array.isArray(list) ? list : []);
}

async function main() {
  const c = new AppServer({}, { onStderr: () => {} });
  c.onAsk(onAsk);
  const t0 = Date.now();
  const deadline = t0 + 180_000;
  let locked: string | null = null;
  let reportedRunning = false;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    let rows: any[] = [];
    try {
      rows = rowsOf(await c.request("session/list", {}));
    } catch {
      continue;
    }
    const cand = [...rows]
      .sort((a, b) => (b?.updatedAt ?? 0) - (a?.updatedAt ?? 0))
      .slice(0, 8);
    for (const row of cand) {
      const sid = String(row?.sessionId ?? "");
      if (!sid) continue;
      let snap: any;
      try {
        snap = await c.request("session/subagents", { sessionId: sid });
      } catch {
        continue;
      }
      const items = [
        ...((snap?.running ?? []) as any[]),
        ...((snap?.ended?.items ?? []) as any[]),
      ];
      const mine = items.filter((it) => (it?.startedAt ?? 0) >= t0 - 5_000);
      if (!mine.length) continue;
      if (sid !== locked) {
        locked = sid;
        reportedRunning = false;
        console.log(`READER session=${sid}`);
      }
      const endedMine = mine.filter((it) => it?.status && it.status !== "running");
      if (endedMine.length > 0) {
        console.log(
          "VERDICT " +
            JSON.stringify({
              sessionId: sid,
              childTitle: endedMine[0]?.title ?? "",
              type: endedMine[0]?.subagentType ?? "",
              status: endedMine[0]?.status ?? "",
              summary: endedMine[0]?.summary ?? "",
              elapsedMs: Date.now() - t0,
            }),
        );
        c.proc.kill();
        process.exit(0);
      }
      if (!reportedRunning && mine.length > 0) {
        reportedRunning = true;
        console.log(
          "RUNNING " +
            JSON.stringify({ childTitle: mine[0]?.title, type: mine[0]?.subagentType }),
        );
      }
      break; // locked: keep polling THIS session until its child ends
    }
  }
  console.log("VERDICT " + JSON.stringify({ error: "timeout without an ended subagent" }));
  c.proc.kill();
  process.exit(1);
}

main();
