// Dual-source ytrace probes — the zcode-tui STIMULUS half.
//
// The contract (docs/probes.md): every integration milestone is announced by
// BOTH ends. yggterm is the WITNESS (its cli/* chain and daemon probes emit
// ytrace rows for what a row does); zcode-tui is the STIMULUS (it announces
// its own milestones on the one channel that already crosses every hop —
// the terminal title sequence, ESC ]0; <text> BEL). The PTY relay carries
// titles from any host to the daemon natively, so remote rows probe
// identically, and a plain terminal silently ignores them (the degradation
// story).
//
// Title grammar: `zcode-tui|<milestone>|<detail>` — matched by the
// descriptor-side verifier (see yggterm docs/cli-integration.md).
// Also appended to ~/.yggterm/cli-trace/zcode-tui.jsonl when the directory
// exists (full-fidelity offline capture; the title is the live channel).

import { appendFileSync, mkdirSync, existsSync, writeSync, openSync, closeSync } from "node:fs";

export type Milestone =
  | "boot" // process started, flags parsed
  | "backend-spawn" // app-server child spawn beginning
  | "backend-live" // app-server answered its first request
  | "list-ok" // session/list returned
  | "resume" // a session was resumed
  | "turn-start" // a prompt was sent
  | "turn-end" // the turn's final content arrived
  | "permission-ask" // a permission banner went up
  | "permission-answered" // the banner was resolved
  | "renderer-live" // OpenTUI committed the first frame
  | "quit";

const inYggterm = () => !!process.env.YGGTERM_SESSION_ID;

function emitRaw(milestone: Milestone, detail: string) {
  if (inYggterm()) {
    // Direct fd write: OpenTUI owns stdout's buffered writer, and an OSC 0
    // title is consumed by the terminal emulator, never painted.
    try {
      // OpenTUI replaces process.stdout.write AND holds fd 1 — bytes routed
      // there never reach the PTY. /dev/tty is the controlling terminal (the
      // same PTY) opened fresh: immune to stdout interception. The OSC title
      // is consumed by the terminal emulator and never painted.
      const tty = openSync("/dev/tty", "w");
      try {
        writeSync(tty, `\x1b]0;zcode-tui|${milestone}|${detail}\x07`);
      } finally {
        closeSync(tty);
      }
    } catch {
      // no controlling tty (piped run) — the jsonl below still records it
    }
  }
  try {
    const dir = `${process.env.HOME}/.yggterm/cli-trace`;
    if (existsSync(dir)) {
      appendFileSync(
        `${dir}/zcode-tui.jsonl`,
        JSON.stringify({
          ts: Date.now(),
          pid: process.pid,
          event: milestone,
          detail,
        }) + "\n",
      );
    }
  } catch {
    // trace file is best-effort
  }
}

let last = "";
export function probe(milestone: Milestone, detail = ""): void {
  const d = `${milestone}|${detail}`;
  if (d === last) return; // dedupe: identical back-to-back probes are noise
  last = d;
  emitRaw(milestone, detail);
}

export function initProbeDir(): void {
  const dir = `${process.env.HOME}/.yggterm/cli-trace`;
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  } catch {
    // optional
  }
}
