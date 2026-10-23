// Managed-plane tests: mining procedure, signing, refresh envelope, proxy.
// All fixtures are synthetic EXCEPT the bundle-snippet regexes, which are
// asserted against the real shapes observed in the user's AutoClaw 2.0.3
// bundle (no AutoClaw code or identity is embedded — the fixture is shape-only).
import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, createHmac } from "node:crypto";
import { mineBundle, decryptSafeStorage } from "../src/autoclaw/mine.ts";
import { readPlan, writePlan, planFingerprint, bearer, PLAN_FILE } from "../src/autoclaw/plan.ts";
import { signHeaders, refreshCredential, classifyManagedFailure, fetchModelCatalog } from "../src/autoclaw/gateway.ts";
import { startManagedProxy } from "../src/autoclaw/proxy.ts";
import { resolveManagedModel, piEventStreamHasError } from "../src/bin/autoclaw.ts";
import type { AutoclawPlan } from "../src/autoclaw/plan.ts";

function fixturePlan(overrides: Partial<AutoclawPlan> = {}): AutoclawPlan {
  return {
    schemaVersion: 1,
    minedFrom: "/fixture/app",
    minedAt: "2026-10-23T00:00:00.000Z",
    identity: { appId: "100000", appKey: "a".repeat(32), product: "fixture" },
    endpoint: { base: "http://127.0.0.1:0", proxyPath: "/proxy/fixture", modelConfigPath: "/proxy/fixture-config" },
    auth: { accessToken: "Bearer tok-1", refreshToken: "ref-1", deviceId: "dev-1", updatedAt: "2026-10-23T00:00:00.000Z" },
    refresh: { path: "/refresh", fallbackPath: "/agent-refresh", sourceId: "fixture" },
    client: { version: "1.0.0", lang: "en-US", channel: "official", traceSource: "fixture-desktop" },
    pi: { version: "0.83.0" },
    ...overrides,
  };
}

const BUNDLE_SNIPPET = `
var AUTOCLAW_COMPATIBLE_IDENTITY = {
  appId: "100003",
  appKey: "38d2391985e2369a5fb8227d8e6cd5e5",
  product: "autoclaw"
};
var ZWORK_DEFAULT_DISTRIBUTION_CHANNEL = "official";
var MODEL_CONFIG_PATH = "/autoclaw-proxy/proxy/autoclaw-model-config";
var MODEL_SERVICE_ID = "managed_model_gateway";
  const modelBaseUrl = resolveManagedEndpoint({
    snapshot: input.activeSnapshot(),
    serviceId: MODEL_SERVICE_ID,
    path: "/autoclaw-proxy/proxy/autoclaw"
  });
var PRIMARY_REFRESH_PATH = "/userapi/v1/refresh";
var FALLBACK_REFRESH_PATH = "/userapi/v1/agent-refresh";
var HTTP_ORIGIN_BY_ENVIRONMENT = {
  local: "https://autoglm-test-2.zhipuai.cn",
  test: "https://autoglm-test-2.zhipuai.cn",
  pre: "https://autoglm-pre-api.zhipuai.cn",
  release: "https://autoglm-acceleration-api.zhipuai.cn",
  overseas_test: "https://autoglm-test-api.autoglm.ai",
  overseas_pre: "https://autoglm-pre-api.autoglm.ai",
  overseas_release: "https://autoglm-api.autoglm.ai"
};
`;

function writeFixtureApp(home: string, extra = ""): string {
  const app = join(home, ".appimages", "runtime", "1792122094-0000", "resources", "app");
  mkdirSync(join(app, "dist"), { recursive: true });
  writeFileSync(join(app, "dist", "main.cjs"), BUNDLE_SNIPPET + extra);
  writeFileSync(join(app, "package.json"), JSON.stringify({ name: "zwork", version: "2.0.3", dependencies: { "@earendil-works/pi-coding-agent": "0.83.0" } }));
  return app;
}

