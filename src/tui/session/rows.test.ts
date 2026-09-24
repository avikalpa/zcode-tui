// Slice-2 tests for the rows layer: upstream's reduction grammar exercised
// over OUR raw record shapes (the normalizeRawMessage boundary included).
import { expect, test } from "bun:test"
import {
  messageBoundaryIDs,
  normalizeRawMessage,
  reduceSessionRows,
  resolvePart,
  sessionRowID,
  turnDuration,
} from "./rows"

const user = (id: string, text: string) => ({
  info: { role: "user", id, time: { created: 1_000 } },
  parts: [{ type: "text", text }],
})

const assistant = (id: string, parts: Record<string, unknown>[], meta: Record<string, unknown> = {}) => ({
  info: { role: "assistant", id, time: { created: 2_000, completed: 3_000 }, model: { modelId: "glm-5.3" }, meta },
  parts,
})

const reasoning = (text: string) => ({ type: "reasoning", text, time: { completed: 2_500 } })
const tool = (callID: string, name: string, status = "completed") => ({
  type: "tool",
  tool: name,
  callID,
  state: { status, input: { command: "ls" }, output: "ok" },
})
const text = (t: string) => ({ type: "text", text: t })

test("normalize lifts raw records: user text joins parts, assistant parts type", () => {
  const m = normalizeRawMessage(user("u1", "hello"))
  expect(m?.type).toBe("user")
  expect(m?.text).toBe("hello")
  const a = normalizeRawMessage(assistant("a1", [reasoning("thinking"), tool("t1", "Bash"), text("done")]))
  expect(a?.content).toHaveLength(3)
  expect(a?.model?.id).toBe("glm-5.3")
  expect(a?.content[1]).toMatchObject({ type: "tool", id: "t1", name: "Bash" })
})

test("assistant parts project: reasoning+exploration groups, text parts, footer row", () => {
  const rows = reduceSessionRows([
    normalizeRawMessage(user("u1", "go"))!,
    normalizeRawMessage(
      assistant("a1", [reasoning("hmm"), tool("t1", "Read"), tool("t2", "Grep"), text("answer")], {
        durationMs: 1_000,
        outputTokens: 10,
      }),
    )!,
  ])
  // user message, reasoning group, exploration group (Read+Grep), text part, footer
  expect(rows.map((r) => r.type)).toEqual(["message", "group", "group", "part", "assistant-footer"])
  const reasoningGroup = rows[1]
  if (reasoningGroup.type !== "group" || reasoningGroup.kind !== "reasoning") throw new Error("expected reasoning group")
  expect(reasoningGroup.completed).toBe(true)
  const exploration = rows[2]
  if (exploration.type !== "group" || exploration.kind !== "exploration") throw new Error("expected exploration group")
  // Read + Grep fold into one exploration group in content order
  expect(exploration.size).toBe(2)
  const textPart = rows[3]
  if (textPart.type !== "part") throw new Error("expected part row")
  expect(textPart.ref).toEqual({ messageID: "a1", partID: "text:0" })
})

test("non-exploration tools stay ungrouped in content order", () => {
  const rows = reduceSessionRows([
    normalizeRawMessage(assistant("a1", [tool("t1", "Bash"), tool("t2", "Edit")]))!,
  ])
  expect(rows.map((r) => r.type)).toEqual(["part", "part", "assistant-footer"])
})

test("empty reasoning/text parts do not project rows, but the turn footer still emits", () => {
  const rows = reduceSessionRows([normalizeRawMessage(assistant("a1", [reasoning(""), text("  ")]))!])
  expect(rows.map((r) => r.type)).toEqual(["assistant-footer"])
})

test("boundary ids mark one anchor per message: user rows and assistant-carrying rows", () => {
  const messages = [
    normalizeRawMessage(user("u1", "question"))!,
    normalizeRawMessage(assistant("a1", [reasoning("x"), text("answer")]))!,
  ]
  const rows = reduceSessionRows(messages)
  const ids = messageBoundaryIDs(rows, messages)
  expect(ids.filter(Boolean)).toEqual(["u1", "a1"])
  expect(sessionRowID(rows[0], ids[0]!)).toBe("u1")
  expect(sessionRowID(rows[1])).toBeUndefined()
})

test("resolvePart finds tools by callID and ordinals by type", () => {
  const m = normalizeRawMessage(assistant("a1", [reasoning("one"), reasoning("two"), tool("t9", "Bash")]))!
  expect(resolvePart(m, "t9")?.type).toBe("tool")
  expect(resolvePart(m, "reasoning:1")).toMatchObject({ type: "reasoning", text: "two" })
  expect(resolvePart(m, "text:0")).toBeUndefined()
})

test("turnDuration prefers the live meta stamp, falls back to record times", () => {
  const messages = [normalizeRawMessage(user("u1", "go"))!, normalizeRawMessage(assistant("a1", [text("x")]))!]
  const a1 = messages[1]
  expect(turnDuration(a1, messages)).toBe(2_000) // completed − input.created (upstream grammar)
  const stamped = normalizeRawMessage(assistant("a1", [text("x")], { durationMs: 4_200 }))!
  expect(turnDuration(stamped, messages)).toBe(4_200)
})
