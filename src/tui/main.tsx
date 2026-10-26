// zcode-tui live entry — spawns app-server, renders the sessions surface.
// OpenTUI core is ESM-with-TLA: dynamic import (fleet law from the
// mock-tui-opentui staging), bun-native entry picked automatically.
import pkg from "../../package.json";
import { AppServer } from "../protocol/client";
import { syncAuthAtStartup, localProviderConfigPath } from "../auth/sync";
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
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--version" || argv[i] === "-V") {
      // The compiled dist binary has no shim around it (ynpm dev installs
      // take the ELF directly), so the version probe must live here.
      console.log(`zcode-tui ${pkg.version}`);
      process.exit(0);
    }
    if (argv[i] === "--resume") resumeId = argv[++i] ?? null;
    else if (argv[i] === "--model") modelId = argv[++i] ?? null;
  }
  probe("boot", `pid=${process.pid} argv=${JSON.stringify(argv)}`);
  // Headless verb routing. The compiled dist binary is what fleet seats
  // actually execute (ynpm dev installs take the ELF directly — no npm shim
  // in front of it), so the headless subcommands must route here too, not
  // only in bin/zcode-tui. Routed bins are import-safe (parseArgs at entry
  // time; plans parses strict:false) — run.ts is the exception: its module
  // state is import.meta.main-coupled, so it stays on the shim path until
  // that is refactored.
  const verb = argv[0];
  if (verb && !verb.startsWith("-")) {
    const bins: Record<string, () => Promise<unknown>> = {
      autoclaw: () => import("../bin/autoclaw").then((m) => m.main()),
      queue: () => import("../bin/queue").then((m) => m.main()),
      idle: () => import("../bin/idle").then((m) => m.main()),
      plans: () => import("../bin/plans").then((m) => m.main()),
    };
    const entry = bins[verb];
    if (entry) {
      try {
        // bins parse process.argv themselves and expect the verb stripped —
        // the npm shim hands them args.slice(1) the same way.
        process.argv.splice(2, 1);
        await entry();
      } catch (e) {
        console.error(`zcode-tui ${verb}: ${(e as Error).message ?? e}`);
        process.exit(1);
      }
      process.exit(0);
    }
  }
  // 2.0.0: replication is ygg-auth's job. The backend handoff prefers the
  // LOCAL machine settings (~/.zcode/v2/provider_config.json, which the
  // ygg-auth zcode harness replicates); the legacy stored copy applies only
  // when ZCODE_TUI_AUTH_SYNC=1 ran the retired startup plane. Fail-soft.
  const auth = syncAuthAtStartup();
  const providerConfigPath = auth?.providerConfigPath ?? localProviderConfigPath();
  if (auth) {
    probe("auth-sync", `source=${auth.source} fp=${auth.fingerprint} healed=${auth.healedMachineSettings}`);
  } else {
    probe("auth-sync", providerConfigPath ? "legacy off — local machine settings in use" : "legacy off — no local auth (replicate with ygg-auth)");
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
  }, providerConfigPath ? { env: { ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: providerConfigPath } } : {});

  const [{ createCliRenderer }, { createRoot }, { App }] = await Promise.all([
    import("@opentui/core"),
    import("@opentui/react"),
    import("./app"),
  ]);
  // The renderer must not eat ctrl+c: OpenCode disables the default
  // exit-on-ctrl-c so ctrl+c reaches the key machine (clear the draft while
  // typing, quit from a nav surface) instead of killing the TUI and
  // dropping a composed prompt on the floor.
  const renderer = await createCliRenderer({ exitOnCtrlC: false });
  renderer.setBackgroundColor(THEMES.opencode.bg);
  createRoot(renderer).render(
    <App client={client} renderer={renderer} onQuit={() => process.exit(0)} resumeId={resumeId} modelId={modelId} />,
  );
}

void main();
