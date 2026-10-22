// cat-dump — one-shot model-catalog dump for a workspace (dev sitting
// 2026-10-22, landed for 0.7.2): prints workspace/readState's
// modelCatalog.available entries (reasoning block elided) + top-level keys.
import { parseArgs } from "node:util";
import { AppServer } from "../protocol/client";
const { values } = parseArgs({ options: {
  workspace: { type: "string", default: "/tmp" },
}});
const sv = new AppServer({}, { onStderr: (c) => process.stderr.write(c.slice(0, 100)) });
const res = (await sv.request("workspace/readState", {
  workspace: { workspacePath: values.workspace, workspaceKey: values.workspace },
}, 30000)) as Record<string, unknown>;
const cat = (res as Record<string, unknown>).modelCatalog ?? {} as Record<string, unknown>;
for (const [i, e] of ((cat as Record<string, unknown>).available ?? [] as unknown[]).entries()) {
  const { reasoning, ...rest } = e as Record<string, unknown>;
  void reasoning;
  console.log(JSON.stringify({ i, ...rest }));
}
console.log("KEYS:", Object.keys(cat).join(","));
await sv.close();
