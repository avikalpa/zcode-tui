// Adapted from MIT OpenCode b084acc55ea2cdb50e9c2ec49a8d9ab3608d43ad
// packages/tui/src/component/dialog-status.tsx (see THIRD-PARTY-NOTICES.md): flat sections, subdued details,
// status-colored bullets, and the shared esc dismissal affordance.
import { useKeyboard } from "@opentui/react";
import { useRef } from "react";
import { ScrollBoxRenderable, TextAttributes } from "@opentui/core";
import { ModalBackdrop } from "./select-dialog";
import type { ThemeTokens } from "./design";
import { credentialAge, meterText, type PlanState } from "./plan-state";
export type McpDialogState = { kind: "idle" | "loading" | "unavailable" } | { kind: "ready"; servers: { name: string; status: string; error?: string }[] };
export type PlanUsage = { kind: "loading" | "unavailable" } | { kind: "ready"; tokens: number; sessions?: number };
export function StatusDialog({ C, onClose, mcpState, plans, usage, width, height }: {
  C: ThemeTokens; onClose: () => void; mcpState: McpDialogState; plans: PlanState; usage: PlanUsage; width: number; height: number;
}) {
  const scroll = useRef<ScrollBoxRenderable | null>(null);
  useKeyboard((key) => {
    if (key.name === "escape" || (key.ctrl && key.name === "c")) { onClose(); return; }
    if (key.name === "up" || key.name === "down") scroll.current?.scrollBy(key.name === "up" ? -1 : 1);
    if (key.name === "pageup" || key.name === "pagedown") scroll.current?.scrollBy(key.name === "pageup" ? -10 : 10);
    if (key.name === "home") scroll.current?.scrollTo(0);
    if (key.name === "end") scroll.current?.scrollTo(scroll.current.scrollHeight);
  });
  const color = (s: string) => s === "connected" || s === "available" ? C.success : s === "failed" ? C.error : s === "needs_auth" ? C.warning : C.subtle;
  const servers = mcpState.kind === "ready" ? mcpState.servers : null;
  const maxHeight = Math.max(5, height - Math.floor(height / 4) - 2);
  const bodyRows = 11 + plans.entitlements.length + plans.meters.length * 2 + (servers?.length ?? 0)
    + (!plans.codingCache ? 1 : 0) + (!plans.autoclaw.present ? 1 : 0);
  const bodyHeight = Math.min(bodyRows, Math.max(1, maxHeight - 5));
  return <ModalBackdrop C={C} width={width} height={height}>
    <box style={{ width: Math.min(72, Math.max(20, width - 2)), maxHeight, flexDirection: "column", backgroundColor: C.panel, paddingTop: 1, paddingBottom: 1, paddingLeft: 2, paddingRight: 2, flexShrink: 0 }}>
      <box style={{ height: 1, flexDirection: "row", justifyContent: "space-between", flexShrink: 0 }}>
        <text content="Status" fg={C.fg} attributes={TextAttributes.BOLD} />
        <text content="esc" fg={C.faint} onMouseUp={onClose} />
      </box>
      <box style={{ height: 1, flexShrink: 0 }} />
      <scrollbox ref={scroll} style={{ height: bodyHeight, flexDirection: "column", flexShrink: 0 }} scrollbarOptions={{ visible: false }}>
        <box style={{ flexDirection: "column", gap: 1, flexShrink: 0 }}>
          <box style={{ flexDirection: "column", flexShrink: 0 }}>
            <text content="Z.AI Coding Plan" fg={C.fg} attributes={TextAttributes.BOLD} />
            {plans.codingCache ? <text content={`Entitlements · cached · ${credentialAge(plans.codingCacheAgeMs ?? null)}`} fg={C.subtle} /> : null}
            {!plans.codingCache ? <text content="Entitlements unavailable · no local cache" fg={C.subtle} /> : null}
            {plans.entitlements.map((e) => <text key={e.label} fg={color(e.status)} content={`• ${e.label} · ${e.status}`} />)}
            {plans.meters.map((m) => <box key={m.label} style={{ flexDirection: "column", flexShrink: 0 }}>
              <text content={m.label} fg={C.subtle} />
              <text content={meterText(m)} fg={m.used >= m.limit ? C.warning : C.success} />
            </box>)}
            {!plans.meters.length ? <text content="Quota meters unavailable · limits not exposed in cache" fg={C.subtle} /> : <text content="Usage from local cache" fg={C.subtle} />}
            <text fg={C.subtle} content={usage.kind === "ready" ? `Last 7 days · ${usage.tokens.toLocaleString("en-US")} tokens${usage.sessions === undefined ? "" : ` · ${usage.sessions} sessions`}` : usage.kind === "loading" ? "Usage · loading…" : "Usage unavailable · runtime did not return telemetry"} />
          </box>
          <box style={{ flexDirection: "column", flexShrink: 0 }}>
            <text content="AutoClaw" fg={C.fg} attributes={TextAttributes.BOLD} />
            <text content={`• Plan file · ${plans.autoclaw.present ? "present" : "not configured"}`} fg={plans.autoclaw.present ? C.success : C.subtle} />
            <text content={`Credential · ${plans.autoclaw.credentialReady ? credentialAge(plans.autoclaw.credentialAgeMs) : "not provisioned"}`} fg={C.subtle} />
            <text content={`Catalog · ${plans.autoclaw.models.length} ${plans.autoclaw.catalogSource === "fallback" ? "known models · offline fallback" : `models · ${plans.autoclaw.catalogSource}`}`} fg={C.subtle} />
            {!plans.autoclaw.present ? <text content="Run zcode-tui autoclaw setup" fg={C.subtle} /> : null}
          </box>
          <box style={{ flexDirection: "column", flexShrink: 0 }}>
            <text content={mcpState.kind === "unavailable" ? "MCP servers unavailable · request failed" : servers === null ? "MCP servers · loading…" : servers.length ? `${servers.length} MCP server${servers.length === 1 ? "" : "s"}` : "No MCP servers"} fg={C.fg} />
            {servers?.map((s) => <box key={s.name} style={{ flexDirection: "row", gap: 1, flexShrink: 0 }}>
              <text content="•" fg={color(s.status)} style={{ flexShrink: 0 }} />
              <text fg={C.fg} wrapMode="word" style={{ flexShrink: 1, flexGrow: 1 }}>
                <b>{s.name}</b>{" "}
                <span fg={C.subtle}>{s.status === "connected" ? "Connected"
                  : s.status === "failed" ? s.error || "Failed"
                  : s.status === "disabled" ? "Disabled in configuration"
                  : s.status === "needs_auth" ? `Needs authentication${s.error ? `: ${s.error}` : ""}`
                  : s.status}</span>
              </text>
            </box>)}
          </box>
        </box>
      </scrollbox>
      <text content="↑/↓ scroll · esc close" fg={C.faint} />
    </box>
  </ModalBackdrop>;
}
