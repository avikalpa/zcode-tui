// Liveness heartbeat (BUG-001, 2026-10-24): long zcode-tui workers write a
// touch-file every 60s so the queue's stall sweeper can tell "working on a
// long tool call" from "hung in a way that streams nothing". The queue reads
// only the mtime — never the content.
import { appendFileSync } from "node:fs";

export function startHeartbeat(path: string, ms = 60_000): () => void {
  if (!path) return () => {};
  const beat = () => { try { appendFileSync(path, String(Date.now()) + "\n"); } catch { /* best-effort */ } };
  beat();
  const t = setInterval(beat, ms);
  t.unref?.();
  return () => { clearInterval(t); try { appendFileSync(path, String(Date.now()) + "\n"); } catch { /* best-effort */ } };
}
