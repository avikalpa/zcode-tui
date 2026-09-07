// Scripted probe: run a batch of requests against a fresh app-server.
// Usage: bun run probe:script -- --script probes/readonly.json
// Script file: [{"method":"...","params":{...}}, ...] — results printed
// per line as {method, ok, result|error} JSON.
import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { AppServer } from "../protocol/client";

const { values } = parseArgs({
  options: {
    script: { type: "string" },
    pushMs: { type: "string", default: "4000" },
  },
});

interface Step { method: string; params: unknown }

const steps: Step[] = JSON.parse(readFileSync(values.script!, "utf8"));
const pushes: Record<string, unknown>[] = [];
const sv = new AppServer({
  onNotification: (m) => pushes.push(m),
  onServerRequest: (m) => {
    // Server→client requests during session bring-up. Reply with the
    // schema-valid minimum (zod: MEt — defaults cover the rest).
    console.error(`[server-req] ${m.method} ${JSON.stringify(m.params).slice(0, 200)}`);
    if (m.method === "session/requestRuntimePreferences") {
      sv.respond(m.id as string, { nativeSearchEnhancementsEnabled: false });
    } else {
      console.error(`[server-req] NO REPLY SHAPE for ${m.method} — failing it`);
      sv.respond(m.id as string, {});
    }
  },
}, { onStderr: (c) => process.stderr.write(c.slice(0, 400)) });

for (const step of steps) {
  try {
    const res = await sv.request(step.method, step.params, 10000);
    console.log(JSON.stringify({ method: step.method, ok: true, result: res }));
  } catch (e) {
    const err = e as Error & { code?: unknown };
    console.log(JSON.stringify({
      method: step.method, ok: false,
      error: { code: err.code, message: err.message, data: (err as { data?: unknown }).data },
    }));
  }
}
setTimeout(async () => {
  const kinds: Record<string, number> = {};
  for (const p of pushes) kinds[String(p.method)] = (kinds[String(p.method)] ?? 0) + 1;
  console.log(JSON.stringify({ pushSummary: kinds, pushCount: pushes.length }));
  await sv.close();
  process.exit(0);
}, Number(values.pushMs));
