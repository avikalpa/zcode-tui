// Live probe of the v4/attachment/* family + session/send attachments (0.6.35 recon).
// Lives in tools/ of the campaign worktree; run with bun from the worktree root.
// Write-path probe on a THROWAWAY session: one upload (aborted-or-committed),
// one tiny end-to-end send ("Reply with exactly: ok") to prove the wire, then close.
import { AppServer } from "../src/protocol/client";
import { createHash } from "node:crypto";

const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function main() {
  const client = new AppServer({}, { onStderr: (c) => process.stderr.write(c) });
  client.onAsk((msg) => {
    if (String(msg.method) === "session/requestRuntimePreferences") return { nativeSearchEnhancementsEnabled: false };
    return {};
  });
  const ws = { workspacePath: process.cwd(), workspaceKey: process.cwd() };
  const show = async (label: string, method: string, params: unknown, cap = 2500) => {
    try {
      const res = await client.request(method, params, 45000);
      const text = JSON.stringify(res, null, 1);
      console.log(`\n=== ${label} (${method}) ===`);
      console.log(text.length > cap ? text.slice(0, cap) + `\n...[truncated ${text.length} chars]` : text);
      return res as Record<string, unknown>;
    } catch (e) {
      console.log(`\n=== ${label} (${method}) FAILED ===`);
      console.log(String(e).slice(0, 800));
      return null;
    }
  };

  const bytes = Buffer.from(PNG_B64, "base64");
  const sha = createHash("sha256").update(bytes).digest("hex");
  console.log(`png bytes=${bytes.byteLength} sha256=${sha}`);

  const created = (await show("create", "session/create", {
    workspace: ws,
    mode: "build",
    persistence: "immediate",
    model: { providerId: "zai", modelId: "GLM-5.3-Flash" },
  }, 1200)) as { session?: Record<string, unknown> } | null;
  const sess = created?.session as Record<string, unknown> | undefined;
  const sid = (sess?.sessionId ?? sess?.id ?? (sess ? Object.values(sess).find((v) => typeof v === "string" && String(v).startsWith("ses")) : undefined)) as string | undefined;
  console.log(`\nsessionId = ${sid}`);
  if (!sid) { client.proc.kill(); process.exit(1); }

  const conn = "tui-probe";
  const up = "probe-upload-1";
  await show("begin", "v4/attachment/begin", {
    connectionId: conn, uploadId: up, sessionId: sid,
    fileName: "red.png", mime: "image/png",
    totalBytes: bytes.byteLength, totalChunks: 1, checksum: `sha256:${sha}`,
  }, 1500);
  await show("chunk0", "v4/attachment/chunk", {
    connectionId: conn, uploadId: up, sessionId: sid, chunkIndex: 0, dataBase64: PNG_B64,
  }, 1500);
  const commit = await show("commit", "v4/attachment/commit", {
    connectionId: conn, uploadId: up, sessionId: sid,
  }, 2500);
  const ref = (commit as { ref?: string } | null)?.ref;
  console.log(`\nref = ${ref}`);

  if (ref) {
    await show("read", "v4/attachment/read", {
      sessionId: sid, ref, offset: 0, limit: 512 * 1024,
    }, 800);
    await show("previewSource", "v4/attachment/previewSource", {
      sessionId: sid, ref, offset: 0, limit: 512 * 1024,
    }, 800);
    await show("send+attachment", "session/send", {
      sessionId: sid, content: "Reply with exactly: ok",
      attachments: [{ ref, fileName: "red.png", mime: "image/png", bytes: bytes.byteLength }],
    }, 1500);
    // give the turn a moment to persist, then read what came back
    await new Promise((r) => setTimeout(r, 6000));
    const resumed = (await show("resume-after-send", "session/resume", { sessionId: sid }, 4000)) as { messages?: unknown[] } | null;
    const msgs = resumed?.messages ?? [];
    for (const m of msgs.slice(0, 4)) {
      console.log("\n--- row ---");
      console.log(JSON.stringify(m, null, 1).slice(0, 2200));
    }
  }

  await show("close", "session/close", { sessionId: sid }, 800);
  client.proc.kill();
  process.exit(0);
}
main();
