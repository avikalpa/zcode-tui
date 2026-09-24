// The store-side transcript rows layer, ported from the vendored opencode
// v2.0.16 reference (tui/routes/session/rows.ts) — slice 2 of the
// transcript-render refactor family. The grouping model (projectEntries and
// friends) landed in slice 1; this module adds the reduction from SESSION
// MESSAGES to SessionRows plus the footer/timeline helpers.
//
// Wiring adaptations (the grammar is upstream's; only the data boundary is
// ours, as the port law allows):
// - upstream reads @opencode/client SessionMessageInfo records; ours are the
//   zcode host's raw records ({info, parts}) — normalizeRawMessage lifts them
//   into the same shape the reducer walks (roles, typed parts, times).
// - upstream's createSessionRows subscribes to their client store's
//   fine-grained events; our store patches raw records wholesale, so the app
//   re-reduces on change (useMemo) instead of subscribing — same rows.
// - turn_tokens is upstream's config.debug surface; ours passes false (the
//   turn-usage flush stays verbatim and stays inert), and permission-blocked
//   partitioning runs on an empty set (our asks carry no tool-call source).
// - CacheUsage.model is the slice-1 wiring seam, now typed onto our model ref.
import {
  partitionPending,
  projectEntries,
  groupRefs,
  type CacheUsage,
  type PartRef,
  type ProjectionEntry,
  type SessionRow,
} from "./grouping/session"

export type { CacheUsage, PartRef, SessionRow } from "./grouping/session"

/** Our model ref (the slice-1 seam, filled): the allowlist carries
 * providerId/modelId; the session payload's model.modelId rides id. */
export type ModelRef = { providerID: string; id: string; variant?: string }

/** A raw zcode host message record as the session store keeps it. */
export type RawMessageRecord = {
  info: Record<string, unknown>
  parts: Record<string, unknown>[]
}

export type NormPart =
  | { type: "text"; text: string; time?: { created?: number; completed?: number } }
  | { type: "reasoning"; text: string; time?: { created?: number; completed?: number } }
  | {
      type: "tool"
      id: string
      name: string
      state: {
        status: string
        input: Record<string, unknown>
        output?: string
        error?: string
      }
    }

export type NormMessage = {
  type: "user" | "assistant" | "synthetic" | "compaction" | "idle"
  id: string
  text: string
  time: { created: number; completed?: number }
  model?: ModelRef
  content: NormPart[]
  tokens?: { output: number; reasoning: number }
  meta?: { durationMs?: number; outputTokens?: number; reasoningTokens?: number; interrupted?: boolean }
  finish?: string
  error?: string
  retry?: unknown
  status?: string
}

const num = (v: unknown): number => (typeof v === "number" ? v : Number(v) || 0)

/** Lift a raw host record onto the shape the reducer walks. Tool part ids
 * ride the host callID (upstream: part.id); text/reasoning parts get their
 * ordinal ids in the reducer, matching upstream's content-order rule. */
export function normalizeRawMessage(raw: RawMessageRecord): NormMessage | null {
  const info = raw.info ?? {}
  const role = String(info.role ?? "user")
  if (!["user", "assistant", "synthetic", "compaction", "idle"].includes(role)) return null
  const time = (info.time ?? {}) as Record<string, unknown>
  const created = num(time.created) || num(info.createdAt) || Date.now()
  const completed = num(time.completed) || undefined
  const modelInfo = (info.model ?? {}) as Record<string, unknown>
  const parts = Array.isArray(raw.parts) ? raw.parts : []
  let userText = ""
  const content: NormPart[] = []
  for (const p of parts) {
    const type = String(p.type ?? "text")
    if (role !== "assistant") {
      if (typeof p.text === "string") userText += (userText ? "\n" : "") + p.text
      continue
    }
    if (type === "reasoning" || type === "text") {
      const ptime = p.time as Record<string, unknown> | undefined
      const stamp = ptime
        ? { created: num(ptime.created) || undefined, completed: num(ptime.completed) || undefined }
        : undefined
      if (type === "reasoning") content.push({ type: "reasoning", text: String(p.text ?? ""), time: stamp })
      else content.push({ type: "text", text: String(p.text ?? ""), time: stamp })
    } else if (type === "tool") {
      const state = (p.state ?? {}) as Record<string, unknown>
      content.push({
        type: "tool",
        id: String(p.callID ?? ""),
        name: String(p.tool ?? "tool"),
        state: {
          status: String(state.status ?? "running"),
          input: (state.input ?? {}) as Record<string, unknown>,
          output:
            typeof state.output === "string" ? state.output : typeof state.result === "string" ? state.result : undefined,
          error: typeof state.error === "string" ? state.error : undefined,
        },
      })
    }
  }
  return {
    type: role as NormMessage["type"],
    id: String(info.id ?? info.messageId ?? ""),
    text: userText,
    time: { created, completed },
    model:
      role === "assistant"
        ? {
            providerID: String(modelInfo.providerId ?? modelInfo.providerID ?? "zcode"),
            id: String(modelInfo.modelId ?? modelInfo.id ?? ""),
          }
        : undefined,
    content,
    meta: (info.meta ?? undefined) as NormMessage["meta"],
    finish: typeof info.finish === "string" ? info.finish : undefined,
    error:
      typeof (info.error as Record<string, unknown> | undefined)?.message === "string"
        ? String((info.error as Record<string, unknown>).message)
        : undefined,
    status: String(info.status ?? "") || undefined,
  }
}

