#!/usr/bin/env python3
"""parity-report — the port map and gap report for the vendored opencode
reference (tools/opencode-reference/).

The convention it enforces: every ported file in src/ carries a header line

    Ported from opencode <version> packages/tui/src/<path>

(and generated files carry `Generated from opencode <version> ...`). The
machine-readable port map IS those headers — no separate registry to let
drift. Verbs:

    parity-report.py --map       the port map (our file <- reference path)
    parity-report.py --stale     ports whose reference changed since their
                                 header version (re-port candidates)
    parity-report.py --gaps      upstream keybinds with no/partial coverage
                                 (reads src/tui/keybinds-generated.ts)
    parity-report.py --reflog <path>
                                 history of an upstream file across our pins
"""
import argparse
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
REF = ROOT / "tools" / "opencode-reference"
SRC = ROOT / "src"
PORT_RE = re.compile(r"(?:Ported|Generated) from opencode (\S+) (\S+)")


def pin() -> str:
    try:
        return (REF / "VERSION").read_text().strip()
    except FileNotFoundError:
        sys.exit("no reference pinned — run tools/sync-opencode.sh first")


def port_map():
    entries = []
    for path in sorted(SRC.rglob("*")):
        if path.suffix not in (".ts", ".tsx") or not path.is_file():
            continue
        head = path.read_text(errors="ignore")[:4000]
        for m in PORT_RE.finditer(head):
            entries.append({
                "ours": str(path.relative_to(ROOT)),
                "version": m.group(1),
                "ref": m.group(2),
            })
    return entries


def git(*args):
    return subprocess.run(["git", "-C", str(ROOT), *args], capture_output=True, text=True).stdout.strip()


def cmd_map(_args):
    v = pin()
    entries = port_map()
    print(f"reference pin: {v} — {len(entries)} ported/generated files\n")
    for e in entries:
        flag = "" if e["version"] == v else f"   [ported from {e['version']}]"
        print(f"  {e['ours']}\n      <- {e['ref']}{flag}")


def cmd_stale(_args):
    v = pin()
    stale = [e for e in port_map() if e["version"] != v]
    if not stale:
        print(f"all ports carry the current pin ({v})")
        return
    print(f"reference pin is {v}; {len(stale)} port(s) predate it:\n")
    for e in stale:
        print(f"  {e['ours']}  (ported from {e['version']})\n      <- {e['ref']}")
        # What the pin bump changed upstream-side for this reference file.
        log = git("log", "--oneline", "--", f"tools/opencode-reference/tui/{e['ref'].replace('packages/tui/src/', '', 1) if e['ref'].startswith('packages/tui/src/') else e['ref']}")
        if log:
            print("      pin history: " + " | ".join(log.splitlines()[:3]))


def cmd_gaps(_args):
    gen = SRC / "tui" / "keybinds-generated.ts"
    if not gen.exists():
        sys.exit("no keybinds-generated.ts — run tools/gen-keybinds.py first")
    counts: dict[str, int] = {}
    uncovered = []
    for line in gen.read_text().splitlines():
        m = re.search(r'coverage: "(\w[^"]*)"', line)
        if not m:
            continue
        cov = m.group(1)
        counts[cov] = counts.get(cov, 0) + 1
        if cov in ("none", "partial", "blocked-host"):
            m2 = re.search(r'id: "([^"]+)"', line)
            if m2:
                uncovered.append((cov, m2.group(1)))
    print("coverage counts:")
    for k in sorted(counts):
        print(f"  {k:14} {counts[k]}")
    print(f"\nopen surfaces ({len(uncovered)} binds):")
    for cov, kid in uncovered:
        print(f"  [{cov:12}] {kid}")


def cmd_reflog(args):
    rel = args.path
    for base in (f"tools/opencode-reference/tui/{rel}", rel):
        out = git("log", "--oneline", "--", base)
        if out:
            print(out)
            return
    print(f"no pin history for {args.path}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--map", action="store_true")
    ap.add_argument("--stale", action="store_true")
    ap.add_argument("--gaps", action="store_true")
    ap.add_argument("--reflog", metavar="PATH")
    args = ap.parse_args()
    if args.map:
        cmd_map(args)
    elif args.stale:
        cmd_stale(args)
    elif args.gaps:
        cmd_gaps(args)
    elif args.reflog:
        cmd_reflog(args)
    else:
        ap.print_help()


if __name__ == "__main__":
    main()
