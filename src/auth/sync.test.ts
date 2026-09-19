// Auth-sync tests. Pure fixtures (tmpdir homes, injected remote fetcher) —
// no network, no real ssh, no real home touched.
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  syncAuthAtStartup,
  loadAuthConfig,
  saveAuthConfig,
  extractProviderApiKey,
  sourceIsLocal,
  AUTH_SOURCE_ENV,
  type SyncDeps,
} from "./sync";

const SSOT = JSON.stringify({
  schemaVersion: 1,
  config: {
    providerConfigRules: {
      providerRules: [
        { providerId: "zai-api", templateId: "zai-api", config: { group: "standard-personal", access: { type: "api-key", apiKey: "ssot-key-1234" } } },
      ],
    },
    modelConfigRules: { providerModelRules: [], manualProviderModelRules: [] },
  },
});

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "zcode-tui-auth-"));
  delete process.env[AUTH_SOURCE_ENV];
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  delete process.env[AUTH_SOURCE_ENV];
});

function deps(extra: Partial<SyncDeps> = {}): SyncDeps {
  return { homeDir: home, configDir: join(home, ".config/zcode-tui"), ...extra };
}

function machineSettings(providerConfigJson: string, cliKey: string | null): void {
  mkdirSync(join(home, ".zcode/v2"), { recursive: true });
  mkdirSync(join(home, ".zcode/cli"), { recursive: true });
  writeFileSync(join(home, ".zcode/v2/provider_config.json"), providerConfigJson);
  writeFileSync(
    join(home, ".zcode/cli/config.json"),
    JSON.stringify({ mcp: {}, provider: { zai: { kind: "anthropic", name: "Z.AI Coding Plan", options: { baseURL: "https://api.z.ai/api/anthropic", apiKey: cliKey, apiKeyRequired: true }, models: {} } }, model: {} }),
  );
}

describe("auth sync", () => {
  test("extracts the zai-api key from the SSOT provider config", () => {
    expect(extractProviderApiKey(SSOT)).toBe("ssot-key-1234");
    expect(extractProviderApiKey("{not json")).toBeNull();
    expect(extractProviderApiKey(JSON.stringify({ config: { providerConfigRules: { providerRules: [] } } }))).toBeNull();
  });

  test("local source: reads machine settings, stores raw config + metadata, env points at the raw blob", () => {
    process.env[AUTH_SOURCE_ENV] = "local";
    machineSettings(SSOT, "stale-key");
    const auth = syncAuthAtStartup(deps());
    expect(auth).not.toBeNull();
    const cdir = join(home, ".config/zcode-tui");
    expect(readFileSync(join(cdir, "auth-provider-config.json"), "utf8")).toBe(SSOT);
    const meta = JSON.parse(readFileSync(join(cdir, "auth.json"), "utf8"));
    expect(meta.source).toBe("local"); // the resolved source is recorded
    expect(meta.fingerprint).toBe(auth!.fingerprint);
    expect(auth!.providerConfigPath).toBe(join(cdir, "auth-provider-config.json"));
  });

  test("heals the stale cli-config key surgically and backs it up, leaves the rest of the file alone", () => {
    machineSettings(SSOT, "stale-key");
    const auth = syncAuthAtStartup(deps());
    expect(auth!.healedMachineSettings).toBe(true);
    const cfg = JSON.parse(readFileSync(join(home, ".zcode/cli/config.json"), "utf8"));
    expect(cfg.provider.zai.options.apiKey).toBe("ssot-key-1234");
    expect(cfg.provider.zai.options.baseURL).toBe("https://api.z.ai/api/anthropic");
    expect(cfg.provider.zai.kind).toBe("anthropic");
    expect(cfg.model).toEqual({});
    const backups = readdirSync(join(home, ".zcode/cli")).filter((f) => f.startsWith("config.json.pre-authsync-"));
    expect(backups.length).toBe(1);
    expect(readFileSync(join(home, ".zcode/cli", backups[0]), "utf8")).toContain("stale-key");
  });

  test("heals a missing v2 provider config; second boot is idempotent", () => {
    process.env[AUTH_SOURCE_ENV] = "peer-host";
    mkdirSync(join(home, ".zcode/cli"), { recursive: true });
    writeFileSync(
      join(home, ".zcode/cli/config.json"),
      JSON.stringify({ provider: { zai: { options: { apiKey: "stale-key" } } } }),
    );
    const auth = syncAuthAtStartup(deps({ fetchRemote: () => SSOT }));
    expect(auth!.healedMachineSettings).toBe(true);
    expect(readFileSync(join(home, ".zcode/v2/provider_config.json"), "utf8")).toBe(SSOT);
    const second = syncAuthAtStartup(deps({ fetchRemote: () => SSOT }));
    expect(second!.healedMachineSettings).toBe(false);
  });

  test("remote source: pulls over the injected fetcher and heals the local settings from it", () => {
    process.env[AUTH_SOURCE_ENV] = "peer-host";
    machineSettings(JSON.stringify({ stale: true }), "stale-key");
    const auth = syncAuthAtStartup(deps({ fetchRemote: (host, path) => {
      expect(host).toBe("peer-host");
      expect(path).toContain("provider_config.json");
      return SSOT;
    }}));
    expect(auth!.source).toBe("peer-host");
    expect(auth!.healedMachineSettings).toBe(true);
    expect(extractProviderApiKey(readFileSync(join(home, ".zcode/v2/provider_config.json"), "utf8"))).toBe("ssot-key-1234");
  });

  test("fail-soft: unreachable source returns null and touches nothing", () => {
    process.env[AUTH_SOURCE_ENV] = "peer-host";
    machineSettings(SSOT, "local-key");
    const auth = syncAuthAtStartup(deps({ fetchRemote: () => { throw new Error("offline"); } }));
    expect(auth).toBeNull();
    expect(JSON.parse(readFileSync(join(home, ".zcode/cli/config.json"), "utf8")).provider.zai.options.apiKey).toBe("local-key");
    expect(existsSync(join(home, ".config/zcode-tui/auth.json"))).toBe(false);
  });

  test("syncAtStartup=false and a source without a key are both no-ops", () => {
    mkdirSync(join(home, ".config/zcode-tui"), { recursive: true });
    writeFileSync(join(home, ".config/zcode-tui/config.json"), JSON.stringify({ auth: { source: "jojo", syncAtStartup: false } }));
    expect(syncAuthAtStartup(deps())).toBeNull();
    delete process.env[AUTH_SOURCE_ENV];
    process.env[AUTH_SOURCE_ENV] = "peer-host";
    machineSettings(JSON.stringify({ no: "key" }), null);
    expect(syncAuthAtStartup(deps({ fetchRemote: () => JSON.stringify({ no: "key" }) }))).toBeNull();
  });

  test("env override wins over config file; config save/load round-trips", () => {
    process.env[AUTH_SOURCE_ENV] = "dev";
    expect(loadAuthConfig(home).source).toBe("dev");
    delete process.env[AUTH_SOURCE_ENV];
    saveAuthConfig({ source: "jojo", syncAtStartup: false }, home);
    expect(loadAuthConfig(home).syncAtStartup).toBe(false);
    expect(sourceIsLocal("local")).toBe(true);
  });
});
