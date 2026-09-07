// zcode-tui live entry — spawns app-server, renders the sessions surface.
// OpenTUI core is ESM-with-TLA: dynamic import (fleet law from the
// mock-tui-opentui staging), bun-native entry picked automatically.
import { AppServer } from "../protocol/client";

async function main() {
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
    <App client={client} onQuit={() => process.exit(0)} />,
  );
}

void main();
