// Probe the live app-server: boot it, send a request, dump everything.
// Usage: bun run probe -- --method v4/connection/flow --params '{"x":1}'
//        bun run probe -- --listen 10   (just boot and watch pushes)
import { parseArgs } from "node:util";
import { AppServer } from "../protocol/client";

const { values } = parseArgs({
  options: {
    method: { type: "string", default: "v4/connection/flow" },
    params: { type: "string", default: "{}" },
    listen: { type: "string", default: "6" },
  },
});

const listenMs = Number(values.listen) * 1000;
const sv = new AppServer({
  onNotification: (m) =>
    console.log(
      `[push] ${m.method} ${JSON.stringify(m).slice(0, 400)}`,
    ),
  onResponse: (m) => console.log(`[msg ] ${JSON.stringify(m).slice(0, 400)}`),
}, {
  onStderr: (c) => process.stderr.write(`[srv] ${c}`),
});

sv.proc.on("exit", (code) => {
  console.log(`[exit] app-server exited code=${code}`);
  process.exit(0);
});

const t = setTimeout(async () => {
  try {
    console.log(`>> ${values.method} ${values.params}`);
    const res = await sv.request(values.method, JSON.parse(values.params!));
    console.log(`<< ${JSON.stringify(res)?.slice(0, 2000)}`);
  } catch (e) {
    console.log(`<< ERROR ${e instanceof Error ? e.message : e}`);
  }
  setTimeout(async () => {
    await sv.close();
    process.exit(0);
  }, listenMs);
}, 1200);