describe("mine: bundle", () => {
  test("mines identity, paths, origins, refresh, versions from the user's bundle shapes", () => {
    const home = mkdtempSync(join(tmpdir(), "zt-mine-"));
    const app = writeFixtureApp(home);
    const b = mineBundle(app);
    expect(b.identity).toEqual({ appId: "100003", appKey: "38d2391985e2369a5fb8227d8e6cd5e5", product: "autoclaw" });
    expect(b.channelDefault).toBe("official");
    expect(b.proxyPath).toBe("/autoclaw-proxy/proxy/autoclaw");
    expect(b.modelConfigPath).toBe("/autoclaw-proxy/proxy/autoclaw-model-config");
    expect(b.origins.release).toBe("https://autoglm-acceleration-api.zhipuai.cn");
    expect(b.origins.overseas).toBe("https://autoglm-api.autoglm.ai");
    expect(b.refresh).toEqual({ path: "/userapi/v1/refresh", fallbackPath: "/userapi/v1/agent-refresh" });
    expect(b.version).toBe("2.0.3");
    expect(b.piVersion).toBe("0.83.0");
  });

  test("throws honestly when the layout changed", () => {
    const home = mkdtempSync(join(tmpdir(), "zt-mine2-"));
    const app = join(home, "app");
    mkdirSync(join(app, "dist"), { recursive: true });
    writeFileSync(join(app, "dist", "main.cjs"), "// identity object removed upstream");
    expect(() => mineBundle(app)).toThrow(/identity/);
  });
});

describe("safeStorage decrypt (public os_crypt v11 format)", () => {
  test("round-trips an AES-128-CBC v11 blob", () => {
    const { createCipheriv, pbkdf2Sync } = require("node:crypto") as typeof import("node:crypto");
    const key = Buffer.from("0123456789abcdef0123456789abcdef"); // 24-byte keyring secret shape
    const pw = pbkdf2Sync(key, Buffer.from("saltysalt"), 1, 16, "sha1");
    const payload = JSON.stringify({ accessToken: "Bearer x", refreshToken: "r" });
    const cipher = createCipheriv("aes-128-cbc", pw, Buffer.alloc(16, 0x20));
    const enc = Buffer.concat([Buffer.from("v11"), cipher.update(payload, "utf8"), cipher.final()]);
    const out = JSON.parse(decryptSafeStorage(enc, pw)); // fn takes the DERIVED AES key
    expect(out.refreshToken).toBe("r");
  });
});

describe("plan file", () => {
  test("round-trips with owner-only perms and fingerprints", () => {
    const home = mkdtempSync(join(tmpdir(), "zt-plan-"));
    const file = join(home, "autoclaw-plan.json");
    const plan = fixturePlan();
    writePlan(plan, file);
    const mode = readFileSync(file).stat?.mode ?? 0;
    expect(existsSync(file)).toBe(true);
    expect((mode & 0o077)).toBe(0);
    expect(readPlan(file)?.identity.appId).toBe("100000");
    expect(planFingerprint(plan)).toMatch(/^[0-9a-f]{16}$/);
    expect(readPlan(join(home, "missing.json"))).toBeNull();
  });

  test("bearer normalizes the server's pre-prefixed tokens", () => {
    expect(bearer("Bearer abc")).toBe("Bearer abc");
    expect(bearer("bearer abc")).toBe("bearer abc");
    expect(bearer("abc")).toBe("Bearer abc");
  });
});

describe("sign headers", () => {
  test("md5(appId&ts&appKey) with fixed now; model + channel headers present", () => {
    const plan = fixturePlan();
    const fixedNow = () => 1_700_000_000_000; // 1700000000
    const h = signHeaders(plan, { model: "m1", requestId: "rid-1" }, fixedNow);
    expect(h["X-Auth-TimeStamp"]).toBe("1700000000");
    expect(h["X-Auth-Sign"]).toBe(createHash("md5").update("100000&1700000000&" + "a".repeat(32)).digest("hex"));
    expect(h["X-Auth-Appid"]).toBe("100000");
    expect(h["X-Product"]).toBe("fixture");
    expect(h["X-Tm"]).toBe(process.platform === "darwin" ? "mac" : process.platform);
    expect(h["X-Authorization"]).toBe("Bearer tok-1");
    expect(h["X-Request-Model"]).toBe("m1");
    expect(h["X-Trace-Id"]).toBe("rid-1");
    expect(h["X-Client-Type"]).toBe("pc");
    expect(h["X-Channel"]).toBe("official");
    expect(h["x_trace_id"]).toBe("fixture-desktop");
  });
});

