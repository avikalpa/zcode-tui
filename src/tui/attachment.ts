// Ported from opencode v2.0.8 component/prompt/local-attachment.ts +
// prompt/attachment.ts (the pasted-path attachment resolution, the [Image N]
// label grammar and the dedupe identity), wired to the zcode host's
// v4/attachment upload family — begin/chunk/commit shapes measured live
// (0.6.35): totalBytes <= 20MB, <= 64 chunks of <= 512KB (base64), checksum
// "sha256:<64hex>", commit returns { ref: "zcode-artifact://…" }.
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

// Bound filesystem work per terminal paste; the byte budget also bounds
// staged data (the v2 constant).
const MAX_PASTED_FILEPATHS = 32;
export const MAX_LOCAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export type LocalAttachment =
  | { type: "text"; mime: "image/svg+xml"; content: string }
  | { type: "binary"; mime: string; content: Uint8Array };

export type ResolvedAttachment =
  | { type: "text"; content: string; filename: string }
  | { type: "file"; uri: string; mime: string; bytes: Uint8Array; filename: string };

const mimeTypes: Record<string, string> = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

async function readFileBounded(file: string, maxBytes: number): Promise<Buffer> {
  const info = await stat(file).catch(() => undefined);
  if (!info || !info.isFile()) throw new Error("Attachment does not exist");
  if (info.size > maxBytes) throw new Error("Attachment exceeds the local file limit");
  return readFile(file);
}

export type LocalFiles = {
  readText(path: string, maxBytes: number): Promise<string>;
  readBytes(path: string, maxBytes: number): Promise<Uint8Array>;
  mime(path: string): Promise<string>;
};

export async function readLocalAttachmentWith(
  files: LocalFiles,
  file: string,
  maxBytes = MAX_LOCAL_ATTACHMENT_BYTES,
): Promise<LocalAttachment | undefined> {
  const mime = await files.mime(file).catch(() => undefined);
  if (!mime) return undefined;
  if (!mime.startsWith("image/") && mime !== "application/pdf") return undefined;
  if (mime === "image/svg+xml") {
    const content = await files.readText(file, maxBytes).catch(() => undefined);
    if (!content || Buffer.byteLength(content) > maxBytes) return undefined;
    return { type: "text", mime, content };
  }
  const content = await files.readBytes(file, maxBytes).catch(() => undefined);
  if (!content || content.byteLength > maxBytes) return undefined;
  return { type: "binary", mime, content };
}

export function readLocalAttachment(file: string, maxBytes = MAX_LOCAL_ATTACHMENT_BYTES) {
  return readLocalAttachmentWith(
    {
      readText: async (value, limit) => (await readFileBounded(value, limit)).toString("utf8"),
      readBytes: (value, limit) => readFileBounded(value, limit),
      mime: async (value) => mimeTypes[path.extname(value).toLowerCase()] ?? "application/octet-stream",
    },
    file,
    maxBytes,
  );
}

