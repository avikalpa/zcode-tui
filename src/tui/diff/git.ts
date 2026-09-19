// THE zcode wiring of the diff viewer (the only non-port part — everything
// visual traces to opencode v2's feature-plugins/system/diff-viewer.tsx).
//
// The reference asks its server (`client.vcs.*`); we have no such verb, so
// this module reproduces the SERVER semantics with local git in the session
// cwd, mirroring opencode's own adapter (packages/core/src/plugin/vcs/git.ts):
//   working   -> `git diff HEAD` (+ untracked files via --no-index /dev/null)
//   branch    -> `git diff <merge-base(HEAD, default)>`   (branch + local)
//   committed -> `git diff <merge-base> HEAD`             (commits only)
// with `--no-ext-diff --no-renames --unified=12` (the TUI's context line
// count) and the reference's default-branch resolution.

import { execFile } from "node:child_process";

export type DiffMode = "branch" | "committed" | "working";

export type DiffFile = {
  readonly file: string;
  readonly patch?: string;
  readonly additions: number;
  readonly deletions: number;
  readonly status: "added" | "deleted" | "modified";
};

export type DiffBase = { name: string; ref: string };

export type DiffResult = {
  base: DiffBase | null;
  files: DiffFile[];
  /** committed mode with no resolvable base — the reference shows its
   * "Committed comparison unavailable…" notice instead of an error. */
  unavailable?: boolean;
};

const DIFF_CONTEXT_LINES = 12;
// Budget guards: a giant worktree must not freeze the TUI on open.
const MAX_PATCH_BYTES = 8 * 1024 * 1024;
const MAX_UNTRACKED_FILES = 50;

function runGit(cwd: string, args: string[], opts?: { allowExit1?: boolean; maxBytes?: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd, maxBuffer: opts?.maxBytes ?? MAX_PATCH_BYTES, timeout: 15_000, encoding: "utf8" },
      (err, stdout) => {
        if (!err) return resolve(stdout);
        // git diff --no-index exits 1 on differences — the output is still valid.
        const anyErr = err as unknown as { code?: number | string; stdout?: string };
        if (opts?.allowExit1 && (anyErr.code === 1 || anyErr.code === "1")) {
          return resolve(String(anyErr.stdout ?? stdout ?? ""));
        }
        reject(err);
      },
    );
  });
}

async function hasHead(cwd: string): Promise<boolean> {
  try {
    await runGit(cwd, ["rev-parse", "--verify", "--quiet", "HEAD"]);
    return true;
  } catch {
    return false;
  }
}

async function revVerify(cwd: string, ref: string): Promise<boolean> {
  try {
    await runGit(cwd, ["rev-parse", "--verify", "--quiet", ref]);
    return true;
  } catch {
    return false;
  }
}

