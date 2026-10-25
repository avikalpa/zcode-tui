// Signed client for the user's own AutoClaw managed model plane.
// Wire contract mined 2026-10-23 from the user's AutoClaw 2.0.3 bundle and
// RE-VALIDATED LIVE 2026-10-25 against the desktop's own connection table
// (runtime.sqlite model_connections: protocol "openai-completions", base
// /autoclaw-proxy/proxy/autoclaw). The full shape that passes auth (403/810001
// plan-busy, not 401) is:
//   X-Auth-Sign   = md5(`${appId}&${unixSec}&${appKey}`).hex
//   X-Authorization = Bearer <token>   (the bundle DELETES Authorization)
//   + X-Version/X-Tm/X-Product/X-Auth-Appid/X-Auth-TimeStamp/X-Lang/X-Channel
//   + X-Request-Model/X-Client-Type/x_trace_id/X-Trace-Id/X-Request-Id/X-Session-Id
// The token must come from /userapi/v1/agent-refresh (source_id "autoclaw") —
// those JWTs carry source_id "agentaccess_token"; the login-stored
// "autoclawaccess_token" JWT is rejected by the model plane (measured).
// Values all come from the user's autoclaw-plan.json; nothing is embedded
// here (see plan.ts boundary).
import { randomUUID, createHash } from "node:crypto";
import { bearer, writePlan, type AutoclawPlan } from "./plan";

export interface SignOptions {
  model?: string; requestId?: string; sessionId?: string;
  /** Which header carries the access token, per measured surface (2026-10-25):
   *  model plane → "x-authorization" (default; Authorization there = 401),
   *  catalog/wallet reads → "authorization" (200 measured),
   *  refresh → "none" (200 measured with sign headers only). */
  auth?: "x-authorization" | "authorization" | "none";
}

export function signHeaders(plan: AutoclawPlan, opts: SignOptions = {}, now = Date.now): Record<string, string> {
  const ts = String(Math.floor(now() / 1000));
  const headers: Record<string, string> = {
    "X-Version": plan.client.version,
    "X-Tm": platformTag(),
    "X-Product": plan.identity.product,
    "X-Auth-Appid": plan.identity.appId,
    "X-Auth-TimeStamp": ts,
    "X-Auth-Sign": createHash("md5").update(`${plan.identity.appId}&${ts}&${plan.identity.appKey}`).digest("hex"),
    "X-Lang": plan.client.lang,
    "X-Client-Type": "pc",
    "x_trace_id": plan.client.traceSource,
  };
  const auth = opts.auth ?? "x-authorization";
  if (auth === "x-authorization") headers["X-Authorization"] = bearer(plan.auth.accessToken);
  else if (auth === "authorization") headers["Authorization"] = bearer(plan.auth.accessToken);
  const channel = plan.client.channel?.trim();
  if (channel) headers["X-Channel"] = channel;
  const rid = opts.requestId ?? randomUUID();
  headers["X-Trace-Id"] = rid;
  headers["X-Request-Id"] = rid;
  if (opts.model) headers["X-Request-Model"] = opts.model;
  if (opts.sessionId) headers["X-Session-Id"] = opts.sessionId;
  return headers;
}

function platformTag(): string {
  if (process.platform === "darwin") return "mac";
  if (process.platform === "win32") return "win";
  return process.platform;
}

export interface GatewayFailure { kind: string; httpStatus?: number; serviceCode?: string; message?: string }

/** Read the documented failure envelope (403/810000 quota, 810001 rate, 410004 banned, 402 points). */
export function readFailureEnvelope(status: number, body: string): GatewayFailure | null {
  try {
    const doc = JSON.parse(body) as { code?: unknown; message?: unknown };
    if (typeof doc.code === "string" || typeof doc.code === "number") {
      return { kind: classifyManagedFailure(status, String(doc.code)), httpStatus: status, serviceCode: String(doc.code), message: typeof doc.message === "string" ? doc.message : undefined };
    }
  } catch { /* not the envelope */ }
  if (status === 401) return { kind: "access_credential_rejected", httpStatus: status };
  return null;
}

