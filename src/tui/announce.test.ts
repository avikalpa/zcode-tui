// NativeAnnounce wire tests — frame format, change detection, identity rides
// every frame, and the disabled/kill-switch behaviour. The heartbeat cadence
// itself is verified live (PTY law: the daemon scanner sees real rows, not
// mocked timers).
import { describe, expect, test } from "bun:test";
import { Announcer, type AnnounceState } from "./announce";

function captureFrames() {
  const frames: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  (process.stdout as unknown as { write: (chunk: string) => boolean }).write = (
    chunk: string,
  ) => {
    frames.push(chunk);
    return true;
  };
  return {
    frames,
    restore: () => {
      (process.stdout as unknown as { write: (chunk: string) => boolean }).write =
        original;
    },
  };
}

function decode(frame: string): AnnounceState {
  const match = /^\x1b\]7717;announce;state;([A-Za-z0-9+/=]+)\x07$/.exec(frame);
  if (!match) throw new Error(`not an announce frame: ${JSON.stringify(frame)}`);
  return JSON.parse(Buffer.from(match[1]!, "base64").toString("utf8")) as AnnounceState;
}

describe("NativeAnnounce emitter", () => {
  test("emits the OSC 7717 announce frame with identity and phase", () => {
    const cap = captureFrames();
    try {
      const a = new Announcer(true);
      a.announce("sess_abc", "Working");
      expect(cap.frames.length).toBe(1);
      const state = decode(cap.frames[0]!);
      expect(state.session_id).toBe("sess_abc");
      expect(state.phase).toBe("Working");
      expect(state.seq).toBe(1);
      expect(typeof state.ts_ms).toBe("number");
    } finally {
      cap.restore();
    }
  });

  test("an unchanged state does not re-emit; the phase change does", () => {
    const cap = captureFrames();
    try {
      const a = new Announcer(true);
      a.announce("sess_abc", "Idle");
      a.announce("sess_abc", "Idle");
      expect(cap.frames.length).toBe(1);
      a.announce("sess_abc", "QuestionPrompt");
      expect(cap.frames.length).toBe(2);
      expect(decode(cap.frames[1]!).phase).toBe("QuestionPrompt");
    } finally {
      cap.restore();
    }
  });

  test("identity change emits even when the phase did not (session switch)", () => {
    const cap = captureFrames();
    try {
      const a = new Announcer(true);
      a.announce("sess_a", "Idle");
      a.announce("sess_b", "Idle");
      expect(cap.frames.length).toBe(2);
      expect(decode(cap.frames[1]!).session_id).toBe("sess_b");
    } finally {
      cap.restore();
    }
  });

  test("detail rides the frame and counts as change (backend-lost)", () => {
    const cap = captureFrames();
    try {
      const a = new Announcer(true);
      a.announce("sess_a", "Idle");
      a.announce("sess_a", "Idle", "backend-lost");
      expect(cap.frames.length).toBe(2);
      expect(decode(cap.frames[1]!).detail).toBe("backend-lost");
    } finally {
      cap.restore();
    }
  });

  test("seq increases monotonically across frames", () => {
    const cap = captureFrames();
    try {
      const a = new Announcer(true);
      a.announce("s", "StartupGate");
      a.announce("s", "Working");
      a.announce("s", "Idle");
      expect(cap.frames.map((f) => decode(f).seq)).toEqual([1, 2, 3]);
    } finally {
      cap.restore();
    }
  });

  test("disabled announcer (no TTY / kill-switch) writes nothing", () => {
    const cap = captureFrames();
    try {
      const a = new Announcer(false);
      a.announce("sess_a", "Working");
      a.stop();
      expect(cap.frames.length).toBe(0);
    } finally {
      cap.restore();
    }
  });
});
