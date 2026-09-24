// Verbatim port from the vendored opencode v2.0.16 reference
// (tui/routes/session/rows.ts, commit 0332a26be6 #50930) — load history until
// the oldest group is complete: a transcript whose oldest row is a group keeps
// paging, because the group's head may still be over the page boundary. The
// pure async core with an injected contract; upstream hosts it inside the
// Solid rows store — that re-home lands here in slice 2 when the render
// rework gives it its rows.ts home. Slice 1: model only, unwired.
import type { SessionRow } from "./session"

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
