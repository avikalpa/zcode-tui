// Restart half of the 0.6.6 UX persistence proof: boots ONE fresh App and
// asserts the composer advertises the effort persisted by ux-proof.tsx in
// ~/.config/zcode-tui/state.json (the opencode model.json pattern).
import { testRender } from "@opentui/react/test-utils";
import { existsSync, readFileSync } from "node:fs";
import { AppServer } from "../protocol/client";

const statePath = `${process.env.HOME}/.config/zcode-tui/state.json`;
const raw = existsSync(statePath) ? readFileSync(statePath, "utf8") : "{}";
const pickedEffort = Object.values((JSON.parse(raw) as { variant?: Record<string, string> }).variant ?? {})[0];
if (!pickedEffort) {
  console.log("FAIL no persisted effort in state.json to check");
  process.exit(1);
}
const client = new AppServer({
  onServerRequest: (m) => {
    if (m.method === "session/requestRuntimePreferences") client.respond(m.id as string, { nativeSearchEnhancementsEnabled: false });
    else client.respond(m.id as string, {});
  },
});
const { App } = await import("./app");
const setup = await testRender(<App client={client} onQuit={() => process.exit(0)} />, { width: 110, height: 30 });
let ok = false;
let frame = "";
for (let i = 0; i < 16; i += 1) {
  await new Promise((r) => setTimeout(r, 500));
  frame = setup.captureCharFrame();
  if (frame.includes(` · ${pickedEffort}`)) { ok = true; break; }
}
console.log(`${ok ? "PASS" : "FAIL"} second boot shows persisted effort "${pickedEffort}"`);
if (existsSync(".ui/zcode-tui")) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(".ui/zcode-tui/zc-066-second-boot.txt", frame);
}
process.exit(ok ? 0 : 1);
