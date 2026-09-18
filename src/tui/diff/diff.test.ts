import { describe, expect, test } from "bun:test";
import { splitPatchHunks } from "./split-patch-hunks";
import { buildFileTree, flattenFileTree, movePatchFileIndex, orderedPatchFileIndexes, singlePatchFileIndex } from "./file-tree-utils";
import { parseGitDiff } from "./git";
import { diffSourceLabel, filetypeOf } from "./diff-viewer";

const PATCH = `--- a/src/app.ts
+++ b/src/app.ts
@@ -1,4 +1,5 @@
 import { a } from "./a";
+import { b } from "./b";
 import { c } from "./c";
-const x = 1;
+const x = 2;
@@ -20,3 +21,4 @@
 function f() {
-  return 1;
+  return 2;
+  return 3;
 }`;

describe("splitPatchHunks", () => {
  test("splits a multi-hunk patch under per-hunk headers", () => {
    const hunks = splitPatchHunks(PATCH);
    expect(hunks.length).toBe(2);
    expect(hunks[0].header).toContain("@@ -1,4 +1,5 @@");
    expect(hunks[1].patch.startsWith("--- a/src/app.ts")).toBe(true);
    expect(hunks[1].patch).toContain("@@ -20,3 +21,4 @@");
  });

  test("single-hunk patches pass through whole", () => {
    const hunks = splitPatchHunks("--- a/f\n+++ b/f\n@@ -1,1 +1,1 @@\n-a\n+b\n");
    expect(hunks.length).toBe(1);
    expect(hunks[0].patch).toContain("+b");
  });

  test("row budget counts paired +/- blocks pairwise", () => {
    const hunks = splitPatchHunks(PATCH);
    // splitRows walks +/- RUNS separated by context: hunk 1 = ctx + run(+1)
    // + ctx + run(+1,-1) + ctx = 4; hunk 2 = ctx + run(+2,-1) + ctx = 4.
    expect(hunks[0].rows).toBe(4);
    expect(hunks[1].rows).toBe(4);
  });
});

describe("file tree", () => {
  const files = [
    { file: "src/app.ts" },
    { file: "src/lib/util.ts" },
    { file: "src/lib/deep/thing.ts" },
    { file: "README.md" },
  ];

  test("builds directories and files sorted dirs-first", () => {
    const tree = buildFileTree(files);
    const rows = flattenFileTree(tree, new Set(tree.nodes.filter((n) => n.kind === "directory").map((n) => n.id)));
    expect(rows[0].kind).toBe("directory");
    expect(rows[0].name).toBe("src");
    expect(rows[rows.length - 1]).toMatchObject({ kind: "file", name: "README.md" });
    expect(rows.map((r) => r.name)).toContain("app.ts");
    expect(rows.map((r) => r.name)).toContain("thing.ts");
  });

  test("collapses single-directory chains into one row", () => {
    const chain = buildFileTree([
      { file: "components/buttons/primary.ts" },
      { file: "components/buttons/secondary.ts" },
      { file: "README.md" },
    ]);
    // Fully collapsed: "components" → "buttons" is a single-child chain, so
    // it renders as one "components/buttons" directory row.
    const rows = flattenFileTree(chain, new Set());
    const dirRow = rows.find((row) => row.kind === "directory");
    expect(dirRow).toBeDefined();
    expect(dirRow!.name).toBe("components/buttons");
  });

  test("orderedPatchFileIndexes keeps only files, in tree order", () => {
    const tree = buildFileTree(files);
    const rows = flattenFileTree(tree, new Set(tree.nodes.filter((n) => n.kind === "directory").map((n) => n.id)));
    // dirs-first at every level: src -> lib -> deep -> thing.ts, util.ts,
    // then app.ts, then README.md.
    // dirs-first at EVERY level: src/lib subtree precedes src/app.ts.
    expect(orderedPatchFileIndexes(rows)).toEqual([2, 1, 0, 3]);
  });

  test("movePatchFileIndex clamps at the ends and jumps to first when unset", () => {
    const indexes = [0, 1, 2];
    expect(movePatchFileIndex(indexes, 0, -1)).toBe(0);
    expect(movePatchFileIndex(indexes, 2, 1)).toBe(2);
    expect(movePatchFileIndex(indexes, undefined, 1)).toBe(0);
    expect(movePatchFileIndex([], 0, 1)).toBeUndefined();
  });

  test("singlePatchFileIndex prefers selected, then current, then first", () => {
    expect(singlePatchFileIndex(2, 1, 0)).toBe(2);
    expect(singlePatchFileIndex(undefined, 1, 0)).toBe(1);
    expect(singlePatchFileIndex(undefined, undefined, 0)).toBe(0);
  });
});

const GIT_OUTPUT = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
 old
+new
 old2
diff --git a/new-file.ts b/new-file.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/new-file.ts
@@ -0,0 +1,2 @@
+hello
+world
diff --git a/gone.ts b/gone.ts
deleted file mode 100644
index 4444444..0000000
--- a/gone.ts
+++ /dev/null
@@ -1 +0,0 @@
-bye
diff --git a/blob.bin b/blob.bin
new file mode 100644
index 0000000..5555555
Binary files /dev/null and b/blob.bin differ
`;

describe("parseGitDiff", () => {
  const files = parseGitDiff(GIT_OUTPUT);

  test("parses one record per file section", () => {
    expect(files.map((f) => f.file)).toEqual(["src/app.ts", "new-file.ts", "gone.ts", "blob.bin"]);
  });

  test("statuses read from the /dev/null headers", () => {
    expect(files.map((f) => f.status)).toEqual(["modified", "added", "deleted", "added"]);
  });

  test("counts +/- content lines only", () => {
    expect(files[0].additions).toBe(1);
    expect(files[0].deletions).toBe(0);
    expect(files[1].additions).toBe(2);
    expect(files[2].deletions).toBe(1);
  });

  test("binary sections carry no patch and zero counts", () => {
    expect(files[3].patch).toBeUndefined();
    expect(files[3].additions).toBe(0);
  });

  test("patches are standard unified (---/+++ + hunks, no prologue)", () => {
    expect(files[0].patch!.startsWith("--- a/src/app.ts")).toBe(true);
    expect(files[0].patch).toContain("@@ -1,3 +1,4 @@");
    expect(files[0].patch).not.toContain("diff --git");
  });

  test("empty output parses to no files", () => {
    expect(parseGitDiff("")).toEqual([]);
  });
});

describe("diff viewer helpers", () => {
  test("source labels use the reference grammar", () => {
    expect(diffSourceLabel("branch")).toBe("All");
    expect(diffSourceLabel("committed")).toBe("Committed");
    expect(diffSourceLabel("working")).toBe("Uncommitted");
  });

  test("filetype derives from the extension", () => {
    expect(filetypeOf("a/b/c.ts")).toBe("ts");
    expect(filetypeOf("Makefile")).toBeUndefined();
  });
});