// The reference's defaultBranch: origin's HEAD symref first, then the
// conventional names. Returns the display name plus the ref to merge against.
export async function defaultBranch(cwd: string): Promise<DiffBase | null> {
  try {
    const short = (await runGit(cwd, ["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"])).trim();
    if (short) return { name: short.replace(/^origin\//, ""), ref: short };
  } catch {
    // fall through to the conventional candidates
  }
  for (const candidate of ["main", "master", "origin/main", "origin/master"]) {
    if (await revVerify(cwd, candidate)) {
      return { name: candidate.replace(/^origin\//, ""), ref: candidate };
    }
  }
  return null;
}

export async function mergeBase(cwd: string, ref: string): Promise<string | null> {
  try {
    const base = (await runGit(cwd, ["merge-base", "HEAD", ref])).trim();
    return base || null;
  } catch {
    return null;
  }
}

export async function listBranches(cwd: string, limit = 200): Promise<string[]> {
  const out = await runGit(cwd, ["for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes"]);
  return out.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, limit);
}

// Split one `git diff --patch` output into per-file DiffFile records.
// Exported pure for tests.
export function parseGitDiff(output: string): DiffFile[] {
  if (!output) return [];
  const sections = output.split(/^diff --git /m).slice(1);
  const files: DiffFile[] = [];
  for (const sectionRaw of sections) {
    const lines = sectionRaw.split("\n");
    // Paths read from the +++/--- headers (a vs /dev/null decides the
    // status, the same signals the reference's name-status parse produces
    // under --no-renames). Binary sections carry no headers and no hunks —
    // their path comes from the `diff --git a/x b/y` line.
    let oldPath: string | null = null;
    let newPath: string | null = null;
    let oldHeader: string | null = null;
    let newHeader: string | null = null;
    let gitLine: string | null = null;
    let binaryLine: string | null = null;
    // Content starts at the first @@ header; a section without one (binary)
    // has no content lines at all.
    let bodyStart = lines.length;
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (index === 0 && lines.length > 0) gitLine = "diff --git " + line;
      if (line.startsWith("--- ")) { oldHeader = line; oldPath = parseDiffHeaderPath(line); }
      else if (line.startsWith("+++ ")) { newHeader = line; newPath = parseDiffHeaderPath(line); }
      else if (line.startsWith("Binary files ")) binaryLine = line;
      else if (line.startsWith("@@ ")) {
        bodyStart = index;
        break;
      }
    }
    const hasHunks = bodyStart < lines.length;
    const path = newPath && newPath !== "/dev/null" ? newPath : oldPath && oldPath !== "/dev/null" ? oldPath : parseGitLinePath(gitLine, binaryLine);
    if (!path) continue;
    const status: DiffFile["status"] =
      oldPath === "/dev/null" ? "added" : newPath === "/dev/null" ? "deleted" : parseGitLineStatus(gitLine, binaryLine);

    let additions = 0;
    let deletions = 0;
    for (let index = bodyStart; index < lines.length; index++) {
      const line = lines[index];
      if (line.startsWith("+")) additions++;
      else if (line.startsWith("-")) deletions++;
    }

    // The patch handed to the renderer is standard unified: the verbatim
    // ---/+++ headers plus hunks (the "diff --git" + mode/index prologue is
    // dropped, and binary sections — no hunks — fall back to the no-patch
    // notice, the reference's behavior for a missing patch).
    const unified = hasHunks && oldHeader !== null && newHeader !== null
      ? [oldHeader, newHeader, ...lines.slice(bodyStart)].join("\n")
      : undefined;

    files.push({
      file: path,
      patch: unified,
      additions: hasHunks ? additions : 0,
      deletions: hasHunks ? deletions : 0,
      status,
    });
  }
  return files;
}

// `diff --git a/x b/y` -> the changed side's path; the Binary-files line
// (`Binary files /dev/null and b/x differ`) decides which side is real.
function parseGitLinePath(gitLine: string | null, binaryLine: string | null): string | null {
  if (!gitLine) return null;
  const match = gitLine.match(/^diff --git a\/(.+?) b\/(.+)$/);
  if (!match) return null;
  if (binaryLine) {
    const sides = binaryLine.slice("Binary files ".length).replace(" differ", "").split(" and ");
    return sides[1] === "/dev/null" ? sides[0].replace(/^a\//, "") : sides[1].replace(/^b\//, "");
  }
  return match[2];
}

function parseGitLineStatus(gitLine: string | null, binaryLine: string | null): DiffFile["status"] {
  if (gitLine && /new file mode/.test(gitLine)) return "added";
  if (gitLine && /deleted file mode/.test(gitLine)) return "deleted";
  if (binaryLine) {
    return binaryLine.includes("/dev/null and ") ? "added" : "deleted";
  }
  return "modified";
}

function parseDiffHeaderPath(line: string): string | null {
  // `--- a/path`, `--- /dev/null`, `+++ b/path` — strip the a// b/ prefix,
  // honouring quoted paths with escapes the way git writes them.
  const raw = line.slice(4).replace(/\t.*$/, "").trim();
  if (raw === "/dev/null") return "/dev/null";
  const unquoted = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
  return unquoted.replace(/^[ab]\//, "");
}

async function untrackedFiles(cwd: string): Promise<string[]> {
  try {
    const out = await runGit(cwd, ["ls-files", "--others", "--exclude-standard", "-z"], { maxBytes: 1024 * 1024 });
    return out.split("\0").filter(Boolean).slice(0, MAX_UNTRACKED_FILES);
  } catch {
    return [];
  }
}

async function untrackedPatch(cwd: string, file: string): Promise<string | undefined> {
  try {
    const out = await runGit(
      cwd,
      ["diff", "--no-index", "--patch", "--no-ext-diff", "--no-renames", `--unified=${DIFF_CONTEXT_LINES}`, "--", "/dev/null", file],
      { allowExit1: true },
    );
    return out.includes("@@ ") ? out : undefined;
  } catch {
    return undefined;
  }
}

export async function gitDiff(cwd: string, mode: DiffMode, baseRef?: string): Promise<DiffResult> {
  if (!(await hasHead(cwd))) {
    // No commits: the reference's working mode still shows untracked files.
    if (mode === "working") return { base: null, files: await collectUntracked(cwd) };
    return { base: null, files: [], unavailable: mode === "committed" };
  }

  if (mode === "working") {
    const out = await runGit(cwd, ["diff", "--patch", "--no-ext-diff", "--no-renames", `--unified=${DIFF_CONTEXT_LINES}`, "HEAD", "--", "."]);
    const files = parseGitDiff(out);
    const untracked = await collectUntracked(cwd);
    return { base: null, files: [...files, ...untracked] };
  }

  const chosen: DiffBase | null = baseRef
    ? { name: baseRef.replace(/^origin\//, ""), ref: baseRef }
    : await defaultBranch(cwd);
  if (!chosen) {
    return mode === "committed" ? { base: null, files: [], unavailable: true } : { base: null, files: [], unavailable: true };
  }
  const ref = await mergeBase(cwd, chosen.ref);
  if (!ref) throw new Error(`No merge base available for ${chosen.name}`);

  const target = mode === "committed" ? "HEAD" : undefined;
  const out = await runGit(
    cwd,
    ["diff", "--patch", "--no-ext-diff", "--no-renames", `--unified=${DIFF_CONTEXT_LINES}`, ref, ...(target ? [target] : []), "--", "."],
  );
  return { base: { name: chosen.name, ref }, files: parseGitDiff(out) };
}

async function collectUntracked(cwd: string): Promise<DiffFile[]> {
  const names = await untrackedFiles(cwd);
  const files: DiffFile[] = [];
  for (const name of names) {
    const patch = await untrackedPatch(cwd, name);
    const counts = patch ? countPatchLines(patch) : { additions: 0, deletions: 0 };
    files.push({ file: name, patch, additions: counts.additions, deletions: counts.deletions, status: "added" });
  }
  return files;
}

function countPatchLines(patch: string) {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions++;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
  }
  return { additions, deletions };
}
