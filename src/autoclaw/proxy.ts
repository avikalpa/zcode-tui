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
          "X-Authorization": bearer(plan.auth.accessToken),
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
