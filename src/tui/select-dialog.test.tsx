// SelectDialog rendering tests (reference-parity, 2026-09-17 themes wave).
// Rendering + mount-time onHighlight only: mock-keys never reach useKeyboard
// (fleet SKILL law) — key-driven behavior is the pty-proof's to prove.
import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { filterDialogOptions, SelectDialog, type DialogOption } from "./select-dialog";

const OPTIONS: DialogOption<string>[] = [
  { id: "alpha", label: "alpha", value: "alpha" },
  { id: "beta", label: "beta", value: "beta" },
  { id: "gamma", label: "gamma", value: "gamma" },
];

describe("SelectDialog reference parity", () => {
  test("Search placeholder with caret, bare rows, gutter ● on the current row", async () => {
    const setup = await testRender(
      <SelectDialog
        title="Themes"
        options={OPTIONS}
        currentId="beta"
        onSelect={() => {}}
        onClose={() => {}}
      />,
      { width: 60, height: 20 },
    );
    const frame = await setup.waitForFrame((f) => f.includes("Themes") && f.includes("beta"), { maxPasses: 20 });
    expect(frame).toContain("Search");
    expect(frame).toContain("█");
    expect(frame).toContain("●");
    // The mid-row suffix marker is gone (0.6.14 and earlier drew "beta  ●").
    expect(frame).not.toContain("beta  ●");
    // No phantom description column unless the caller passes one.
    expect(frame).not.toContain("OpenCod");
    setup.renderer.destroy();
  });

  test("onHighlight fires at mount with the first shown option", async () => {
    const seen: (string | undefined)[] = [];
    const setup = await testRender(
      <SelectDialog
        title="Themes"
        options={OPTIONS}
        currentId="alpha"
        onHighlight={(opt) => seen.push(opt?.id)}
        onSelect={() => {}}
        onClose={() => {}}
      />,
      { width: 60, height: 20 },
    );
    await setup.waitForFrame((f) => f.includes("alpha"), { maxPasses: 20 });
    expect(seen).toContain("alpha");
    setup.renderer.destroy();
  });

  test("descriptions still render for the dialogs that pass real ones", async () => {
    const setup = await testRender(
      <SelectDialog
        title="Model"
        options={[{ id: "glm", label: "GLM-5.3", description: "zai-api/GLM-5.3", value: "glm" }]}
        onSelect={() => {}}
        onClose={() => {}}
      />,
      { width: 60, height: 20 },
    );
    const frame = await setup.waitForFrame((f) => f.includes("GLM-5.3"), { maxPasses: 20 });
    // Narrow cards truncate the description (pre-existing geometry) — the
    // point is that a real description renders, muted, beside the label.
    expect(frame).toContain("zai-api");
    setup.renderer.destroy();
  });

  test("searchText is filter-only — matched text never renders (v2 dialog-config port)", async () => {
    const setup = await testRender(
      <SelectDialog
        title="Settings"
        menu
        options={[
          {
            id: "theme",
            label: "Theme",
            group: "Appearance",
            footer: "opencode",
            searchText: "color scheme",
            value: "theme",
          },
        ]}
        onSelect={() => {}}
        onClose={() => {}}
      />,
      { width: 60, height: 20 },
    );
    const frame = await setup.waitForFrame((f) => f.includes("Theme"), { maxPasses: 20 });
    // The menu grammar paints title + category header + the value in the
    // footer cell; the searchText keywords stay invisible.
    expect(frame).toContain("Appearance");
    expect(frame).toContain("opencode");
    expect(frame).not.toContain("color scheme");
    setup.renderer.destroy();
  });
});


// ==== fuzzysort weighted filter (0.6.70 — the reference DialogSelect filter)
// Pure-function leg: key-driven filter behavior in the live dialog is the
// pty-proof's to prove (SE3/D3/PG type into real search boxes there).
describe("filterDialogOptions (reference fuzzysort filter)", () => {
  const opts: DialogOption<string>[] = [
    { id: "theme", label: "Theme", group: "Interface", searchText: "scheme color theme", value: "theme" },
    { id: "anim", label: "Animations", group: "Interface", value: "anim" },
    { id: "ever", label: "everforest", value: "ever" },
    { id: "drac", label: "dracula", value: "drac" },
    { id: "desc", label: "Zeta", description: "scheme sandbox", value: "desc" },
  ];

  test("empty needle returns the options in their given order", () => {
    expect(filterDialogOptions(opts, "").map((o) => o.id)).toEqual([
      "theme",
      "anim",
      "ever",
      "drac",
      "desc",
    ]);
  });

  test("searchText-only match survives; rows without the needle drop", () => {
    const ids = filterDialogOptions(opts, "scheme").map((o) => o.id);
    expect(ids).toContain("theme");
    expect(ids).not.toContain("anim");
    expect(ids).not.toContain("ever");
  });

  test("description/meta are not in the haystack (the 0.6.70 narrowing)", () => {
    expect(filterDialogOptions(opts, "scheme").map((o) => o.id)).not.toContain("desc");
    expect(filterDialogOptions(opts, "sandbox").map((o) => o.id)).toEqual([]);
  });

  test("label matches outrank group-only matches (title weight 2x, measured)", () => {
    const ranked: DialogOption<string>[] = [
      { id: "group-only", label: "zzz", group: "dra", value: "g" },
      { id: "label-hit", label: "dracula", value: "l" },
    ];
    expect(filterDialogOptions(ranked, "dra").map((o) => o.id)).toEqual([
      "label-hit",
      "group-only",
    ]);
  });

  test("subsequence matches count (dca -> dracula)", () => {
    expect(filterDialogOptions(opts, "dca").map((o) => o.id)).toContain("drac");
  });

  test("threshold drops matches below the floor", () => {
    expect(filterDialogOptions(opts, "dra", 100000)).toEqual([]);
    expect(filterDialogOptions(opts, "dra").map((o) => o.id)).toContain("drac");
  });
});
