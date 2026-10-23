// OpenCode reference: component/dialog-model.tsx. Provider categories and
// separate Favorites/Recent sections, with provider-qualified identities.
import { SelectDialog, type DialogOption } from "./select-dialog";
import { modelKey, type UiState } from "./session/model-preference";
import type { ThemeTokens } from "./design";
import type { PlanState } from "./plan-state";
export type ModelChoice = { label: string; providerId: string; providerLabel?: string; modelId: string; isDefault?: boolean };
export function modelOptions(models: ModelChoice[], plans: PlanState, prefs: Pick<UiState, "recent" | "favorite">): DialogOption<ModelChoice>[] {
  const favorite = new Set(prefs.favorite.map(modelKey));
  const recent = prefs.recent.map(modelKey);
  const options: DialogOption<ModelChoice>[] = [...models]
    .sort((a, b) => {
      const rank = (m: ModelChoice) => favorite.has(modelKey(m)) ? -2 : recent.includes(modelKey(m)) ? -1 : 0;
      return rank(a) - rank(b) || (rank(a) === -1 ? recent.indexOf(modelKey(a)) - recent.indexOf(modelKey(b)) : 0);
    }).map((m) => ({
      id: modelKey(m), label: m.label,
      description: m.providerLabel ?? m.providerId,
      group: favorite.has(modelKey(m)) ? "Favorites" : recent.includes(modelKey(m)) ? "Recent" : m.providerLabel ?? m.providerId,
      value: m,
    }));
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
  return <SelectDialog title="Select model" size="large" options={modelOptions(models, plans, prefs)}
    currentId={current ? modelKey(current) : undefined} theme={C} countLabel="model"
    footerHints={[{ key: "enter", label: "select" }, { key: "ctrl+f", label: "favorite" }, { key: "esc", label: "close" }]}
    onAction={(action, option) => { if (action === "pin" && option && !option.disabled) onFavorite(option.value); }}
    onSelect={onSelect} onClose={onClose} />;
}
