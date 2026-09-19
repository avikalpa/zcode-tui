#!/usr/bin/env python3
"""Generate src/tui/keybinds-generated.ts (the upstream keybind registry with
per-bind coverage classes) + docs/parity-keybinds.md (the machine-refreshed
gap list) from the vendored reference (tools/opencode-reference/).

Coverage classes come from tools/keybind-coverage.json: longest matching
prefix wins. They are an AUDIT, not wiring — nothing in the app reads them;
the value is that every upstream sync refreshes a measurable gap list, so
the next wave picks its target from data.

`lint` (dream ACK-08559cd60e, shipped 0.6.37): every row classified covered
must show wiring evidence, and batch notes must name their member ids
explicitly so a future upstream id defaults to uncovered until claimed.
The four covered-lies this campaign retired by hand (copy/copy.id 0.6.33;
session.background/session.cd 0.6.34) were all born as silent batch covers;
this lint is the re-verification the ledger never had.

Evidence tiers per covered id (first match wins):
  1. verbatim — the dotted id appears in src/ (palette descriptions carry
     "v2 <id>" for rows shipped under the palette convention)
  2. member pattern — members is a dict {id: regex}; the id's own regex
  3. family evidence — the entry's "evidence" regex (the surface that
     implements the whole family, e.g. PatchDiff for diff.*)
A covered id with no evidence at any tier is a covered-LIE — retire it
(status + note) or ship the wiring; do not add an evidence regex that does
not grep. That would be a lie with extra steps.
"""
import argparse
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
REF = ROOT / "tools" / "opencode-reference"
SRC_KEYBIND = REF / "tui" / "config" / "keybind.ts"
COVERAGE_CFG = ROOT / "tools" / "keybind-coverage.json"
OUT_TS = ROOT / "src" / "tui" / "keybinds-generated.ts"
OUT_MD = ROOT / "docs" / "parity-keybinds.md"

ENTRY_RE = re.compile(r'"?([\w.]+)"?:\s*keybind\(')
DESC_RE = re.compile(r'("((?:[^"\\]|\\.)*)")\s*$')


def parse_entries(text: str):
    """Scan the whole source (entries may span lines); for each `id: keybind(`
    capture the balanced-paren argument list, then split keys/description."""
    entries = []
    for m in ENTRY_RE.finditer(text):
        kid = m.group(1)
        start = m.end()  # after the open paren
        depth = 1
        i = start
        in_str = False
        while i < len(text) and depth > 0:
            ch = text[i]
            if in_str:
                if ch == '"':
                    in_str = False
            elif ch == '"':
                in_str = True
            elif ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
            i += 1
        args = text[start : i - 1]
        dm = DESC_RE.search(args)
        if not dm:
            entries.append({"id": kid, "keys": "<unparsed>", "description": "", "raw": args.strip()[:60]})
            continue
        keys = parse_keys(args[: dm.start()])
        entries.append({"id": kid, "keys": keys, "description": dm.group(2)})
    return entries


def parse_keys(arg: str) -> str:
    arg = arg.strip()
    if arg.startswith('"'):
        return arg[1:].split('"')[0]
    m = re.search(r'key:\s*"([^"]+)"', arg)
    if m:
        return m.group(1)
    return "<complex>"


def load_coverage():
    cfg = json.loads(COVERAGE_CFG.read_text())
    prefixes = sorted(cfg["prefixes"].items(), key=lambda kv: -len(kv[0]))
    return prefixes, cfg.get("unmatched-default", "none"), cfg


def classify(kid: str, prefixes, default):
    """Longest matching prefix wins — except a batch entry with explicit
    `members` covers ONLY its members: an id it does not name falls through
    to the next matching prefix or the default (new upstream ids under a
    batch note default to uncovered until someone claims them)."""
    for prefix, info in prefixes:
        if kid == prefix or kid.startswith(prefix):
            members = info.get("members")
            if members is not None:
                names = members.keys() if isinstance(members, dict) else members
                if kid not in names:
                    continue
            return info.get("status", "none"), info.get("note", "")
    return default, ""


def src_corpus():
    """src files where wiring evidence may live — generated audit surfaces
    (keybinds-generated.ts, themes-generated.ts) and tests excluded."""
    files = []
    for p in sorted((ROOT / "src").rglob("*")):
        if p.suffix not in (".ts", ".tsx"):
            continue
        s = str(p)
        if "generated" in s or ".test." in s:
            continue
        files.append(p)
    return files