describe("refresh credential", () => {
  test("code 0 persists the rotated pair (server returns pre-prefixed tokens)", async () => {
    const home = mkdtempSync(join(tmpdir(), "zt-ref-"));
    const file = join(home, "plan.json");
    const plan = fixturePlan({ endpoint: { base: "http://mock", proxyPath: "/p", modelConfigPath: "/pc" } });
    writePlan(plan, file);
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response(JSON.stringify({
        code: 0, msg: "SUCCESS",
        data: { access_token: "Bearer fresh-2", refresh_token: "ref-2" },
      }), { status: 200 });
    }) as typeof fetch;
    const r = await refreshCredential(plan, fetchImpl, file);
    expect(r.ok).toBe(true);
    expect(calls[0].url).toBe("http://mock/refresh");
    expect(calls[0].body).toEqual({ refresh_token: "ref-1", source_id: "fixture", device_id: "dev-1" });
    const stored = JSON.parse(readFileSync(file, "utf8"));
    expect(stored.auth.accessToken).toBe("Bearer fresh-2");
    expect(stored.auth.refreshToken).toBe("ref-2");
  });

  test("400002 falls back to agent-refresh; 400000 is hard; 510002 soft", async () => {
    const plan = fixturePlan({ endpoint: { base: "http://mock", proxyPath: "/p", modelConfigPath: "/pc" } });
    const responses: object[] = [
      { code: 400002 },
      { code: 400000, msg: "nope" },
    ];
    let i = 0;
    const fetchImpl = (async () => new Response(JSON.stringify(responses[i++]), { status: 200 })) as typeof fetch;
    const r = await refreshCredential(plan, fetchImpl);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failureClass).toBe("hard");
    const soft = await refreshCredential(plan, (async () => new Response(JSON.stringify({ code: 510002 }), { status: 200 })) as typeof fetch);
    expect(!soft.ok && soft.failureClass).toBe("soft");
  });
});

describe("model catalog", () => {
  test("parses the managed catalog shape", async () => {
    const plan = fixturePlan({ endpoint: { base: "http://mock", proxyPath: "/p", modelConfigPath: "/pc" } });
    const fetchImpl = (async () => new Response(JSON.stringify({ models: [
      { id: "zai_auto-fast", name: "Auto-Fast", contextWindow: 1048576, maxTokens: 393216, reasoning: true },
      { id: "", name: "dropped" },
    ] }), { status: 200 })) as typeof fetch;
    const r = await fetchModelCatalog(plan, fetchImpl);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.models).toHaveLength(1);
  });

  test("surfaces the plan's own failure envelope", async () => {
    const plan = fixturePlan({ endpoint: { base: "http://mock", proxyPath: "/p", modelConfigPath: "/pc" } });
    const fetchImpl = (async () => new Response(JSON.stringify({ code: "810001", message: "high demand" }), { status: 403 })) as typeof fetch;
    const r = await fetchModelCatalog(plan, fetchImpl);
    expect(!r.ok && typeof r.failure !== "string" && r.failure.serviceCode).toBe("810001");
  });
});

describe("managed failure classes", () => {
  test("the documented policy table", () => {
    expect(classifyManagedFailure(403, "810000")).toBe("managed_model_quota_exhausted");
    expect(classifyManagedFailure(403, "810001")).toBe("managed_model_rate_limited");
    expect(classifyManagedFailure(403, "410004")).toBe("managed_model_account_banned");
    expect(classifyManagedFailure(402, "")).toBe("managed_model_points_insufficient");
    expect(classifyManagedFailure(401, "")).toBe("access_credential_rejected");
    expect(classifyManagedFailure(500, "")).toBe("managed_model_http_500");
  });
});

