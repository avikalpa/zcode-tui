// zcode-tui live entry — spawns app-server, renders the sessions surface.
// OpenTUI core is ESM-with-TLA: dynamic import (fleet law from the
// mock-tui-opentui staging), bun-native entry picked automatically.
import pkg from "../../package.json";
import { AppServer } from "../protocol/client";
import { syncAuthAtStartup } from "../auth/sync";
import { probe, initProbeDir } from "./probes";
import { THEMES } from "./design";

initProbeDir();

async function main() {
  // Launch flags: --resume <sessionId> opens straight into a resumed
  // session; --model <modelId> is applied to the first created session.
  // (yggterm's launch/resume contract expects both to exist.)
  const argv = process.argv.slice(2);
  let resumeId: string | null = null;
  let modelId: string | null = null;
  let launchMode: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--version" || argv[i] === "-V") {
      // The compiled dist binary has no shim around it (ynpm dev installs
      // take the ELF directly), so the version probe must live here.
      console.log(`zcode-tui ${pkg.version}`);
      process.exit(0);
    }
    if (argv[i] === "--resume") resumeId = argv[++i] ?? null;
    else if (argv[i] === "--model") modelId = argv[++i] ?? null;
    else if (argv[i] === "--mode") launchMode = argv[++i] ?? null;
  }
  probe("boot", `pid=${process.pid} argv=${JSON.stringify(argv)}`);
  // Auth IS the zcode machine settings: sync the SSOT (fleet default jojo —
  // local read here, `ssh jojo` elsewhere) into the TUI config, heal the
  // local machine settings from it, and hand the stored copy to the backend.
  // Fail-soft: no network/jojo must never block the boot.
  const auth = syncAuthAtStartup();
  if (auth) {
    probe("auth-sync", `source=${auth.source} fp=${auth.fingerprint} healed=${auth.healedMachineSettings}`);
  } else {
    probe("auth-sync", "skipped (no source reachable)");
  }
  probe("backend-spawn", "");
  const client = new AppServer({
    onNotification: () => {},
    onServerRequest: (m) => {
      if (m.method === "session/requestRuntimePreferences") {
        client.respond(m.id as string, { nativeSearchEnhancementsEnabled: false });
      } else {
        client.respond(m.id as string, {});
      }
    },
  }, auth ? { env: { ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: auth.providerConfigPath } } : {});

  const [{ createCliRenderer }, { createRoot }, { App, MODES }] = await Promise.all([
    import("@opentui/core"),
    import("@opentui/react"),
    import("./app"),
  ]);
  if (launchMode && !(MODES as readonly string[]).includes(launchMode)) {
    console.error(`zcode-tui: unknown mode "${launchMode}" (plan|build|edit|yolo|auto)`);
    process.exit(1);
  }
  // The renderer must not eat ctrl+c: OpenCode disables the default
  // exit-on-ctrl-c so ctrl+c reaches the key machine (clear the draft while
  // typing, quit from a nav surface) instead of killing the TUI and
  // dropping a composed prompt on the floor.
  const renderer = await createCliRenderer({ exitOnCtrlC: false });
  renderer.setBackgroundColor(THEMES.opencode.bg);
  createRoot(renderer).render(
    <App client={client} renderer={renderer} onQuit={() => process.exit(0)} resumeId={resumeId} modelId={modelId} launchMode={launchMode} />,
  );
}

void main();
