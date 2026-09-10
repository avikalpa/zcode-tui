// NativeAnnounce — the first-party identity + phase wire (yggterm 3.3.0,
// docs/cli-integration-layer.md §2 cap-2/§3).
//
// zcode-tui KNOWS its session id and its turn lifecycle in-process (it drives
// the app-server protocol directly), so it never gets scraped: every state
// change is announced on its own stdout as an OSC 7717 control sequence
//   ESC ] 7717 ; announce ; state ; <base64-json> BEL
// which the yggterm daemon lifts off the PTY (it owns the PTY and sees every
// byte whether or not a GUI looks). Native announce is the TOP of the
// identity precedence chain — a fresh announce outranks env markers, argv
// patterns, store reads and screen phrases.
//
// Emission is on every CHANGE plus a heartbeat carrying the same full state:
// the daemon freshness-bounds the record (ANNOUNCE_FRESH_MS), so a TUI that
// died mid-flight degrades to the phrase matcher instead of lying forever.
// The heartbeats are pure 7717 traffic and never count as session activity
// (`chunk_is_only_app_declares`) — they cannot pin a daemon against retire.

/** The discrete phase enum from the stone spec §2 cap-3. Sent verbatim. */
export type AnnouncePhase =
  | "Working"
  | "Idle"
  | "QuestionPrompt"
  | "LimitWait"
  | "StartupGate";

const HEARTBEAT_MS = 5_000;

/** One announce frame, exactly what the daemon parses. `seq` lets a consumer
 * order frames without clock assumptions. */
export interface AnnounceState {
  session_id: string;
  phase: AnnouncePhase;
  detail?: string;
  ts_ms: number;
  seq: number;
}

export class Announcer {
  private sessionId: string | null = null;
  private phase: AnnouncePhase | null = null;
  private detail: string | undefined;
  private seq = 0;
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  /** A row that is not a terminal (pipes in tests/probes) has no listener;
   * the kill-switch exists for A/B measurement without a rebuild. Tests pass
   * `enabled` explicitly to exercise the wire without a TTY. */
  private enabled: boolean;

  constructor(enabled?: boolean) {
    this.enabled =
      enabled ??
      (Boolean(process.stdout.isTTY) && process.env.ZCODE_TUI_NO_ANNOUNCE !== "1");
  }

  /** Publish the current state; emits only what changed. Identity changes
   * (session switch/resume) always emit even when the phase did not. */
  announce(sessionId: string | null, phase: AnnouncePhase, detail?: string): void {
    if (!this.enabled) return;
    const identityChanged = sessionId !== this.sessionId;
    const phaseChanged = phase !== this.phase || detail !== this.detail;
    this.sessionId = sessionId;
    this.phase = phase;
    this.detail = detail;
    if (!identityChanged && !phaseChanged) return;
    this.emit();
    this.ensureHeartbeat();
  }

  /** Stop the heartbeat (TUI teardown). The last frame stays on the wire;
   * the daemon freshness bound is what expires it. */
  stop(): void {
    if (this.heartbeat !== null) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  private ensureHeartbeat(): void {
    if (this.heartbeat !== null) return;
    this.heartbeat = setInterval(() => this.emit(), HEARTBEAT_MS);
    this.heartbeat.unref?.();
  }

  private emit(): void {
    if (this.phase === null) return;
    const state: AnnounceState = {
      session_id: this.sessionId ?? "",
      phase: this.phase,
      ...(this.detail ? { detail: this.detail } : {}),
      ts_ms: Date.now(),
      seq: ++this.seq,
    };
    // One write: the frame is atomic from the terminal's perspective and the
    // daemon scanner reassembles chunks that straddle reads.
    const payload = Buffer.from(JSON.stringify(state), "utf8").toString("base64");
    process.stdout.write(`\x1b]7717;announce;state;${payload}\x07`);
  }
}
