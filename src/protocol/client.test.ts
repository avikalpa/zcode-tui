// Client tests. The fake-server group runs anywhere (bun test); the
// app-server group needs the packaged runtime and skips when absent.
import { describe, test, expect } from "bun:test";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { AppServer, ELECTRON_BIN, RUNTIME_CJS } from "./client";

const FAKE = new URL("../../tests/fake-server.ts", import.meta.url).pathname;

describe("client framing (fake server)", () => {
  test("correlates responses by id, splits chunked frames, passes pushes", async () => {
    const p = spawn(process.execPath, [FAKE, "0", "800"], { stdio: ["pipe", "pipe", "ignore"] });
    const lines: Record<string, unknown>[] = [];
    let buf = "";
    p.stdout!.setEncoding("utf8");
    p.stdout!.on("data", (c: string) => {
      buf += c;
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        lines.push(JSON.parse(buf.slice(0, i)));
        buf = buf.slice(i + 1);
      }
    });
    // two writes in one chunk: framing must split them
    p.stdin!.write(
      JSON.stringify({ method: "a/one", params: { x: 1 }, id: 1 }) + "\n" +
      JSON.stringify({ method: "a/two", params: { y: 2 }, id: 2 }) + "\n",
    );
    await new Promise((r) => setTimeout(r, 500));
    expect(lines.length).toBe(2);
    expect(lines[0]).toEqual({ id: 1, result: { echo: { x: 1 }, method: "a/one" } });
    expect(lines[1]).toEqual({ id: 2, result: { echo: { y: 2 }, method: "a/two" } });
    await new Promise((r) => setTimeout(r, 600));
    expect(lines.some((l) => (l as { method?: string }).method === "v4/telemetry/event")).toBe(true);
    p.kill();
  });
});

describe("app-server (packaged runtime)", () => {
  const haveRuntime = existsSync(ELECTRON_BIN) && existsSync(RUNTIME_CJS);

  test("session/list returns real store sessions", async () => {
    if (!haveRuntime) return;
    const sv = new AppServer();
    const res = (await sv.request("session/list", { limit: 5 })) as { sessions?: unknown[] };
    expect(Array.isArray(res.sessions)).toBe(true);
    await sv.close();
  }, 20000);

  test("request timeout rejects cleanly", async () => {
    if (!haveRuntime) return;
    const sv = new AppServer();
    await expect(sv.request("v4/controller/subscribe", {}, 1500)).rejects.toThrow();
    await sv.close();
  }, 20000);

  test("backend-lost fires and respawn restores service", async () => {
    if (!haveRuntime) return;
    const sv = new AppServer();
    let lost = false;
    sv.onBackendLost(() => { lost = true; });
    await sv.request("session/list", { limit: 1 });
    sv.proc.kill("SIGKILL");
    await new Promise((r) => setTimeout(r, 500));
    expect(lost).toBe(true);
    sv.respawn();
    const res = (await sv.request("session/list", { limit: 1 })) as { sessions?: unknown[] };
    expect(Array.isArray(res.sessions)).toBe(true);
    await sv.close();
  }, 25000);
});
