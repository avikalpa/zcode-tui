import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertIdleHostAllowed, assertIdleTargetAllowed } from "../src/queue/idle-host";
import { IdleExecLock, type IdleLockProbe } from "../src/queue/idle-lock";
import { cmdCreate, cmdPoll, cmdServe, cmdExec } from "../src/bin/idle";
import { buildCommand } from "../src/bin/queue";
import { ROUTES, type TaskRow } from "../src/queue/core";
import { adoptOrphanedTickets, registerOffPeakTask } from "../src/queue/offpeak-gateway";
import { createSession, sendWithProvider, writeRunOutcome, buildModelRef } from "../src/bin/run";

const dirs: string[] = [];
const temp = () => { const d = mkdtempSync(join(tmpdir(), "hb-test-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("F1 H3 idle admission", () => {
  test("hostname ban cannot be overridden outside tests; servers unaffected", () => {
    expect(() => assertIdleHostAllowed("jojo-workstation", { NODE_ENV: "production", ZCODE_TUI_IDLE_HOST_CLASS: "server" })).toThrow("IDLE_HOST_BANNED");
    expect(() => assertIdleHostAllowed("dev", {})).not.toThrow();
    expect(() => assertIdleHostAllowed("dev", { NODE_ENV: "test", ZCODE_TUI_IDLE_HOST_CLASS: "laptop" })).toThrow("owner 2026-10-27");
    expect(() => assertIdleTargetAllowed("user@jojo.example.test")).toThrow("IDLE_HOST_BANNED");
  });
  test("all idle entry points reject before DB, gateway, auth or locks", async () => {
    const prior = process.env.ZCODE_TUI_IDLE_HOST_CLASS, oldNode = process.env.NODE_ENV;
    const oldFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (() => { calls++; throw new Error("unexpected gateway"); }) as typeof fetch;
    process.env.NODE_ENV = "test";
    process.env.ZCODE_TUI_IDLE_HOST_CLASS = "laptop";
    try {
      for (const action of [() => cmdCreate({ direct: true }), () => cmdPoll(false), () => cmdExec({}), () => cmdServe({})]) {
        await expect(action()).rejects.toThrow("IDLE_HOST_BANNED");
      }
      await expect(registerOffPeakTask({ title: "fixture", prompt: "fixture", workspacePath: "/fixture" })).rejects.toThrow("IDLE_HOST_BANNED");
      expect(() => adoptOrphanedTickets()).toThrow("IDLE_HOST_BANNED");
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = oldFetch;
      if (prior === undefined) delete process.env.ZCODE_TUI_IDLE_HOST_CLASS; else process.env.ZCODE_TUI_IDLE_HOST_CLASS = prior;
      if (oldNode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldNode;
    }
  });
  test("offpeak dispatch defaults to dev and rejects jojo before SSH", () => {
    const task = { route: "zai-offpeak", prompt: "brief", workspace: "/workspace" } as TaskRow;
    const ctx = { repo: "/repo", stateDir: "/state", promptFile: "/prompt", runLog: "/log", budgetMin: 0 };
    expect(buildCommand(task, ctx).cmd).toContain("dev");
    const prior = ROUTES["zai-offpeak"].remoteHost;
    try {
      ROUTES["zai-offpeak"].remoteHost = "jojo";
      expect(() => buildCommand(task, ctx)).toThrow("IDLE_HOST_BANNED");
      ROUTES["zai-offpeak"].remoteHost = "worker.example.test";
      expect(buildCommand(task, ctx).cmd).toContain("worker.example.test");
    } finally { ROUTES["zai-offpeak"].remoteHost = prior; }
  });
});

describe("F2 H4 idle lease", () => {
  const probe = (dead = true, now = 20_000_000): IdleLockProbe => ({ now: () => now, bootId: () => "boot-a", pidDead: () => dead });
  const seed = (root: string, changes = {}) => {
    const dir = join(root, "ztq-idle-exec"); mkdirSync(dir);
    writeFileSync(join(dir, "owner.json"), JSON.stringify({ token: "old", pid: 42, boot_id: "boot-a", acquired_at: 1, renewed_at: 1, ...changes }));
  };
  test("unavailable lock plane fails closed", () => {
    const root = join(temp(), "not-a-directory"); writeFileSync(root, "x");
    expect(new IdleExecLock(root, probe()).acquire()).toBe(false);
    expect(new IdleExecLock(join(temp(), "missing"), probe()).acquire()).toBe(false);
  });
  test("stale dead same-boot owner can be replaced after 3h", () => {
    const root = temp(); seed(root);
    expect(new IdleExecLock(root, probe()).acquire()).toBe(true);
    const r = JSON.parse(readFileSync(join(root, "ztq-idle-exec/owner.json"), "utf8"));
    expect(r.token).not.toBe("old"); expect(r.renewed_at).toBe(20_000_000);
  });
  test("live/reused pid, foreign boot, young acquisition, fresh renewal and corrupt owner hold", () => {
    for (const [changes, dead] of [[{}, false], [{ boot_id: "foreign" }, true], [{ acquired_at: 19_000_000, renewed_at: 19_000_000 }, true], [{ renewed_at: 19_999_999 }, true]] as const) {
      const root = temp(); seed(root, changes);
      expect(new IdleExecLock(root, probe(dead)).acquire()).toBe(false);
    }
    const root = temp(); seed(root); writeFileSync(join(root, "ztq-idle-exec/owner.json"), "{");
    expect(new IdleExecLock(root, probe()).acquire()).toBe(false);
  });
  test("renewal and release require the exact token; directory survives", () => {
    const root = temp(); let now = 100;
    const lock = new IdleExecLock(root, { ...probe(), now: () => now });
    expect(lock.acquire()).toBe(true); now = 500; expect(lock.renew()).toBe(true);
    const file = join(root, "ztq-idle-exec/owner.json");
    const owned = JSON.parse(readFileSync(file, "utf8")); expect(owned.renewed_at).toBe(500);
    writeFileSync(file, JSON.stringify({ ...owned, token: "foreign" }));
    expect(lock.release()).toBe(false); expect(lock.renew()).toBe(false); expect(existsSync(file)).toBe(true);
    writeFileSync(file, JSON.stringify(owned)); expect(lock.release()).toBe(true);
    expect(existsSync(file)).toBe(false); expect(existsSync(join(root, "ztq-idle-exec"))).toBe(true);
  });
});

describe("F3 H6 funding identity", () => {
  test("model-name fallback rejects explicit provider before another create/send", async () => {
    let calls = 0;
    const sv = { request: async () => { calls++; throw new Error("Unsupported model. Available models: coding/Flash"); } };
    await expect(createSession(sv as any, {}, buildModelRef("Flash", "start"))).rejects.toThrow("PROVIDER_IDENTITY_MISMATCH");
    expect(calls).toBe(1);
  });
  test("override proceeds and output JSON records requested and effective identities", async () => {
    const old = process.env.ZCODE_TUI_ALLOW_PROVIDER_FALLBACK;
    process.env.ZCODE_TUI_ALLOW_PROVIDER_FALLBACK = "1";
    const calls: string[] = [];
    const sv = { request: async (method: string, params: any) => {
      calls.push(method);
      if (method === "session/create" && params.model.providerId === "start") throw new Error("Unsupported model. Available models: coding/Flash");
      return method === "session/send" ? { accepted: true } : { session: { sessionId: "s", model: { providerId: "coding", modelId: "Flash" } } };
    } };
    try {
      await createSession(sv as any, {}, buildModelRef("Flash", "start"));
      let effective: string | null = null;
      await sendWithProvider(sv as any, "s", "brief", "start", (m) => { effective = m?.providerId ?? null; });
      const out = join(temp(), "outcome.json");
      writeRunOutcome(out, { outcome: "settled" }, "start", effective);
      expect(JSON.parse(readFileSync(out, "utf8"))).toEqual({ outcome: "settled", requested_provider: "start", effective_provider: "coding" });
      expect(calls.at(-1)).toBe("session/send");
    } finally { if (old === undefined) delete process.env.ZCODE_TUI_ALLOW_PROVIDER_FALLBACK; else process.env.ZCODE_TUI_ALLOW_PROVIDER_FALLBACK = old; }
  });
  test("send-time drift and unknown provider refuse first and continuation sends", async () => {
    let sent = 0;
    for (const model of [{ providerId: "other", modelId: "Flash" }, null]) {
      const sv = { request: async (method: string) => { if (method === "session/send") sent++; return { session: { model } }; } };
      await expect(sendWithProvider(sv as any, "s", "Continue", "start", () => {})).rejects.toThrow("PROVIDER_IDENTITY_MISMATCH");
    }
    expect(sent).toBe(0);
  });
});
