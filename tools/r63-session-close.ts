// R63 corpus cleanup: the interrupt probe's session title ("Spawn subagent
// to count 1 to 30") matches B4's absence regex `(^|\s)1\s+\S` on the
// sessions dialog — close the probe's parent + child so the gated runs see
// a clean corpus. Read-only otherwise; prints the list delta.
import { AppServer } from "../src/protocol/client";

const TARGETS = [
  "sess_e772a8d1-5950-4d8a-b95f-c39a07762158", // the r63 probe parent
  "sess_subagent_agent_9a4b4658-4b9f-4082-aa40-821a88596480", // its child
];

function rowsOf(list: any): any[] {
  return list?.sessions ?? list?.items ?? (Array.isArray(list) ? list : []);
}

async function main() {
  const c = new AppServer({}, { onStderr: () => {} });
  c.onAsk((msg) =>
    String((msg as any)?.method) === "session/requestRuntimePreferences"
      ? { nativeSearchEnhancementsEnabled: false }
      : {},
  );
  const before = rowsOf(await c.request("session/list", {}));
  console.log("BEFORE", before.length, "sessions");
  for (const t of TARGETS) {
    try {
      const out = await c.request("session/close", { sessionId: t }, 20000);
      console.log("CLOSED", t, JSON.stringify(out ?? {}).slice(0, 200));
    } catch (e) {
      console.log("CLOSE-FAIL", t, String(e).slice(0, 200));
    }
  }
  const after = rowsOf(await c.request("session/list", {}));
  console.log("AFTER", after.length, "sessions");
  const digitTitles = after
    .map((r: any) => String(r?.title ?? ""))
    .filter((t: string) => /(^|\s)1\s+\S/.test(t));
  console.log("TITLES still matching B4 regex:", JSON.stringify(digitTitles));
  c.proc.kill();
  process.exit(0);
}
main();
