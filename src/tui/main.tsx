// zcode-tui live entry — spawns app-server, renders the sessions surface.
// OpenTUI core is ESM-with-TLA: dynamic import (fleet law from the
// mock-tui-opentui staging), bun-native entry picked automatically.
import { AppServer } from "../protocol/client";

async function main() {
  // Launch flags: --resume <sessionId> opens straight into a resumed
  // session; --model <modelId> is applied to the first created session.
  // (yggterm's launch/resume contract expects both to exist.)
  const argv = process.argv.slice(2);
  let resumeId: string | null = null;
  let modelId: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--resume") resumeId = argv[++i] ?? null;
    else if (argv[i] === "--model") modelId = argv[++i] ?? null;
  }
  const client = new AppServer({
    onNotification: () => {},
    onServerRequest: (m) => {
      if (m.method === "session/requestRuntimePreferences") {
        client.respond(m.id as string, { nativeSearchEnhancementsEnabled: false });
      } else {
        client.respond(m.id as string, {});
      }
    },
  });

  const [{ createCliRenderer }, { createRoot }, { App }] = await Promise.all([
    import("@opentui/core"),
    import("@opentui/react"),
    import("./app"),
  ]);
  const renderer = await createCliRenderer();
  renderer.setBackgroundColor("#161616");
  createRoot(renderer).render(
    <App client={client} onQuit={() => process.exit(0)} resumeId={resumeId} modelId={modelId} />,
  );
}

void main();
