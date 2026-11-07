import { describe, expect, test } from "bun:test";
import { promptMetadataLayout, takeWidth, truncateWidth } from "./prompt-metadata";

// The composer metadata row law (component/prompt/metadata.tsx, pinned
// v2ref b084acc). Ground truth: the reference's own harness rendered the row
// with agents + a variant catalog served; frames kept at
// /tmp/zq-ux-parity/ref-meta-*.txt — the cases below re-derive each frame's
// row (autosqueeze-44, longname-50, plain-40, novariant-100 among them).

const full = { agent: "Build", auto: true, model: "Model", provider: "Provider", variant: "high" };

describe("promptMetadataLayout", () => {
  test("wide terminal admits every segment", () => {
    const layout = promptMetadataLayout({ width: 87, terminalWidth: 100, ...full });
    expect(layout).toEqual({ agent: "Build", auto: true, model: "Model", provider: "Provider", variant: "high" });
  });

  test("auto yields first when the full row does not fit (44-column ground truth)", () => {
    // ref-meta-autosqueeze-44.txt: `Build · Model Provider · high`
    const layout = promptMetadataLayout({ width: 31, terminalWidth: 44, ...full });
    expect(layout).toEqual({ agent: "Build", model: "Model", provider: "Provider", variant: "high" });
  });

  test("the provider shortens to its last ' / ' path before dropping", () => {
    const layout = promptMetadataLayout({
      width: 36,
      terminalWidth: 50,
      agent: "Build",
      model: "Model",
      provider: "github / chatgpt",
      variant: "high",
    });
    expect(layout).toEqual({ agent: "Build", model: "Model", provider: "chatgpt", variant: "high" });
  });

  test("the provider drops when even the shortened form cannot fit", () => {
    const layout = promptMetadataLayout({
      width: 24,
      terminalWidth: 50,
      agent: "Build",
      model: "Model",
      provider: "github / chatgpt",
      variant: "high",
    });
    expect(layout).toEqual({ agent: "Build", model: "Model", variant: "high" });
  });

  test("an over-long model truncates into the remaining space (50-column ground truth)", () => {
    // ref-meta-longname-50.txt: `Build · Extraordinary-Long-Mo… · high`
    const layout = promptMetadataLayout({
      width: 37,
      terminalWidth: 50,
      agent: "Build",
      model: "Extraordinary-Long-Model-Name-That-Exceeds-All",
      provider: "Provider-Long",
      variant: "high",
    });
    expect(layout.model).toBe("Extraordinary-Long-Mo…");
    expect(layout).toEqual({ agent: "Build", model: "Extraordinary-Long-Mo…", variant: "high" });
  });

  test("below 44 columns the agent and provider drop outright (40-column ground truth)", () => {
    // ref-meta-plain-40.txt: `Model · high` — no agent word and no leading `·`
    const layout = promptMetadataLayout({
      width: 31,
      terminalWidth: 40,
      agent: "Build",
      model: "Model",
      provider: "Provider",
      variant: "high",
    });
    expect(layout).toEqual({ agent: undefined, auto: undefined, model: "Model", provider: "", variant: "high" });
  });

  test("an absent variant never leaves a trailing separator", () => {
    const layout = promptMetadataLayout({ width: 87, terminalWidth: 100, ...full, variant: undefined });
    expect(layout).toEqual({ agent: "Build", auto: true, model: "Model", provider: "Provider", variant: undefined });
    const text = [
      layout.agent,
      layout.auto ? "auto" : "",
      layout.model,
      layout.provider,
      layout.variant,
    ]
      .filter(Boolean)
      .join(" ");
    expect(text.endsWith("·")).toBe(false);
  });
});

describe("truncateWidth/takeWidth", () => {
  test("whole strings fit unchanged", () => {
    expect(truncateWidth("Model", 10)).toBe("Model");
  });

  test("over-long strings cut at width-1 columns plus an ellipsis", () => {
    expect(truncateWidth("Extraordinary-Long-Model-Name", 22)).toBe("Extraordinary-Long-Mo…");
  });

  test("width 1 is the ellipsis alone and width 0 is empty", () => {
    expect(truncateWidth("Model", 1)).toBe("…");
    expect(truncateWidth("Model", 0)).toBe("");
    expect(takeWidth("Model", 0)).toBe("");
  });

  test("wide graphemes count two columns", () => {
    expect(takeWidth("模型型", 4)).toBe("模型");
    expect(truncateWidth("模型型型", 5)).toBe("模型…");
  });
});
