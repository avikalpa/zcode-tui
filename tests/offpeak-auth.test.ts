import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveKey, encryptCredential } from "../src/zcode/credentials";

test("off-peak transport keeps the cloud JWT and coding-plan key in their desktop header roles", async () => {
  const home = mkdtempSync(join(tmpdir(), "offpeak-auth-"));
  let received: { path: string; headers: Headers; body: string } | undefined;
  const sink = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    received = { path: new URL(req.url).pathname, headers: req.headers, body: await req.text() };
    return Response.json({ ok: true });
  } });
  try {
    mkdirSync(join(home, ".zcode/v2"), { recursive: true });
    writeFileSync(join(home, ".zcode/v2/credentials.json"), JSON.stringify({
      zcodejwttoken: encryptCredential("synthetic-cloud-jwt", deriveKey("synthetic-test-secret")),
    }));
    const body = JSON.stringify({ model: "fixture-model", max_tokens: 16, messages: [{ role: "user", content: "hello" }] });
    const module = new URL("../src/queue/offpeak-gateway.ts", import.meta.url).pathname;
    const child = Bun.spawn([process.execPath, "--eval", `
      import { offPeakMessages } from ${JSON.stringify(module)};
      const res = await offPeakMessages("synthetic-ticket", ${JSON.stringify(body)});
      process.exit(res.status === 200 ? 0 : 1);
    `], { env: { ...process.env, HOME: home,
      ZCODE_CREDENTIAL_SECRET: "synthetic-test-secret",
      ZCODE_CODING_PLAN_API_KEY: "synthetic-plan-key",
      ZCODE_OFFPEAK_ORIGIN: `http://127.0.0.1:${sink.port}`,
    }, stdout: "ignore", stderr: "pipe" });
    expect(await child.exited).toBe(0);
    expect(received?.path).toBe("/api/v1/off-peak/anthropic/v1/messages");
    expect(received?.headers.get("authorization")).toBe("Bearer synthetic-cloud-jwt");
    expect(received?.headers.get("x-api-key")).toBe("synthetic-cloud-jwt");
    expect(received?.headers.get("x-coding-plan-api-key")).toBe("synthetic-plan-key");
    expect(received?.headers.get("x-off-peak-ticket-id")).toBe("synthetic-ticket");
    expect(received?.headers.get("anthropic-version")).toBe("2023-06-01");
    expect(received?.body).toBe(body);
  } finally {
    sink.stop(true);
    rmSync(home, { recursive: true, force: true });
  }
});
