// Local signing proxy for the user's AutoClaw managed model plane.
//
// Why a proxy: pi (and any Anthropic-protocol client) can point at an arbitrary
// baseUrl, but the plan's gateway needs per-request signed headers (fresh
// timestamp + md5 sign). Static config cannot do that, so zcode-tui hosts the
// sign locally: client -> 127.0.0.1:<port>/v1/messages -> gateway. This is the
// same middleware the official app runs in its main process; zcode-tui ships
// none of its constants (see plan.ts — everything rides the user's plan file).
import { randomUUID } from "node:crypto";
import { bearer, type AutoclawPlan } from "./plan";
import { refreshCredential, signHeaders } from "./gateway";

export interface ProxyOptions {
  port?: number;   // default 0 (ephemeral)
  hostname?: string; // default 127.0.0.1
  planPath?: string;
  fetchImpl?: typeof fetch;
}

export interface ManagedProxy { port: number; hostname: string; stop: () => void; healthy: () => boolean }

const ALLOWED_SUFFIXES = ["/v1/messages", "/v1/messages/count_tokens"];

// the desktop's own credits read paths (gateway-absolute, not behind the
// autoclaw-proxy prefix) — mined 2026-10-24 from the AutoClaw 2.0.3 bundle
const CREDITS_PATHS: Record<string, string> = {
  "/credits": "/agent-assetmgr/api/v2/wallets?biz_app_id=autoclaw",
  "/credits/instances": "/agent-assetmgr/api/v1/wallet-instances",
};

let inflightRefresh: Promise<boolean> | null = null;

export function startManagedProxy(plan: AutoclawPlan, opts: ProxyOptions = {}): Promise<ManagedProxy> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const hostname = opts.hostname ?? "127.0.0.1";
  let lastRefreshAt = 0;
  let requestsServed = 0;

  const ensureFreshCredential = async (): Promise<boolean> => {
    if (!inflightRefresh) {
      inflightRefresh = refreshCredential(plan, fetchImpl, opts.planPath).then((r) => {
        inflightRefresh = null;
        if (r.ok) lastRefreshAt = Date.now();
        return r.ok;
      }).catch(() => {
        inflightRefresh = null;
        return false;
      });
    }
    return inflightRefresh;
  };

  const server = Bun.serve({
    hostname,
    port: opts.port ?? 0,
    idleTimeout: 255, // Bun caps at 255s; long agent turns + SSE streams renew on traffic
    async fetch(req): Promise<Response> {
      const url = new URL(req.url);
      if (url.pathname === "/healthz") {
        return Response.json({
          ok: true,
          endpoint: plan.endpoint.base,
          requestsServed,
          lastRefreshAt: lastRefreshAt || undefined,
          credentialUpdatedAt: plan.auth.updatedAt,
        });
      }
      // signed GET passthrough for the wallet plane: the gateway answers
      // unauthenticated reads with HTTP 200 + envelope 410000 (not 401), so
      // this branch buffers the small JSON and runs its own refresh-retry
      const creditsPath = CREDITS_PATHS[url.pathname];
      if (creditsPath) {
        const sendCredits = () => fetchImpl(plan.endpoint.base + creditsPath, {
          method: "GET",
          headers: { ...signHeaders(plan) },
          redirect: "error",
        }).then((up) => up.text());
        let text = await sendCredits();
        requestsServed++;
        let envelope: { code?: unknown } = {};
        try { envelope = JSON.parse(text) as typeof envelope; } catch { /* non-envelope passthrough */ }
        if (envelope.code === 410000) {
          const refreshed = await ensureFreshCredential();
          if (refreshed) text = await sendCredits();
        }
        return new Response(text, { status: 200, headers: { "content-type": "application/json" } });
      }

      let target: string;
      if (url.pathname === "/model-config") target = plan.endpoint.base + plan.endpoint.modelConfigPath;
      else if (ALLOWED_SUFFIXES.some((s) => url.pathname === s)) target = plan.endpoint.base + plan.endpoint.proxyPath + url.pathname;
      else return Response.json({ error: "unproxied_path", path: url.pathname }, { status: 404 });

      const body = req.method === "POST" ? new Uint8Array(await req.arrayBuffer()) : undefined;
      let model: string | undefined;
      if (body) {
        try { model = String((JSON.parse(new TextDecoder().decode(body)) as { model?: unknown }).model ?? "") || undefined; } catch { /* stream frames etc. */ }
      }

      const send = (tokenChanged = false): Promise<Response> => {
        const headers: Record<string, string> = {
          ...signHeaders(plan, { model, requestId: randomUUID() }),
        };
        if (body) headers["Content-Type"] = req.headers.get("content-type") ?? "application/json";
        for (const h of ["accept", "anthropic-version", "anthropic-beta", "user-agent"]) {
          const v = req.headers.get(h);
          if (v) headers[h] = v;
        }
        return fetchImpl(tokenChanged ? target : target, {
          method: req.method,
          headers,
          body,
          redirect: "error",
        }).then((up) => {
          const out = new Headers();
          const ct = up.headers.get("content-type");
          if (ct) out.set("content-type", ct);
          return new Response(up.body, { status: up.status, headers: out });
        });
      };

      let res = await send();
      requestsServed++;
      if (res.status === 401) {
        const refreshed = await ensureFreshCredential();
        if (refreshed) res = await send(true);
      }
      return res;
    },
  });

  return Promise.resolve({
    port: server.port as number,
    hostname,
    stop: () => server.stop(true),
    healthy: () => server !== undefined,
  });
}