/**
 * A page boundary can cut a group in half, which would show a partial summary
 * and give the group a provisional ID (derived from its first part). While the
 * oldest row is a group, keep loading older pages until something precedes it.
 * (Upstream rows.ts verbatim; our resume loads the full list, so `more` is
 * always false here — the loop is inert but the contract stays.)
 */
export async function completeGroupBoundary(input: {
  rows: readonly SessionRow[]
  messages: () => number
  more: () => boolean
  loadMore: () => Promise<void>
  active: () => boolean
}) {
  while (input.active() && input.rows[0]?.type === "group" && input.more()) {
    const before = input.messages()
    await input.loadMore()
    // A page that adds nothing would otherwise loop forever.
    if (input.messages() === before) return
  }
}

export function reduceSessionRows(messages: NormMessage[], inputs = new Set<string>(), turnTokens = false) {
  const isInput = (message: NormMessage) => inputs.has(message.id)
  const pendingCompactions = messages.filter((message) => message.type === "compaction" && message.status === "running")
  const pending = new Set([...pendingCompactions.map((message) => message.id), ...inputs])
  const usage = turnTokens
    ? { steps: [] as NormMessage[], previousTurnCache: undefined as CacheUsage | undefined }
    : undefined
  // Without any idle marker, history predates markers and a turn ends with its terminal step.
  // With markers, steers keep the turn open, so usage accumulates until the marker closes it.
  const legacy = !messages.some((message) => message.type === "idle")
  const flushTurn = (rows: ProjectionEntry[]) => {
    if (!usage) return
    const steps = usage.steps.filter(hasTokenUsage)
    const last = steps.at(-1)
    usage.steps.length = 0
    if (!last) return
    rows.push({
      entry: {
        type: "turn-usage",
        messageIDs: steps.map((step) => step.id),
        ...(usage.previousTurnCache === undefined ? {} : { previousCache: usage.previousTurnCache }),
      },
    })
    // Our payload carries no cache-read token field, so the previous-turn
    // cache baseline records zero reads; the whole flush is inert under
    // turnTokens=false anyway.
    usage.previousTurnCache = { read: 0, model: last.model ?? { providerID: "zcode", id: "" } }
  }
  const entries = [
    ...messages.filter((message) => !pending.has(message.id)),
    ...pendingCompactions,
    ...messages.filter(isInput),
  ].reduce<ProjectionEntry[]>((rows, message) => {
    if (message.type !== "assistant") {
      if (message.type === "idle") {
        flushTurn(rows)
        return rows
      }
      if (message.type === "synthetic" && !message.text.trim()) return rows
      if (message.type === "compaction" && message.status === "completed" && usage) usage.previousTurnCache = undefined
      rows.push({ entry: { type: "message", messageID: message.id }, closesPrevious: !pending.has(message.id) })
      return rows
    }
    usage?.steps.push(message)
    const ordinals = { text: 0, reasoning: 0 }
    message.content.forEach((part) => {
      const partID = part.type === "tool" ? part.id : `${part.type}:${ordinals[part.type]++}`
      if ((part.type === "text" || part.type === "reasoning") && !part.text.trim()) return
      rows.push({
        entry: { type: "part", ref: { messageID: message.id, partID } },
        part:
          part.type === "tool"
            ? { type: "tool", name: part.name }
            : part.type === "reasoning"
              ? {
                  type: "reasoning",
                  time: part.time?.completed !== undefined ? { completed: part.time.completed } : undefined,
                }
              : { type: "text" },
      })
    })
    // Upstream keys the terminal step off message.finish; our records carry
    // no finish field — in our store the record's completed time IS the turn
    // boundary (the host folds each turn's steps into one assistant record),
    // so terminality reads completed-or-error.
    const terminal = message.time.completed !== undefined || Boolean(message.error)
    if (terminal || message.retry) {
      rows.push({ entry: { type: "assistant-footer", messageID: message.id } })
    }
    if (terminal && legacy) flushTurn(rows)
    return rows
  }, [])
  const rows = projectEntries(entries)
  partitionPending(rows, new Set<string>())
  return rows
}

