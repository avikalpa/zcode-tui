// One-shot cleanup: close the proof battery's throwaway sessions from the
// shared daemon store (they bury real work in /sessions). Closes ONLY titles
// matching the proof patterns; everything else is left untouched.
import { AppServer } from "../src/protocol/client";

const PATTERNS = [/pf636/i, /ym-mode-proof/i, /zct-proof-cwd/i, /^reply with exactly/i];

async function main() {
  const client = new AppServer({}, { onStderr: () => {} });
  client.onAsk(() => ({}));
  let closed = 0;
  for (let pass = 0; pass < 6; pass++) {
    const res = (await client.request("session/list", { limit: 100 }, 45000)) as {
      sessions?: Record<string, unknown>[];
    };
    const rows = res.sessions ?? [];
    const victims = rows.filter((r) => {
      const title = String(r.title ?? r.name ?? "");
      return PATTERNS.some((p) => p.test(title));
    });
    if (victims.length === 0) {
      console.log(`pass ${pass}: ${rows.length} visible, 0 matches — done`);
      break;
    }
    for (const v of victims) {
      const title = String(v.title ?? v.name ?? "");
      const id = String(v.sessionId ?? v.id ?? "");
      try {
        await client.request("session/close", { sessionId: id }, 30000);
        closed += 1;
        console.log(`closed: ${title}`);
      } catch (e) {
        console.log(`FAILED: ${title}: ${String(e).slice(0, 120)}`);
      }
    }
  }
  console.log(`total closed: ${closed}`);
  process.exit(0);
}
void main();
