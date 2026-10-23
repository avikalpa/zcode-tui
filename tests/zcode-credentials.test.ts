// The mined ZCode credential codec — round-trip + envelope shape.
import { describe, test, expect } from "bun:test";
import { createHash, createCipheriv, randomBytes } from "node:crypto";
import { encryptCredential, decryptCredential, defaultCredentialSecret, deriveKey, readCredential } from "../src/zcode/credentials";

describe("zcode credential codec (enc:v1 aes-256-gcm)", () => {
  test("round-trips and matches the mined envelope layout", () => {
    const secret = defaultCredentialSecret("linux", "/home/tester", "tester");
    const key = deriveKey(secret);
    const enc = encryptCredential("hello-jwt", key);
    expect(enc.startsWith("enc:v1:")).toBe(true);
    const [ivS, tagS, ctS] = enc.slice(7).split(".");
    expect(Buffer.from(ivS, "base64url").length).toBe(12);
    expect(Buffer.from(tagS, "base64url").length).toBe(16);
    expect(decryptCredential(enc, key)).toBe("hello-jwt");
  });

  test("cross-checks against an independent GCM encryption of the same layout", () => {
    const key = deriveKey("zcode-credential-fallback:linux:/home/pi:pi");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ct = Buffer.concat([cipher.update("payload-x", "utf8"), cipher.final()]);
    const manual = `enc:v1:${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ct.toString("base64url")}`;
    expect(decryptCredential(manual, key)).toBe("payload-x");
  });

  test("passes through unencrypted values", () => {
    expect(decryptCredential("plain-token")).toBe("plain-token");
  });

  test("readCredential returns null on missing file/key", () => {
    expect(readCredential("nope", "/nonexistent-home")).toBeNull();
  });
});
