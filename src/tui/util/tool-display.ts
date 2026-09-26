// Verbatim port from the vendored opencode v2.0.18 reference
// (tui/util/tool-display.ts) — the two helpers the activity summary consumes
// (canonicalToolName, executeCalls). Upstream keeps display-string helpers
// beside them that have no consumer in our tree yet; they are not ported.
// isRecord is inlined locally, as the 0.6.50 error.ts port did.
// #51131 (TRANSCRIPT-VERBOSITY), the R52 wave.

export function canonicalToolName(name: string) {
  if (name === "bash") return "shell"
  if (name === "task") return "subagent"
  if (name === "apply_patch") return "patch"
  return name
}

export type ExecuteCall = { tool: string; status: "running" | "completed" | "error"; input?: Record<string, unknown> }

export function executeCalls(value: unknown): ExecuteCall[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((call) => {
    if (!isRecord(call)) return []
    const tool = call.tool
    const status = call.status
    if (typeof tool !== "string" || (status !== "running" && status !== "completed" && status !== "error")) return []
    return [{ tool, status, input: isRecord(call.input) ? call.input : undefined }]
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