def lint(prefixes, default, binds):
    """Return (flags, owner_of) — flags is a list of (severity, message).
    owner_of maps bind id -> owning prefix entry name (members-aware)."""
    corpus = src_corpus()
    texts = [(p.relative_to(ROOT), p.read_text()) for p in corpus]

    def grep(pattern):
        rx = re.compile(pattern)
        return [rel for rel, t in texts if rx.search(t)]

    flags = []
    owner_of = {}
    for b in binds:
        for prefix, info in prefixes:
            if b["id"] == prefix or b["id"].startswith(prefix):
                members = info.get("members")
                if members is not None:
                    names = members.keys() if isinstance(members, dict) else members
                    if b["id"] not in names:
                        continue
                owner_of[b["id"]] = prefix
                break

    upstream_ids = {b["id"] for b in binds}
    for prefix, info in prefixes:
        name = prefix
        status = info.get("status", "none")
        note = info.get("note", "")
        if '"' in note:
            flags.append(("lie", f'{name}: note contains a double-quote — breaks the generated TS build'))
        matched = [i for i, own in owner_of.items() if own == prefix]
        if status != "covered":
            continue
        members = info.get("members")
        if len(matched) > 1 and members is None:
            flags.append(("lie", f'{name}: batch note covers {len(matched)} ids with NO explicit members — silent-cover birth mechanism (dream ACK-08559cd60e)'))
        if members is not None:
            names = list(members.keys()) if isinstance(members, dict) else list(members)
            for m_name in names:
                if m_name not in upstream_ids:
                    flags.append(("warn", f'{name}: member {m_name!r} is not in the upstream registry (stale member — retire it)'))
            if isinstance(members, dict):
                for m_name, pat in members.items():
                    if m_name in upstream_ids and not grep(pat):
                        flags.append(("lie", f'{name}: member {m_name!r} evidence /{pat}/ greps NOWHERE in src'))
        family_ev = info.get("evidence")
        if family_ev is not None and not grep(family_ev):
            flags.append(("lie", f'{name}: family evidence /{family_ev}/ greps NOWHERE in src'))
        for i in matched:
            if grep(re.escape(i)):
                continue  # tier 1: verbatim
            if isinstance(members, dict) and i in members and grep(members[i]):
                continue  # tier 2: member pattern (already checked, keep shape)
            if family_ev is not None and grep(family_ev):
                continue  # tier 3: family surface
            flags.append(("lie", f'{name}: covered id {i!r} has NO wiring evidence (no verbatim id, no member pattern, no family evidence)'))
    return flags, owner_of


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("verb", nargs="?", default="gen", choices=["gen", "lint"])
    ap.add_argument("--quiet", action="store_true", help="lint: print nothing but the exit verdict")
    args = ap.parse_args()

    if not SRC_KEYBIND.exists():
        sys.exit("no vendored reference — run tools/sync-opencode.sh first")
    version = (REF / "VERSION").read_text().strip()
    text = SRC_KEYBIND.read_text()

    binds = []
    unmatched = []
    for entry in parse_entries(text):
        if entry["keys"] == "<unparsed>":
            unmatched.append(entry["raw"])
            continue
        binds.append(entry)

    prefixes, default, cfg = load_coverage()
    for b in binds:
        b["coverage"], b["note"] = classify(b["id"], prefixes, default)

    flags, _ = lint(prefixes, default, binds)

    if args.verb == "lint":
        if not args.quiet:
            lies = [f for f in flags if f[0] == "lie"]
            warns = [f for f in flags if f[0] == "warn"]
            for sev, msg in flags:
                print(f"{sev.upper()}: {msg}")
            print(f"lint: {len(binds)} binds, {len(lies)} lies, {len(warns)} warnings")
        if flags:
            sys.exit(1)
        if not args.quiet:
            print("lint: clean")
        return

    counts: dict[str, int] = {}
    for b in binds:
        counts[b["coverage"]] = counts.get(b["coverage"], 0) + 1

    ts = [
        "// Generated by tools/gen-keybinds.py from the vendored opencode",
        f"// reference ({version}, tools/opencode-reference/) — DO NOT EDIT BY HAND.",
        "// The registry is the parity AUDIT surface, not wiring: the app's own",
        "// keymap is hand-maintained; this file exists so every upstream sync",
        "// refreshes a measurable coverage report (see docs/parity-keybinds.md).",
        f'export const UPSTREAM_KEYBIND_VERSION = "{version}";',
        "",
        "export interface UpstreamKeybind {",
        "  id: string;",
        "  keys: string;",
        "  description: string;",
        '  coverage: "covered" | "partial" | "none" | "blocked-host" | "law";',
        "  note?: string;",
        "}",
        "",
        "export const UPSTREAM_KEYBINDS: UpstreamKeybind[] = [",
    ]
    for b in binds:
        note = f', note: "{b["note"]}"' if b.get("note") else ""
        ts.append(
            f'  {{ id: "{b["id"]}", keys: "{b["keys"]}", description: "{b["description"]}", coverage: "{b["coverage"]}"{note} }},'
        )
    ts.append("];")
    ts.append("")
    ts.append(f"export const UPSTREAM_KEYBIND_COUNT = {len(binds)};")
    OUT_TS.write_text("\n".join(ts) + "\n")

    md = [
        "# Parity keybind coverage (GENERATED — do not edit by hand)",
        "",
        f"Upstream reference: **{version}** — {len(binds)} keybind definitions",
        "(packages/tui/src/config/keybind.ts). Classes from",
        "tools/keybind-coverage.json; regenerate with tools/gen-keybinds.py.",
        "",
        "| class | binds |",
        "|---|---|",
    ]
    for k in sorted(counts):
        md.append(f"| {k} | {counts[k]} |")
    md += ["", "Open surfaces (partial / none / blocked-host):", ""]
    for b in binds:
        if b["coverage"] in ("partial", "none", "blocked-host"):
            note = f" — {b['note']}" if b.get("note") else ""
            md.append(f"- `{b['id']}` ({b['keys']}) [{b['coverage']}]{note}")
    OUT_MD.write_text("\n".join(md) + "\n")

    print(f"wrote {OUT_TS.relative_to(ROOT)} and {OUT_MD.relative_to(ROOT)}")
    print(f"{version}: {len(binds)} binds — " + ", ".join(f"{k}={v}" for k, v in sorted(counts.items())))
    if unmatched:
        print(f"UNPARSED {len(unmatched)} entries (kept out of the registry):")
        for line in unmatched[:5]:
            print("  " + line)
    if flags:
        lies = [f for f in flags if f[0] == "lie"]
        print(f"LINT: {len(lies)} covered-lie flags (run `gen-keybinds.py lint` for the list)")


if __name__ == "__main__":
    main()