export function cacheReuseDrop(previous: CacheUsage | undefined, current: CacheUsage) {
  if (previous === undefined) return
  const prev = previous.model as ModelRef
  const cur = current.model as ModelRef
  if (prev.providerID !== cur.providerID || prev.id !== cur.id || prev.variant !== cur.variant) return
  const drop = previous.read - current.read
  // OpenAI cache reads can move between one and two 1,024-token buckets without a material loss of reuse.
  if (cur.providerID === "openai" && drop >= 1_024 && drop <= 2_048) return
  return drop > 0 ? drop : undefined
}

// `legacy` marks a session without idle markers, where a turn ends at the next prompt. Reactive
// callers should pass it from a shared memo: the default scans every message, which subscribes
// the footer to the whole history.
export function turnDuration(
  message: NormMessage,
  messages: NormMessage[],
  position?: number,
  legacy = legacyTurns(messages),
) {
  // The live path stamps meta.durationMs at turn-end/stop (the flat model's
  // field); history falls back to the record's own times.
  if (message.meta?.durationMs !== undefined) return Math.max(0, message.meta.durationMs)
  if (message.time.completed === undefined) return 0
  const index = position ?? messages.findIndex((item) => item.id === message.id)
  const input = messages[inputIndex(messages, index === -1 ? messages.length : index, legacy)]
  return Math.max(0, message.time.completed - (input?.time.created ?? message.time.created))
}

export function turnTokensPerSecond(
  message: NormMessage,
  messages: NormMessage[],
  position?: number,
  legacy = legacyTurns(messages),
) {
  if (message.time.completed === undefined) return undefined
  const index = position ?? messages.findIndex((item) => item.id === message.id)
  const end = index === -1 ? messages.length : index + 1
  const start = inputIndex(messages, end, legacy)
  const steps = messages
    .slice(start + 1, end)
    .filter((item): item is NormMessage => item.type === "assistant")
  const durations = steps.flatMap((step) =>
    step.time.completed === undefined ? [] : [Math.max(0, step.time.completed - step.time.created)],
  )
  if (steps.length === 0 || durations.length !== steps.length) return undefined
  const output = steps.reduce((total, step) => total + (step.tokens?.output ?? 0) + (step.tokens?.reasoning ?? 0), 0)
  const duration = durations.reduce((total, value) => total + value, 0)
  if (output <= 0 || duration <= 0) return undefined
  // Aggregate before dividing so each step is weighted by its provider-active duration.
  return output / (duration / 1_000)
}

export function legacyTurns(messages: NormMessage[]) {
  return !messages.some((message) => message.type === "idle")
}

function inputIndex(messages: NormMessage[], end: number, legacy: boolean) {
  // Reading a sliced prefix subscribes every footer to unrelated historical messages, so walk
  // back only as far as the turn boundary: the nearest input in legacy sessions, otherwise the
  // first input after the previous idle marker.
  let input = -1
  for (let index = end - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.type === "idle") return input
    if (message.type !== "user" && message.type !== "synthetic") continue
    if (legacy) return index
    input = index
  }
  return input
}

function hasTokenUsage(message: NormMessage): message is NormMessage & { tokens: NonNullable<NormMessage["tokens"]> } {
  return message.tokens !== undefined && tokenTotal(message.tokens) > 0
}

function tokenTotal(tokens: NonNullable<NormMessage["tokens"]>) {
  return tokens.output + tokens.reasoning
}

export function messageBoundaryIDs(rows: SessionRow[], messages: NormMessage[]) {
  const byID = new Map(messages.map((message) => [message.id, message]))
  const seen = new Set<string>()
  return rows.map((row) => {
    const id = rowBoundaryMessageID(row, byID)
    if (!id || seen.has(id)) return undefined
    seen.add(id)
    return id
  })
}

export function sessionRowID(row: SessionRow, boundaryID?: string) {
  if (boundaryID) return boundaryID
  if (row.type === "part") return `session-part:${row.ref.messageID}:${row.ref.partID}`
}

function rowBoundaryMessageID(row: SessionRow, messages: Map<string, NormMessage>) {
  if (row.type === "message") {
    const message = messages.get(row.messageID)
    if (message?.type === "user" && message.text.trim()) return message.id
    return undefined
  }
  const messageID =
    row.type === "part"
      ? row.ref.messageID
      : row.type === "group"
        ? groupRefs(row)[0]?.messageID
        : row.type === "assistant-footer"
          ? row.messageID
          : row.type === "turn-usage"
            ? row.messageIDs[0]
            : undefined
  if (!messageID) return undefined
  const message = messages.get(messageID)
  if (message?.type === "assistant") return message.id
}

export function resolvePart(message: NormMessage, partID: string) {
  const tool = message.content.find((part) => part.type === "tool" && part.id === partID)
  if (tool) return tool
  const match = /^(text|reasoning):(\d+)$/.exec(partID)
  if (!match) return
  const ordinal = Number(match[2])
  return message.content.filter((part) => part.type === match[1])[ordinal]
}
