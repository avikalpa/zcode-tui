import { AppServer } from "../protocol/client";
const sid = process.argv[2];
const sv = new AppServer({
  onServerRequest: (m) => {
    const method = String(m.method);
    if (method === "interaction/requestPermission") sv.respond(String(m.id), { decision: "allow" });
    else if (method === "interaction/requestUserInput") sv.respond(String(m.id), { cancelled: true });
    else if (method === "session/requestRuntimePreferences") sv.respond(String(m.id), { nativeSearchEnhancementsEnabled: false });
    else sv.respond(String(m.id), {});
  },
}, { onStderr: () => {} });
const res = (await sv.request("session/resume", { sessionId: sid }, 30000)) as any;
const s = res.session ?? res;
console.log(JSON.stringify({
  model: s.model ?? null,
  modelId: s.modelId ?? null,
  provider: s.providerId ?? s.provider ?? null,
  keys: Object.keys(s).slice(0, 40),
}, null, 1));
await sv.close();
