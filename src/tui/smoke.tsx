// Headless OpenTUI React smoke: renders a box+text via testRender and
// prints the captured character frame. No PTY needed — CI-able.
import { testRender } from "@opentui/react/test-utils";

const setup = await testRender(
  <box style={{ flexDirection: "column", padding: 1 }}>
    <text content="zcode-tui smoke OK" />
    <text content="OpenTUI React renderer alive" />
  </box>,
  { width: 40, height: 8 },
);
await setup.waitForFrame((f) => f.includes("smoke OK"), { timeoutMs: 5000 } as never);
console.log(setup.captureCharFrame());
process.exit(0);
