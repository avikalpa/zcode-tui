// The model dialog's option builder (0.6.53) — the reference
// component/dialog-model.tsx sections and sort, wired to our catalog and the
// preference repository. Sections verbatim: Favorites, Recent (minus
// favorites), then the rest grouped by provider name; the rest-section sort
// adopts the neutral parts of their sortModelOptions (provider name
// locale-compare, then title). Their house-provider boost (opencode /
// opencode-go first) and the release-date key are theirs (house providers /
// data we do not carry) and are skipped; the "Free" footer needs cost data
// the zcode catalog does not expose. Their grouped view shows no
// "(Favorite)" mark on Favorites-section rows (only the flat search view
// marks them) — ours rides the row always, so the mark survives into the
// collapsed filter view.
import type { ModelKey } from "./session/model-preference";

export type ModelDialogChoice = {
  label: string;
  providerId: string;
  providerLabel?: string;
  modelId: string;
};

export type ModelDialogOption<T extends ModelDialogChoice> = {
  id: string;
  label: string;
  description?: string;
  group?: string;
  value: T;
};

export const MODEL_GROUP_FAVORITES = "Favorites";
export const MODEL_GROUP_RECENT = "Recent";

export function modelDialogOptions<T extends ModelDialogChoice>(
  models: T[],
  favorites: ModelKey[],
  recents: ModelKey[],
): ModelDialogOption<T>[] {
  const key = (m: ModelKey) => `${m.providerId}/${m.modelId}`;
  const favKeys = favorites.map(key);
  const recentKeys = new Set(recents.map(key));
  const byKey = new Map(models.map((m) => [key(m), m] as const));
  const mark = (m: T) => (favKeys.includes(key(m)) ? "(Favorite)" : undefined);
  const opt = (m: T, group: string): ModelDialogOption<T> => ({
    id: key(m),
    label: m.label,
    description: mark(m),
    group,
    value: m,
  });

  const favOptions = favKeys
    .map((k) => byKey.get(k))
    .filter((m): m is T => m !== undefined)
    .map((m) => opt(m, MODEL_GROUP_FAVORITES));
  const recentOptions = [...recentKeys]
    .filter((k) => !favKeys.includes(k))
    .map((k) => byKey.get(k))
    .filter((m): m is T => m !== undefined)
    .map((m) => opt(m, MODEL_GROUP_RECENT));
  const restOptions = models
    .filter((m) => !favKeys.includes(key(m)) && !recentKeys.has(key(m)))
    .sort((a, b) => {
      const pa = a.providerLabel ?? a.providerId;
      const pb = b.providerLabel ?? b.providerId;
      const provider = pa.localeCompare(pb);
      if (provider !== 0) return provider;
      return a.label.localeCompare(b.label);
    })
    .map((m) => opt(m, m.providerLabel ?? m.providerId));

  return [...favOptions, ...recentOptions, ...restOptions];
}
