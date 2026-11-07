// Ported from MIT OpenCode b084acc packages/tui/src/component/prompt/metadata.tsx
// and util/locale.ts. See THIRD-PARTY-NOTICES.md.
import { stringWidth } from "./diff/string-width";

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

// Locale.takeWidth (reference util/locale.ts): the longest grapheme prefix
// that fits `width` terminal columns.
export function takeWidth(value: string, width: number): string {
  if (width <= 0) return "";
  const out: string[] = [];
  let used = 0;
  for (const { segment } of segmenter.segment(value)) {
    const next = stringWidth(segment);
    if (used + next > width) break;
    out.push(segment);
    used += next;
  }
  return out.join("");
}

// Locale.truncateWidth (reference util/locale.ts): the whole string when it
// fits, else the longest prefix of width-1 columns plus an ellipsis.
export function truncateWidth(value: string, width: number): string {
  if (width <= 0) return "";
  if (stringWidth(value) <= width) return value;
  if (width === 1) return "…";
  return takeWidth(value, width - 1) + "…";
}

export type MetadataLayout = {
  agent?: string;
  auto?: boolean;
  model: string;
  provider?: string;
  variant?: string;
};

// The reference joins the admitted segments with single spaces; the row gate
// and the flex gap render this exact string, so width fitting measures it.
function metadataText(input: MetadataLayout): string {
  return [
    ...(input.agent ? [input.agent] : []),
    ...(input.auto ? ["auto"] : []),
    ...(input.model ? [...(input.agent ? ["·"] : []), input.model] : []),
    ...(input.provider ? [input.provider] : []),
    ...(input.variant ? ["·", input.variant] : []),
  ].join(" ");
}

// promptMetadataLayout (reference metadata.tsx 101-136): below 44 terminal
// columns the agent and provider are dropped outright; otherwise segments are
// admitted by progressive candidates — full → drop auto → shorten the provider
// to its last " / " path → drop the provider — and when none fit the model is
// truncated into the remaining space (never below 9 columns).
export function promptMetadataLayout(input: {
  width: number;
  terminalWidth: number;
  agent: string;
  auto?: boolean;
  model: string;
  provider: string;
  variant?: string;
}): MetadataLayout {
  const agent = input.terminalWidth < 44 ? undefined : input.agent;
  const provider = input.terminalWidth < 44 ? "" : input.provider;
  const candidates: MetadataLayout[] = [
    { agent, auto: input.auto, model: input.model, provider, variant: input.variant },
    { agent, model: input.model, provider, variant: input.variant },
    {
      agent,
      model: input.model,
      provider: provider.split(" / ").at(-1) ?? provider,
      variant: input.variant,
    },
    { agent, model: input.model, variant: input.variant },
  ];
  const fit = candidates.find((candidate) => stringWidth(metadataText(candidate)) <= input.width);
  if (fit) return fit;

  const prefix = agent ? `${agent} · ` : "";
  const suffix = input.variant ? ` · ${input.variant}` : "";
  return {
    agent,
    model: truncateWidth(
      input.model,
      Math.max(9, input.width - stringWidth(prefix) - stringWidth(suffix)),
    ).replace(/\s+…$/, "…"),
    variant: input.variant,
  };
}