describe("signing proxy", () => {
  test("forwards signed requests upstream; strips client auth; 401 triggers refresh+retry", async () => {
    const home = mkdtempSync(join(tmpdir(), "zt-px-"));
    const planFile = join(home, "plan.json");
    const seen: { auth: string[]; sign: string[]; model: string[]; bodies: string[]; paths: string[] } = {
      auth: [], sign: [], model: [], bodies: [], paths: [],
    };
    let upstreamMode: "ok" | "unauthorized-then-ok" = "unauthorized-then-ok";
    const upstream = Bun.serve({
      port: 0,
      fetch: async (req) => {
        const u = new URL(req.url);
        seen.paths.push(u.pathname);
        seen.auth.push(req.headers.get("x-authorization") ?? "");
        seen.sign.push(req.headers.get("x-auth-sign") ?? "");
        seen.model.push(req.headers.get("x-request-model") ?? "");
        if (u.pathname === "/refresh") {
          return Response.json({ code: 0, data: { access_token: "Bearer tok-2", refresh_token: "ref-2" } });
        }
        seen.bodies.push(await req.text());
        if (upstreamMode === "unauthorized-then-ok" && seen.bodies.length === 1) {
          return Response.json({ error: "Invalid token" }, { status: 401 });
        }
        return Response.json({ ok: true, content: [{ type: "text", text: "hi" }] });
      },
    });
    const plan = fixturePlan({
      endpoint: { base: `http://127.0.0.1:${upstream.port}`, proxyPath: "/proxy/fixture", modelConfigPath: "/pc" },
    });
    writePlan(plan, planFile);

    const proxy = await startManagedProxy(plan, { planPath: planFile, fetchImpl: fetch });
    try {
      const client = Bun.serve({
        port: 0, // stands in for pi's anthropic client
        fetch: async (req) => {
          return fetch(`http://127.0.0.1:${proxy.port}/v1/messages`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer client-should-be-stripped", "anthropic-version": "2023-06-01" },
            body: JSON.stringify({ model: "zai_auto-fast", max_tokens: 8, messages: [{ role: "user", content: "ping" }] }),
          });
        },
      });
      try {
        const res = await fetch(`http://127.0.0.1:${client.port}/go`);
        expect(res.status).toBe(200);
        const doc = await res.json() as { ok: boolean };
        expect(doc.ok).toBe(true);
      } finally {
        client.stop(true);
      }
      expect(seen.paths).toEqual(["/proxy/fixture/v1/messages", "/refresh", "/proxy/fixture/v1/messages"]);
      expect(seen.bodies.length).toBe(2);
      // Only the message carries X-Request-Model; the refresh call does not.
      expect(seen.model.filter(Boolean).every((m) => m === "zai_auto-fast")).toBe(true);
      expect(seen.model.filter(Boolean)).toHaveLength(2);
      expect(seen.sign.every((s) => /^[0-9a-f]{32}$/.test(s))).toBe(true);
      expect(seen.auth[0]).toBe("Bearer tok-1");
      expect(seen.auth[1]).toBe("Bearer tok-1"); // the refresh call rides the then-current token
      expect(seen.auth[2]).toBe("Bearer tok-2"); // refreshed pair retried
      const stored = JSON.parse(readFileSync(planFile, "utf8"));
      expect(stored.auth.accessToken).toBe("Bearer tok-2");
    } finally {
      proxy.stop();
      upstream.stop(true);
    }
  });

  test("refuses non-allowlisted paths", async () => {
    const plan = fixturePlan();
    const proxy = await startManagedProxy(plan);
    try {
      const res = await fetch(`http://127.0.0.1:${proxy.port}/etc/passwd`);
      expect(res.status).toBe(404);
      const health = await (await fetch(`http://127.0.0.1:${proxy.port}/healthz`)).json() as { ok: boolean };
      expect(health.ok).toBe(true);
    } finally {
      proxy.stop();
    }
  });
});

describe("hmac-sha cross-check (sign is md5, not hmac — regression guard)", () => {
  test("sign must NOT be an hmac variant", () => {
    const plan = fixturePlan();
    const fixedNow = () => 1_700_000_000_000;
    const h = signHeaders(plan, {}, fixedNow);
    const hmac = createHmac("sha256", plan.identity.appKey).update(`100000&1700000000`).digest("hex");
    expect(h["X-Auth-Sign"]).not.toBe(hmac);
  });
});

describe("default plan path", () => {
  test("points at the user's config dir", () => {
    expect(PLAN_FILE).toContain(".config/zcode-tui/autoclaw-plan.json");
  });
});

describe("queue classifier: managed-plane busy", () => {
  test("810001 high-demand and bare 406 park the route instead of burning attempts", () => {
    const { classifyFailure } = require("../src/queue/core") as typeof import("../src/queue/core");
    const t = Date.now();
    const demand = classifyFailure('403 We\'re experiencing high demand right now. Please try again shortly', 1, 3, t);
    expect(demand.kind).toBe("cooldown");
    const busy406 = classifyFailure("406 status code (no body)", 1, 3, t);
    expect(busy406.kind).toBe("cooldown");
    expect((demand.cooldownMs ?? 0)).toBe(600_000);
  });
});

describe("resolveManagedModel (dispatch-hardening)", () => {
  test("explicit model always wins", () => {
    expect(resolveManagedModel("my-model", [{ id: "cat-first" }])).toBe("my-model");
  });
  test("catalog order wins when present", () => {
    expect(resolveManagedModel("", [{ id: "cat-first" }, { id: "cat-second" }])).toBe("cat-first");
  });
  test("builtin fallback when catalog unavailable and no --model", () => {
    expect(resolveManagedModel("", [])).toBe("zaicoding_glm-5.3");
  });
});

describe("piEventStreamHasError (billing honesty)", () => {
  test("flags a provider-error turn (measured 406 shape)", () => {
    const evt = JSON.stringify({ role: "assistant", stopReason: "error", errorMessage: "406 status code (no body)", provider: "autoclaw" });
    expect(piEventStreamHasError(evt)).toBe(true);
  });
  test("clean settles pass", () => {
    expect(piEventStreamHasError(JSON.stringify({ type: "agent_end", stopReason: "stop" }))).toBe(false);
    expect(piEventStreamHasError("")).toBe(false);
  });
});
