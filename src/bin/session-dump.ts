import { AppServer } from "../protocol/client";
const sv = new AppServer({}, { onStderr: () => {} });
const res = (await sv.request("session/list", { limit: 25 }, 30000)) as any;
const sessions = (res.sessions ?? res ?? []).slice(0, 8);
for (const s of sessions) {
  console.log(JSON.stringify({
    id: String(s.sessionId ?? ""),
    title: String(s.title ?? s.name ?? "").slice(0, 50),
    model: s.model ?? s.modelId ?? null,
    provider: s.providerId ?? s.provider ?? null,
    updated: String(s.updatedAt ?? s.lastActivity ?? "").slice(0, 19),
  }));
}
await sv.close();
