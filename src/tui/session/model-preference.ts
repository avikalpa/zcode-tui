// Ported from opencode v2.0.8 packages/tui/src/model-preference.ts — the
// client-sync rework (upstream #49611): a repository whose writes merge from
// the file under a lock (addRecent/setFavorite) and whose subscribe() watches
// the file so a change made by one client surfaces in the others live. Our
// schema is the zcode-tui state.json voice: the model-preference core
// (recent/favorite/variant, field-named providerId/modelId here) plus this
// TUI's own persistence fields (diff/animations/fileContext), sanitized on
// load exactly like the reference's decodeModelPreference. IO is synchronous
// (our persistence has always been sync) and the reference's Flock is the
// adapted port in ./flock.

import { watch } from "node:fs";
import path from "node:path";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { DiffPreferences } from "../diff/diff-viewer";
import { withLockSync, type FlockOptions } from "./flock";

export type ModelKey = { providerId: string; modelId: string };

// The reference carries only {recent, favorite, variant}; the extra fields
// are ours (0.5.x state.json), preserved through the same update path.
export type UiState = {
  recent: ModelKey[];
  favorite: ModelKey[];
  variant: Record<string, string>;
  diff: DiffPreferences;
  animations: boolean;
  fileContext: boolean;
};

const EMPTY: UiState = {
  recent: [],
  favorite: [],
  variant: {},
  diff: {},
  animations: true,
  fileContext: true,
};

export function modelKey(model: ModelKey): string {
  return `${model.providerId}/${model.modelId}`;
}

// v2.0.8 moved recentModels/favoriteModels into the repository module so the
// write helpers and their math live together; the math is unchanged.
export function recentModels(model: ModelKey, recent: ModelKey[]): ModelKey[] {
  const seen = new Set<string>();
  return [model, ...recent]
    .filter((item) => {
      const key = modelKey(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 10)
    .map((item) => ({ providerId: item.providerId, modelId: item.modelId }));
}

export function favoriteModels(model: ModelKey, favorite: ModelKey[], enabled: boolean): ModelKey[] {
  const current = favorite.filter((item) => modelKey(item) !== modelKey(model));
  return enabled ? [model, ...current] : current;
}

function decode(raw: unknown): UiState {
  try {
    const obj = (raw ?? {}) as Record<string, unknown>;
    const keys = (value: unknown): ModelKey[] =>
      Array.isArray(value)
        ? value.filter((x): x is ModelKey => {
            if (!x || typeof x !== "object") return false;
            const m = x as Record<string, unknown>;
            return typeof m.providerId === "string" && typeof m.modelId === "string";
          })
        : [];
    const variant: Record<string, string> = {};
    if (obj.variant && typeof obj.variant === "object") {
      for (const [k, v] of Object.entries(obj.variant as Record<string, unknown>)) {
        if (typeof v === "string") variant[k] = v;
      }
    }
    return {
      recent: keys(obj.recent),
      favorite: keys(obj.favorite),
      variant,
      diff: obj.diff && typeof obj.diff === "object" ? (obj.diff as DiffPreferences) : {},
      animations: typeof obj.animations === "boolean" ? obj.animations : true,
      fileContext: typeof obj.fileContext === "boolean" ? obj.fileContext : true,
    };
  } catch {
    return { ...EMPTY };
  }
}

export function createModelPreferenceRepository(filePath: string, lock?: FlockOptions) {
  const read = (): UiState => {
    try {
      return decode(JSON.parse(readFileSync(filePath, "utf8")));
    } catch {
      return { ...EMPTY };
    }
  };

  const write = (next: UiState): void => {
    try {
      mkdirSync(path.dirname(filePath), { recursive: true });
      const temporary = `${filePath}.${process.pid}.tmp`;
      writeFileSync(temporary, JSON.stringify(next));
      renameSync(temporary, filePath);
    } catch {
      /* best effort — a dead state file must never take the TUI down */
    }
  };

  // update() merges from the DISK current under the lock, so a writer never
  // clobbers what another client wrote since our last look (the v2.0.8 fix).
  function update(change: (current: UiState) => Partial<UiState>): UiState {
    return withLockSync(
      filePath,
      () => {
        const next = { ...read(), ...change(read()) };
        write(next);
        return next;
      },
      lock,
    );
  }

  let watcher: ReturnType<typeof watch> | undefined;
  let reload: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<(value: UiState) => void>();

  return {
    load: () => read(),
    update,
    addRecent(model: ModelKey): UiState {
      return update((current) => ({ recent: recentModels(model, current.recent) }));
    },
    setFavorite(model: ModelKey, enabled: boolean): UiState {
      return update((current) => ({ favorite: favoriteModels(model, current.favorite, enabled) }));
    },
    // Live cross-client sync: fire the listener (with a fresh read) when the
    // file — or our own atomic-write temp sibling — changes. The watcher is
    // shared and reference-counted, as upstream.
    subscribe(listener: (value: UiState) => void): () => void {
      listeners.add(listener);
      listener(read());
      if (!watcher) {
        watcher = watch(path.dirname(filePath), (_event, filename) => {
          const changed = filename?.toString();
          const name = path.basename(filePath);
          if (changed !== undefined && changed !== name && !changed.startsWith(`${name}.`)) return;
          clearTimeout(reload);
          reload = setTimeout(() => {
            const value = read();
            for (const l of listeners) l(value);
          }, 50);
        });
        watcher.on("error", () => {
          watcher?.close();
          watcher = undefined;
        });
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0) return;
        clearTimeout(reload);
        watcher?.close();
        watcher = undefined;
      };
    },
  };
}
