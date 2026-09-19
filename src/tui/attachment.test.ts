// The 0.6.35 attachments module: resolution, labels, dedupe, submit-strip.
// Resolution runs against REAL temp files (the v2 shape is fs-bound); the
// injected reader proves the mime gate separately.
import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  attachmentKind,
  deduplicatePromptImages,
  nextAttachmentLabel,
  normalizePastedFilepath,
  parsePastedFilepaths,
  readLocalAttachmentWith,
  resolvePastedAttachments,
  stripAttachmentLabels,
  type LocalFiles,
} from "./attachment";

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe("readLocalAttachmentWith", () => {
  const files: LocalFiles = {
    readText: async (p) => "<svg/>" + p,
    readBytes: async () => PNG_BYTES,
    mime: async (p) =>
      ({ ".png": "image/png", ".svg": "image/svg+xml", ".txt": "text/plain", ".pdf": "application/pdf" })[p.slice(p.lastIndexOf("."))] ??
      "application/octet-stream",
  };

  test("binary images ride as binary", async () => {
    const got = await readLocalAttachmentWith(files, "/x/a.png");
    expect(got?.type).toBe("binary");
  });
  test("svg rides as text", async () => {
    const got = await readLocalAttachmentWith(files, "/x/a.svg");
    expect(got).toEqual({ type: "text", mime: "image/svg+xml", content: "<svg/>/x/a.svg" });
  });
  test("pdf is a candidate, plain text is not", async () => {
    expect((await readLocalAttachmentWith(files, "/x/a.pdf"))?.type).toBe("binary");
    expect(await readLocalAttachmentWith(files, "/x/a.txt")).toBeUndefined();
  });
  test("a missing file dies at the read, not the mime", async () => {
    const missing: LocalFiles = { ...files, readBytes: async () => { throw new Error("nope"); } };
    expect(await readLocalAttachmentWith(missing, "/x/a.png")).toBeUndefined();
  });
});

describe("resolvePastedAttachments", () => {
  let dir: string;
  const pngPath = () => path.join(dir, "at.png");
  const secondPath = () => path.join(dir, "b.webp");

  test("single image path resolves to a data-uri part", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "at-"));
    await writeFile(pngPath(), PNG_BYTES);
    const got = await resolvePastedAttachments(pngPath());
    expect(got?.length).toBe(1);
    const item = got![0];
    expect(item.type).toBe("file");
    if (item.type === "file") {
      expect(item.filename).toBe("at.png");
      expect(item.mime).toBe("image/png");
      expect(item.uri.startsWith("data:image/png;base64,")).toBe(true);
    }
  });

  test("prose is not an attachment", async () => {
    expect(await resolvePastedAttachments("just some words pasted")).toBeUndefined();
  });
  test("an http url is not an attachment", async () => {
    expect(await resolvePastedAttachments("https://example.com/a.png")).toBeUndefined();
  });
  test("a single nonexistent path falls back to text", async () => {
    expect(await resolvePastedAttachments(path.join(dir, "missing.png"))).toBeUndefined();
  });
  test("an all-paths paste resolves every file", async () => {
    await writeFile(secondPath(), Buffer.from("RIFF0000WEBPVP8 "));
    const got = await resolvePastedAttachments(`${pngPath()} ${secondPath()}`);
    expect(got?.map((g) => (g.type === "file" ? g.filename : g.content))).toEqual(["at.png", "b.webp"]);
  });
  test("a multi-path paste with one miss is not an attachment paste", async () => {
    const got = await resolvePastedAttachments(`${pngPath()} and some words here`);
    expect(got).toBeUndefined();
  });
  test("a quoted file:// url decodes", async () => {
    const got = await resolvePastedAttachments(`file://${pngPath()}`);
    expect(got?.length).toBe(1);
  });
});

describe("the label grammar", () => {
  test("the first image is [Image 1]", () => {
    expect(nextAttachmentLabel([], "Image")).toBe("[Image 1]");
  });
  test("the counter walks the highest existing", () => {
    expect(nextAttachmentLabel(["[Image 1]", "[Image 3]"], "Image")).toBe("[Image 4]");
  });
  test("kinds count separately", () => {
    expect(nextAttachmentLabel(["[Image 2]"], "PDF")).toBe("[PDF 1]");
  });
  test("attachmentKind classes mime", () => {
    expect(attachmentKind("image/png")).toBe("Image");
    expect(attachmentKind("application/pdf")).toBe("PDF");
    expect(attachmentKind("text/plain")).toBeUndefined();
  });
});

describe("dedupe + submit strip", () => {
  test("identical name+label collapses", () => {
    const files = [
      { uri: "data:image/png;base64,aa", name: "a.png", label: "[Image 1]" },
      { uri: "data:image/png;base64,bb", name: "a.png", label: "[Image 1]" },
      { uri: "data:image/png;base64,cc", name: "b.png", label: "[Image 2]" },
    ];
    expect(deduplicatePromptImages(files).length).toBe(2);
  });
  test("labels leave the text with their trailing space", () => {
    expect(stripAttachmentLabels("[Image 1] fix the bug", ["[Image 1]"])).toBe("fix the bug");
    expect(stripAttachmentLabels("fix [Image 1]", ["[Image 1]"])).toBe("fix ");
    expect(stripAttachmentLabels("[Image 1] [PDF 1] two", ["[Image 1]", "[PDF 1]"])).toBe("two");
  });
});

describe("pasted filepath parsing", () => {
  test("quotes and escapes strip", () => {
    expect(normalizePastedFilepath("'/tmp/a b.png'", "linux")).toBe("/tmp/a b.png");
    expect(parsePastedFilepaths("'/tmp/a b.png' /x/c.png", "linux")).toEqual(["/tmp/a b.png", "/x/c.png"]);
  });
  test("file:// urls decode", () => {
    expect(normalizePastedFilepath("file:///tmp/a.png", "linux")).toBe("/tmp/a.png");
  });
});
