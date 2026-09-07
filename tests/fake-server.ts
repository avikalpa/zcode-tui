// Fake app-server for framing/correlation tests. Speaks NDJSON on stdio:
// echoes {id, result:{echo: params}} per line, and after N ms of silence
// sends an unsolicited push then exits (exit-code from argv).
import { createInterface } from "node:readline";
const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  try {
    const msg = JSON.parse(line);
    process.stdout.write(JSON.stringify({ id: msg.id, result: { echo: msg.params, method: msg.method } }) + "\n");
  } catch {
    process.stdout.write(JSON.stringify({ error: { code: -32700, message: "parse" } }) + "\n");
  }
});
setTimeout(() => {
  process.stdout.write(JSON.stringify({ method: "v4/telemetry/event", params: { kind: "ping" } }) + "\n");
  process.exit(Number(process.argv[2] ?? 0));
}, Number(process.argv[3] ?? 800));
