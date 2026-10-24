// Adapted from MIT OpenCode b084acc packages/tui/src/component/prompt/index.tsx
// and feature-plugins/prompt/footer.tsx. See THIRD-PARTY-NOTICES.md.
import type { ThemeTokens } from "./design";
import { truncateFilePath } from "./diff/file-path";
import { stringWidth } from "./diff/string-width";

// The reference reserves a share of the row for location before admitting
// usage and shortcuts. Terminal cells, rather than UTF-16 length, own fit.
function promptFooterLayout(input: { width: number; usage: string[]; shortcuts: string[] }) {
  const usage = input.usage.join(" · ");
  const shortcuts = input.shortcuts.join(" · ");
  const available = Math.max(0, input.width - Math.min(28, Math.floor(input.width / 2)));
  if (usage && shortcuts && stringWidth(`${usage} · ${shortcuts}`) <= available) return { usage: true, shortcuts: true };
  if (usage && stringWidth(usage) <= available) return { usage: true, shortcuts: false };
  if (!usage && shortcuts && stringWidth(shortcuts) <= available) return { usage: false, shortcuts: true };
  return { usage: false, shortcuts: false };
}

export function PromptFooter({ C, width, location, running, spinner, lost, context = "", mcp, version }: {
  C: ThemeTokens; width: number; location: string; running?: boolean; spinner?: string;
  lost?: boolean; context?: string; mcp?: { total: number; failed: number } | null; version?: string;
}) {
  const layout = context ? promptFooterLayout({ width: Math.max(0, width - 8), usage: [context], shortcuts: ["ctrl+p commands"] })
    : { usage: false, shortcuts: width >= 44 };
  const hints = !running && layout.shortcuts;
  const usage = layout.usage ? context : "";
  const mcpLabel = mcp?.total ? `⊙ ${mcp.failed ? `${mcp.failed} MCP failed` : `${mcp.total} MCP`}` : "";
  const labels = [mcpLabel, usage, hints && !context ? "shift+tab agents" : "", hints ? "ctrl+p commands" : "", version ?? ""].filter(Boolean) as string[];
  const rightWidth = labels.reduce((n, label) => n + stringWidth(label), 0) + Math.max(0, labels.length - 1) * 3;
  const leftWidth = Math.max(0, width - rightWidth - (labels.length ? 2 : 0));
  const left = running ? `${spinner ?? "[⋯]"} esc interrupt` : lost ? "backend lost · r to reconnect" : truncateFilePath(location, leftWidth);
  return <box style={{ height: 1, width, flexDirection: "row", justifyContent: "space-between", gap: 2, flexShrink: 0, minWidth: 0 }}>
    <text content={left} fg={running ? C.fg : C.subtle} wrapMode="none" truncate style={{ width: leftWidth, flexShrink: 1, minWidth: 0 }} />
    <box style={{ flexDirection: "row", gap: 3, flexShrink: 0 }}>
      {mcpLabel ? <text content={mcpLabel} fg={mcp!.failed ? C.error : C.success} wrapMode="none" /> : null}
      {usage ? <text content={usage} fg={C.subtle} wrapMode="none" /> : null}
      {hints && !context ? <text fg={C.fg} wrapMode="none">shift+tab <span fg={C.subtle}>agents</span></text> : null}
      {hints ? <text fg={C.fg} wrapMode="none">ctrl+p <span fg={C.subtle}>commands</span></text> : null}
      {version ? <text content={version} fg={C.faint} wrapMode="none" /> : null}
    </box>
  </box>;
}