export function normalizePastedFilepath(value: string, platform: string) {
  const raw = value.replace(/^['"]+|['"]+$/g, "");
  const url = decodeFileURL(raw, platform);
  if (url) return url;
  if (platform === "win32") return raw;
  return raw.replace(/\\(.)/g, "$1");
}

function decodeFileURL(value: string, platform: string): string | undefined {
  if (!value.startsWith("file://")) return undefined;
  try {
    const url = new URL(value);
    if (/%2f|%5c/i.test(url.pathname)) return undefined;
    const pathname = decodeURIComponent(url.pathname);
    if (platform !== "win32") {
      if (url.hostname && url.hostname !== "localhost") return undefined;
      return pathname;
    }
    const local = pathname.replace(/^\/([A-Za-z]:)/, "$1").replaceAll("/", "\\");
    if (url.hostname && url.hostname !== "localhost") return `\\\\${url.hostname}${local}`;
    return local;
  } catch {
    return undefined;
  }
}

export function parsePastedFilepaths(value: string, platform: string) {
  const result: string[] = [];
  let current = "";
  let quote = "";

  function push() {
    if (!current) return;
    result.push(decodeFileURL(current, platform) ?? current);
    current = "";
  }

  const input = value.includes("file://")
    ? value
        .split(/\r?\n/)
        .filter((line) => !line.trimStart().startsWith("#"))
        .join("\n")
    : value;
  for (let index = 0; index < input.length; index++) {
    const character = input[index];
    if (quote) {
      if (character === quote) {
        quote = "";
        continue;
      }
      if (character === "\\" && platform !== "win32" && quote === '"' && index + 1 < input.length) {
        current += input[++index];
        continue;
      }
      current += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "\\" && platform !== "win32" && index + 1 < input.length) {
      current += input[++index];
      continue;
    }
    if (/\s/.test(character)) {
      push();
      if (result.length > MAX_PASTED_FILEPATHS) return [];
      continue;
    }
    current += character;
  }

  if (quote) return [];
  push();
  if (result.length > MAX_PASTED_FILEPATHS) return [];
  return result;
}

export async function resolvePastedAttachments(
  text: string,
  platform: string = process.platform,
): Promise<ResolvedAttachment[] | undefined> {
  const pastedContent = text.trim();
  const filepath = normalizePastedFilepath(pastedContent, platform);
  if (/^(https?):\/\//.test(filepath)) return undefined;

  const attachments: { filepath: string; attachment: LocalAttachment }[] = [];
  const attachment = await readLocalAttachment(filepath);
  if (attachment) attachments.push({ filepath, attachment });
  if (!attachment) {
    const filepaths = parsePastedFilepaths(pastedContent, platform);
    if (filepaths.length <= 1) return undefined;
    let remaining = MAX_LOCAL_ATTACHMENT_BYTES;
    for (const candidate of filepaths) {
      const next = await readLocalAttachment(candidate, remaining);
      if (!next) return undefined;
      remaining -= typeof next.content === "string" ? Buffer.byteLength(next.content) : next.content.byteLength;
      attachments.push({ filepath: candidate, attachment: next });
    }
  }

  return attachments.map((item) => {
    const filename = path.basename(item.filepath);
    if (item.attachment.type === "text") {
      return { type: "text" as const, content: item.attachment.content, filename };
    }
    return {
      type: "file" as const,
      uri: `data:${item.attachment.mime};base64,${Buffer.from(item.attachment.content).toString("base64")}`,
      mime: item.attachment.mime,
      bytes: item.attachment.content,
      filename,
    };
  });
}

// v2 attachmentKind (prompt/attachment.ts) classes the data: uri; ours holds
// the mime directly — same two kinds, anything else is not a prompt part.
export function attachmentKind(mime: string): "Image" | "PDF" | undefined {
  if (mime.startsWith("image/")) return "Image";
  if (mime === "application/pdf") return "PDF";
  return undefined;
}

// v2 promptAttachmentLabel: an identical uri+name reuses its existing label;
// otherwise the next free [Kind N] — N counts the labels already in play.
export function nextAttachmentLabel(labels: readonly string[], kind: "Image" | "PDF"): string {
  const pattern = new RegExp(`^\\[${kind} (\\d+)\\]$`);
  const highest = labels.reduce((acc, label) => {
    const match = label.match(pattern);
    return match ? Math.max(acc, Number(match[1])) : acc;
  }, 0);
  return `[${kind} ${highest + 1}]`;
}

// v2 deduplicatePromptImages: identical identity (name + label here — v2 adds
// a description we do not carry) collapses to the first payload.
export function deduplicatePromptImages<T extends { uri: string; name?: string; label: string }>(
  files: readonly T[],
): T[] {
  if (files.length < 2) return [...files];
  const seen = new Set<string>();
  const out: T[] = [];
  for (const file of files) {
    const key = JSON.stringify([file.name ?? null, file.label]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(file);
  }
  return out;
}

// Submit-time truth: the labels are virtual text (v2 extmarks) — the message
// carries the files, not their labels. Removes each label and the one space
// the attach inserted after it.
export function stripAttachmentLabels(text: string, labels: readonly string[]): string {
  let out = text;
  for (const label of labels) {
    out = out.split(`${label} `).join("").split(label).join("");
  }
  return out;
}

export type UploadClient = {
  request(method: string, params: unknown, timeout?: number): Promise<unknown>;
};

// The upload funnel: begin -> chunks (512KB base64) -> commit; the sha256
// checksum is verified server-side and the reply carries the artifact ref.
export async function uploadSessionAttachment(
  client: UploadClient,
  sessionId: string,
  file: { mime: string; bytes: Uint8Array; filename: string },
  connectionId = `tui-${Math.random().toString(36).slice(2, 10)}`,
): Promise<string> {
  const bytes = Buffer.from(file.bytes);
  const checksum = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const CHUNK = 512 * 1024;
  const totalChunks = Math.ceil(bytes.byteLength / CHUNK);
  const uploadId = `up-${randomId()}`;
  await client.request("v4/attachment/begin", {
    connectionId,
    uploadId,
    sessionId,
    fileName: file.filename.slice(0, 255),
    mime: file.mime,
    totalBytes: bytes.byteLength,
    totalChunks,
    checksum,
  });
  for (let index = 0; index < totalChunks; index++) {
    await client.request("v4/attachment/chunk", {
      connectionId,
      uploadId,
      sessionId,
      chunkIndex: index,
      dataBase64: bytes.subarray(index * CHUNK, (index + 1) * CHUNK).toString("base64"),
    });
  }
  const commit = (await client.request("v4/attachment/commit", {
    connectionId,
    uploadId,
    sessionId,
  })) as { ref?: string };
  if (!commit?.ref) throw new Error("attachment commit returned no ref");
  return commit.ref;
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}
