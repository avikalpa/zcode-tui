// Unit checks for the model dialog option builder (0.6.53): the reference
// dialog-model.tsx sections (Favorites / Recent minus favorites / provider
// groups), the "(Favorite)" mark, and the neutral rest-sort.
import { describe, expect, test } from "bun:test";
import {
  MODEL_GROUP_FAVORITES,
  MODEL_GROUP_RECENT,
  modelDialogOptions,
  type ModelDialogChoice,
} from "./model-dialog";

const M = (label: string, providerId: string, modelId: string, providerLabel?: string): ModelDialogChoice => ({
  label,
  providerId,
  modelId,
  providerLabel,
});

const CATALOG = [
  M("GLM-5.3-Flash", "zai", "GLM-5.3-Flash", "Z.AI"),
  M("GLM-5.3", "zai", "GLM-5.3", "Z.AI"),
  M("Astra", "other", "astra", "Other AI"),
  M("Beta", "alpha", "beta", "Alpha Co"),
];

describe("modelDialogOptions sections", () => {
  test("favorites first, recent minus favorites second, provider groups last", () => {
    const opts = modelDialogOptions(CATALOG, [{ providerId: "other", modelId: "astra" }], [
      { providerId: "zai", modelId: "GLM-5.3-Flash" },
      { providerId: "gone", modelId: "vanished" },
    ]);
    // astra is the favorite, GLM-5.3-Flash is recent — rest is beta + GLM-5.3.
    expect(opts.map((o) => o.group)).toEqual(["Favorites", "Recent", "Alpha Co", "Z.AI"]);
    expect(opts[0].value.modelId).toBe("astra");
    expect(opts[1].value.modelId).toBe("GLM-5.3-Flash");
  });

  test("favorites and recents absent from the catalog drop silently", () => {
    const opts = modelDialogOptions(CATALOG, [{ providerId: "gone", modelId: "vanished" }], [
      { providerId: "gone", modelId: "vanished" },
    ]);
    expect(opts.map((o) => o.group)).toEqual(["Alpha Co", "Other AI", "Z.AI", "Z.AI"]);
  });

  test("a favorite that is also recent lands in Favorites only", () => {
    const fav = { providerId: "zai", modelId: "GLM-5.3" };
    const opts = modelDialogOptions(CATALOG, [fav], [fav]);
    expect(opts.filter((o) => o.group === MODEL_GROUP_RECENT)).toHaveLength(0);
    expect(opts.filter((o) => o.group === MODEL_GROUP_FAVORITES)).toHaveLength(1);
  });
});

describe("the (Favorite) mark", () => {
  test("rides favorite rows and nothing else", () => {
    const opts = modelDialogOptions(CATALOG, [{ providerId: "zai", modelId: "GLM-5.3" }], []);
    expect(opts.find((o) => o.value.modelId === "GLM-5.3")?.description).toBe("(Favorite)");
    expect(opts.find((o) => o.value.modelId === "GLM-5.3-Flash")?.description).toBeUndefined();
  });
});

describe("the rest-sort (neutral sortModelOptions parts)", () => {
  test("provider name groups contiguously, title breaks ties", () => {
    const opts = modelDialogOptions(
      [
        M("zeta", "b", "zeta", "B"),
        M("alpha", "a", "alpha", "A"),
        M("yang", "a", "yang", "A"),
        M("xu", "a", "xu", "A"),
      ],
      [],
      [],
    );
    expect(opts.map((o) => o.label)).toEqual(["alpha", "xu", "yang", "zeta"]);
  });

  test("providerLabel preferred over providerId for grouping", () => {
    const opts = modelDialogOptions(CATALOG, [], []);
    expect(opts.find((o) => o.value.modelId === "GLM-5.3-Flash")?.group).toBe("Z.AI");
  });

  test("id is the provider/model key", () => {
    const opts = modelDialogOptions(CATALOG, [], []);
    expect(opts[0].id).toBe("alpha/beta");
  });
});