export function classifyManagedFailure(status: number, serviceCode: string): string {
  if (status === 403 && serviceCode === "810000") return "managed_model_quota_exhausted";
  if (status === 403 && serviceCode === "810001") return "managed_model_rate_limited";
  if (status === 403 && serviceCode === "410004") return "managed_model_account_banned";
  if (status === 402) return "managed_model_points_insufficient";
  if (status === 401) return "access_credential_rejected";
  return `managed_model_http_${status}`;
}

export type RefreshResult =
  | { ok: true; accessToken: string; refreshToken: string }
  | { ok: false; failureClass: "hard" | "soft" | "transient"; detail: string };

/**
 * POST /userapi/v1/agent-refresh (fallback /userapi/v1/refresh on business
 * code 400002) with {refresh_token, source_id, device_id}; envelope
 * {code:0, data:{access_token, refresh_token}}. Persists the rotated pair.
 * agent-refresh leads: measured 2026-10-25, /refresh answers 400002
 * "Middleware sign error" even when signed, while /agent-refresh returns
 * code 0 with the agentaccess_token class the model plane accepts.
 */
export async function refreshCredential(
  plan: AutoclawPlan,
  fetchImpl: typeof fetch = fetch,
  planPath?: string,
): Promise<RefreshResult> {
  for (const path of [plan.refresh.fallbackPath, plan.refresh.path]) {
    let res: Response;
    try {
      res = await fetchImpl(plan.endpoint.base + path, {
        method: "POST",
        headers: { ...signHeaders(plan, { auth: "none" }), "Content-Type": "application/json" },
        body: JSON.stringify({
          refresh_token: plan.auth.refreshToken,
          source_id: plan.refresh.sourceId,
          device_id: plan.auth.deviceId,
        }),
      });
    } catch (e) {
      return { ok: false, failureClass: "transient", detail: `network: ${(e as Error).message}` };
    }
    const text = await res.text();
    if (res.status >= 500) return { ok: false, failureClass: "transient", detail: `http ${res.status}` };
    let doc: unknown = null;
    try { doc = JSON.parse(text); } catch { /* non-JSON */ }
    const envelope = (doc ?? {}) as { code?: unknown; data?: { access_token?: unknown; refresh_token?: unknown } };
    const code = typeof envelope.code === "number" ? envelope.code : null;
    const accessToken = typeof envelope.data?.access_token === "string" ? envelope.data.access_token : null;
    const refreshToken = typeof envelope.data?.refresh_token === "string" ? envelope.data.refresh_token : null;
    if (code === null) {
      return { ok: false, failureClass: "transient", detail: `non-envelope response (http ${res.status})` };
    }
    if (code === 0 && accessToken && refreshToken) {
      plan.auth.accessToken = accessToken;
      plan.auth.refreshToken = refreshToken;
      plan.auth.updatedAt = new Date().toISOString();
      try { writePlan(plan, planPath); } catch { /* in-memory refresh still holds */ }
      return { ok: true, accessToken: plan.auth.accessToken, refreshToken: plan.auth.refreshToken };
    }
    if (code === 400002) continue; // try the other refresh path
    const failureClass = code === 400000 ? "hard" : code === 510002 ? "soft" : "transient";
    return { ok: false, failureClass, detail: `envelope code ${code}` };
  }
  return { ok: false, failureClass: "transient", detail: "both refresh paths exhausted" };
}

export interface CatalogModel { id: string; name: string; contextWindow: number; maxTokens: number; reasoning: boolean }

/** GET the managed model catalog (the app's own model-config endpoint). */
export async function fetchModelCatalog(plan: AutoclawPlan, fetchImpl: typeof fetch = fetch): Promise<
  { ok: true; models: CatalogModel[] } | { ok: false; failure: GatewayFailure | string }
