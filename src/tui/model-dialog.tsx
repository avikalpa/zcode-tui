// OpenCode reference: component/dialog-model.tsx. Provider categories and
// separate Favorites/Recent sections, with provider-qualified identities.
import * as fuzzysort from "fuzzysort";
import { SelectDialog, type DialogOption } from "./select-dialog";
import { modelKey, type ModelKey, type UiState } from "./session/model-preference";
import type { ThemeTokens } from "./design";
import type { PlanState } from "./plan-state";
export type ModelChoice = { label: string; providerId: string; providerLabel?: string; modelId: string; isDefault?: boolean };

// Reference dialog-model.tsx sortModelOptions. zai is the first-party Coding
// Plan provider (the opencode-go/opencode boost); the reference's Free-footer
// and release-date stages have no data source in the zcode payload and stay
// inert here — they take effect automatically if a payload grows them.
const FIRST_TIER_PROVIDERS = new Set(["zai"]);
export function sortModelOptions<T extends { label: string; value: Pick<ModelChoice, "providerId" | "providerLabel"> }>(
  options: T[],
  grouped = true,
): T[] {
  // slice-then-sort: sort is stable (ES2019), preserving the fuzzysort rank
  // inside ties — the reference uses toSorted, absent from this ES2022 lib.
  return [...options].sort((a, b) => {
    const provider = grouped
      ? Number(FIRST_TIER_PROVIDERS.has(b.value.providerId)) - Number(FIRST_TIER_PROVIDERS.has(a.value.providerId))
      : 0;
    if (provider !== 0) return provider;
    const name = grouped
      ? (a.value.providerLabel ?? a.value.providerId).localeCompare(b.value.providerLabel ?? b.value.providerId)
      : 0;
    if (name !== 0) return name;
    return a.label.localeCompare(b.label);
  });
}
// Reference prioritizeFavorites: a stable pass moving favorited models above
// the rest while preserving rank order inside each partition.
export function prioritizeFavorites<T extends { value: ModelKey }>(options: T[], favorites: Set<string>): T[] {
  return [...options].sort((a, b) =>
    Number(favorites.has(modelKey(b.value))) - Number(favorites.has(modelKey(a.value))));
}
// The reference model dialog owns its search (skipFilter + onFilter):
// fuzzysort decides MEMBERSHIP over title + category, the ungrouped sort law
// decides order, and favorites ride first (flat=true in the picker, so no
// group headers survive a live query).
export function rankModelOptions(
  options: DialogOption<ModelChoice>[],
  query: string,
  favorites: Set<string>,
): DialogOption<ModelChoice>[] {
  const needle = query.toLowerCase().trim();
  if (!needle) return options;
  const matched = fuzzysort.go(needle, options, { keys: ["label", "group"] }).map((result) => result.obj);
  return prioritizeFavorites(sortModelOptions(matched, false), favorites);
}

export function modelOptions(models: ModelChoice[], plans: PlanState, prefs: Pick<UiState, "recent" | "favorite">): DialogOption<ModelChoice>[] {
  const favorite = new Set(prefs.favorite.map(modelKey));
  const recent = prefs.recent.map(modelKey);
  // Reference toOptions: the Favorites section lists prefs.favorite in its
  // own order, the Recent section follows prefs.recent minus favorites, and
  // both are excluded from the model list below.
  const known = new Set(models.map((m) => modelKey(m)));
  const byKey = new Map(models.map((m) => [modelKey(m), m]));
  const sectionRow = (m: ModelChoice, group: string): DialogOption<ModelChoice> => ({
    id: modelKey(m), label: m.label,
    description: m.providerLabel ?? m.providerId, group, value: m,
  });
  const favoriteOptions = prefs.favorite
    .filter((key) => known.has(modelKey(key)))
    .map((key) => sectionRow(byKey.get(modelKey(key))!, "Favorites"));
  const recentOptions = prefs.recent
    .filter((key) => known.has(modelKey(key)) && !favorite.has(modelKey(key)))
    .map((key) => sectionRow(byKey.get(modelKey(key))!, "Recent"));
  const modelRows = sortModelOptions(
    models
      .filter((m) => !favorite.has(modelKey(m)) && !recent.includes(modelKey(m)))
      .map((m) => ({
        id: modelKey(m), label: m.label,
        description: m.providerLabel ?? m.providerId,
        group: m.providerLabel ?? m.providerId,
        value: m,
      })),
    true,
  );
  const options: DialogOption<ModelChoice>[] = [...favoriteOptions, ...recentOptions, ...modelRows];
  for (const m of plans.autoclaw.models) options.push({
    id: `autoclaw/${m.id}`, label: m.name, description: m.id,
    group: "AutoClaw", value: { label: m.name, providerId: "autoclaw", providerLabel: "AutoClaw", modelId: m.id },
    disabled: true, meta: plans.autoclaw.catalogSource === "fallback" ? "offline · separate runner" : "separate runner",
  });
  if (!plans.autoclaw.models.length) options.push({
    id: "autoclaw/setup", label: "No model catalog", group: "AutoClaw",
    description: "Run zcode-tui autoclaw setup", disabled: true,
    value: { label: "AutoClaw", providerId: "autoclaw", modelId: "" },
  });
  return options;
}
export function ModelDialog({ models, plans, prefs, current, C, onSelect, onFavorite, onClose }: {
  models: ModelChoice[]; plans: PlanState; prefs: Pick<UiState, "recent" | "favorite">;
  current?: ModelChoice; C: ThemeTokens; onSelect: (choice: ModelChoice) => void;
  onFavorite: (choice: ModelChoice) => void; onClose: () => void;
}) {
  const favorites = new Set(prefs.favorite.map(modelKey));
  return <SelectDialog title="Select model" size="large" flat
    options={modelOptions(models, plans, prefs)}
    rankOptions={(options, query) => rankModelOptions(options, query, favorites)}
    currentId={current ? modelKey(current) : undefined} theme={C} countLabel="model"
    footerHints={[{ key: "enter", label: "select" }, { key: "ctrl+f", label: "favorite" }, { key: "esc", label: "close" }]}
    onAction={(action, option) => { if (action === "pin" && option && !option.disabled) onFavorite(option.value); }}
    onSelect={onSelect} onClose={onClose} />;
}
