import { describe, expect, test } from "bun:test";
import { errorMessage, errorFormat } from "./error";

describe("errorMessage (v2.0.16 util/error port)", () => {
  test("Error message wins", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  test("name-only Error falls back to the name", () => {
    const e = new Error();
    e.message = "";
    expect(errorMessage(e)).toBe(e.name);
  });

  test("plain record message (the [object Object] class of failures)", () => {
    expect(errorMessage({ message: "session not found" })).toBe("session not found");
  });

  test("nested data.message (the tagged API-error shape)", () => {
    expect(errorMessage({ name: "ProviderInitError", data: { message: "no credentials" } })).toBe(
      "no credentials",
    );
  });

  test("non-object primitives stringify", () => {
    expect(errorMessage("timeout")).toBe("timeout");
    expect(errorMessage(42)).toBe("42");
    expect(errorMessage(null)).toBe("null");
  });

  test("empty object does not print [object Object] — ctor + props fallback", () => {
    class Empty extends Error {}
    const out = errorMessage(new Empty());
    expect(out.length).toBeGreaterThan(0);
    expect(out).not.toBe("[object Object]");
  });

  test("errorFormat serializes records as json", () => {
    expect(errorFormat({ code: 7 })).toBe('{\n  "code": 7\n}');
  });
});
