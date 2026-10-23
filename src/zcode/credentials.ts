// The ZCode credential-store codec — mined from the desktop bundle
// (out/main chunk, createCredentialCipherProvider, 2026-10-23).
//
// Format: "enc:v1:" + base64url(iv[12]) + "." + base64url(tag[16]) + "." +
// base64url(ciphertext), AES-256-GCM, key = sha256(secret), secret =
// $ZCODE_CREDENTIAL_SECRET or the deterministic fallback
// `zcode-credential-fallback:${platform}:${homedir}:${username}`.
//
// This makes the user's own credential store readable/writable by zcode-tui
// on ANY host with no desktop and no keyring (spec §12 boundary: procedure
// only — the secret is derived from the user's own machine identity and the
// store holds the user's own tokens).
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";

const PREFIX = "enc:v1:";
const IV_LEN = 12;
const TAG_LEN = 16;

export function defaultCredentialSecret(platform = process.platform, home = homedir(), username = userInfoName()): string {
  return `zcode-credential-fallback:${platform}:${home}:${username}`;
}

function userInfoName(): string {
  try {
    const { userInfo } = require("node:os") as typeof import("node:os");
    return userInfo().username;
  } catch {
    return "unknown";
  }
}

export function deriveKey(secret = process.env.ZCODE_CREDENTIAL_SECRET ?? defaultCredentialSecret()): Buffer {
  return createHash("sha256").update(secret).digest();
}

export function encryptCredential(plain: string, key = deriveKey()): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf-8"), cipher.final()]);
  return [PREFIX, iv.toString("base64url"), ".", cipher.getAuthTag().toString("base64url"), ".", ct.toString("base64url")].join("");
}

/** Decrypt an enc:v1 value; pass through values that are not encrypted. */
export function decryptCredential(value: string, key = deriveKey()): string {
  if (!value.startsWith(PREFIX)) return value;
  const parts = value.slice(PREFIX.length).split(".");
  if (parts.length !== 3) throw new Error("credential: malformed enc:v1 envelope");
  const iv = Buffer.from(parts[0], "base64url");
  const tag = Buffer.from(parts[1], "base64url");
  const ct = Buffer.from(parts[2], "base64url");
  if (iv.length !== IV_LEN) throw new Error("credential: bad IV length");
  if (tag.length !== TAG_LEN) throw new Error("credential: bad auth-tag length");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf-8");
}

/** Read one key from the user's own ~/.zcode/v2/credentials.json, decrypted. */
export function readCredential(keyName: string, home = homedir()): string | null {
  try {
    const creds = JSON.parse(readFileSync(join(home, ".zcode", "v2", "credentials.json"), "utf8")) as Record<string, string>;
    const raw = creds[keyName];
    return typeof raw === "string" && raw ? decryptCredential(raw) : null;
  } catch {
    return null;
  }
}