> {
  let res: Response;
  try {
    res = await fetchImpl(plan.endpoint.base + plan.endpoint.modelConfigPath, {
      headers: signHeaders(plan, { auth: "authorization" }), // catalog read: 200 on Authorization (measured 2026-10-25)
    });
  } catch (e) {
    return { ok: false, failure: `network: ${(e as Error).message}` };
  }
  const text = await res.text();
  if (res.status !== 200) {
    return { ok: false, failure: readFailureEnvelope(res.status, text) ?? `http ${res.status}` };
  }
  try {
    const doc = JSON.parse(text) as { models?: Array<Record<string, unknown>> };
    const models = (doc.models ?? []).map((m) => ({
      id: String(m.id ?? ""),
      name: String(m.name ?? m.id ?? ""),
      contextWindow: Number(m.contextWindow ?? 0),
      maxTokens: Number(m.maxTokens ?? 0),
      reasoning: Boolean(m.reasoning ?? false),
    })).filter((m) => m.id);
    return { ok: true, models };
  } catch {
    return { ok: false, failure: "invalid_response" };
  }
}

export interface CreditsBalance { totalPoints: number; wallets: Array<{ scope: string; balance: number }> }

/**
 * GET the credits balance the desktop's wallet UI reads:
 * /agent-assetmgr/api/v2/wallets?biz_app_id=autoclaw → data.total_balance
 * (+ display wallets), legacy /agent-assetmgr/api/v1/wallet-instances as
 * fallback. Envelope {code:0, data:…}; code 410000 = unauthenticated — the
 * proxy's refresh-retry owns that case, callers just see the failure.
 */
export async function fetchCreditsBalance(plan: AutoclawPlan, fetchImpl: typeof fetch = fetch): Promise<
  { ok: true; credits: CreditsBalance } | { ok: false; failure: GatewayFailure | string }
> {
  const sources = [
    { path: "/agent-assetmgr/api/v2/wallets", query: "biz_app_id=autoclaw" },
    { path: "/agent-assetmgr/api/v1/wallet-instances", query: "" },
  ];
  for (const src of sources) {
    let res: Response;
    try {
      res = await fetchImpl(plan.endpoint.base + src.path + (src.query ? `?${src.query}` : ""), {
        headers: signHeaders(plan, { auth: "authorization" }), // wallet read: Authorization plane (0.8.0 measured)
      });
    } catch (e) {
      return { ok: false, failure: `network: ${(e as Error).message}` };
    }
    const text = await res.text();
    if (res.status !== 200) {
      return { ok: false, failure: readFailureEnvelope(res.status, text) ?? `http ${res.status}` };
    }
    let doc: { code?: unknown; data?: Record<string, unknown> };
    try { doc = JSON.parse(text) as typeof doc; } catch { return { ok: false, failure: "invalid_response" }; }
    if (doc.code === 410000) {
      return { ok: false, failure: { kind: "access_credential_rejected", serviceCode: "410000" } };
    }
    if (doc.code !== 0 || typeof doc.data !== "object" || doc.data === null) continue;
    const data = doc.data;
    const wallets: Array<{ scope: string; balance: number }> = [];
    if (Array.isArray(data.wallets)) {
      for (const w of data.wallets as Array<Record<string, unknown>>) {
        if (w && w.display === true && typeof w.balance === "number") {
          wallets.push({
            scope: String(w.wallet_scope ?? w.scope ?? "").replace("wallet_scope_", ""),
            balance: w.balance,
          });
        }
      }
    }
    const total = typeof data.total_balance === "number"
      ? data.total_balance
      : wallets.reduce((n, w) => n + w.balance, 0);
    return { ok: true, credits: { totalPoints: total, wallets } };
  }
  return { ok: false, failure: "no_credits_source" };
}
