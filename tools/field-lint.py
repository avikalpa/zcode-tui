#!/usr/bin/env python3
"""field-lint — the field-retirement producer sweep, as a verb.

Born as dream ACK-2b455747e9 (R49, zcode-tui campaign). The producer-sweep
law (parity-v2.md 0.6.59): when field F is retired from interface I, no
ASSIGNMENT to F may survive anywhere in src — in ANY shape. TYPECHECK IS NOT
A PRODUCER SWEEP: .map() inference loses literal freshness, so the
excess-property check never fires, and tsc stayed green over the orphaned
`status:` ternary that blanked the plugins dialog for five proof runs.

What counts as a producer (all flagged, any context):
  * object key          `status:`  — direct, ternary, call, spread value
  * object shorthand    `{ status }` / `{ status, id }`
  * property write      `.status =` / `?.status =`
  * type declaration    `status:` / `status?:` in an interface or type
                        literal — re-adding the field is re-opening the drain

Generic field names (`status` lives on many interfaces) are handled by the
manifest's per-entry `allow` regexes: each marks a path/line shape that is a
KNOWN legitimate producer of a DIFFERENT surface. Anything unanticipated
fails the gate — false positives are review prompts, never silent passes
(vacuous-pass law).

Manifest: tools/field-lint.json — one entry per recorded retirement:
  {"iface": "DialogOption", "field": "status", "retired_in": "0.6.59",
   "note": "...", "allow": ["^src/tui/app\\.tsx:.*status: .*\\? .* : "]}

Usage:
  python3 tools/field-lint.py                     enforce every recorded retirement
  python3 tools/field-lint.py --add IFACE FIELD --retired-in V
         [--note TEXT] [--allow REGEX]...          append an entry, then lint
  python3 tools/field-lint.py --iface IFACE --field FIELD
         [--allow REGEX]...                        lint ONE pair ad hoc

Exit: 0 clean · 1 survivors found · 2 usage or manifest error
"""

import argparse
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "tools" / "field-lint.json"


def producer_patterns(field):
    """An assignment to field F, any shape. F must not be a suffix of a
    longer identifier; the value shape is deliberately opaque (the 0.6.59
    defect was a ternary)."""
    f = re.escape(field)
    return [
        ("key-or-decl", r"(?<![\w.$])" + f + r"\??\s*:"),
        ("shorthand", r"[{,]\s*" + f + r"\s*[,}]"),
        ("prop-write", r"\??\." + f + r"\s*=(?!=)"),
    ]


def src_corpus():
    """Same corpus discipline as gen-keybinds.src_corpus: generated audit
    surfaces and tests excluded."""
    files = []
    for p in sorted((ROOT / "src").rglob("*")):
        if p.suffix not in (".ts", ".tsx"):
            continue
        s = str(p)
        if "generated" in s or ".test." in s:
            continue
        files.append(p)
    return files


def load_manifest():
    if not MANIFEST.exists():
        return []
    try:
        data = json.loads(MANIFEST.read_text())
    except json.JSONDecodeError as e:
        sys.stderr.write(f"field-lint: manifest {MANIFEST} unreadable: {e}\n")
        sys.exit(2)
    if not isinstance(data, list):
        sys.stderr.write("field-lint: manifest must be a JSON list\n")
        sys.exit(2)
    return data


def scan_entry(entry, texts):
    """Yield 'lie' messages for one retirement entry — every assignment
    shape not covered by the entry's allow regexes."""
    iface, field = entry.get("iface"), entry.get("field")
    if not iface or not field:
        yield f"manifest entry missing iface/field: {entry!r}"
        return
    allows = [re.compile(rx) for rx in entry.get("allow", [])]
    tag = f"{iface}.{field} (retired {entry.get('retired_in', '?')})"
    for rel, text in texts:
        for lineno, line in enumerate(text.splitlines(), 1):
            stripped = line.strip()
            if stripped.startswith("//") or stripped.startswith("*"):
                continue
            probe = f"{rel}:{lineno}: {line}"
            if any(rx.search(probe) for rx in allows):
                continue
            for shape, pat in producer_patterns(field):
                if re.search(pat, line):
                    yield f"{tag}: {shape} survives at {rel}:{lineno}: {stripped[:160]}"
                    break


def main():
    ap = argparse.ArgumentParser(description="field-retirement producer sweep")
    ap.add_argument("--add", nargs=2, metavar=("IFACE", "FIELD"))
    ap.add_argument("--retired-in", default="?", help="version the retirement shipped in")
    ap.add_argument("--note", default="", help="why the field retired")
    ap.add_argument("--allow", action="append", default=[],
                    help="allow regex matched against 'path:line: text'; repeatable")
    ap.add_argument("--iface", help="ad-hoc single-pair lint")
    ap.add_argument("--field", help="ad-hoc single-pair lint")
    args = ap.parse_args()

    if args.add:
        manifest = load_manifest()
        entry = {"iface": args.add[0], "field": args.add[1],
                 "retired_in": args.retired_in}
        if args.note:
            entry["note"] = args.note
        if args.allow:
            entry["allow"] = args.allow
        manifest.append(entry)
        MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")
        print(f"field-lint: manifest now holds {len(manifest)} retirement(s)")

    entries = load_manifest()
    if args.iface and args.field:
        if entries:
            only = (args.iface, args.field)
        else:
            entries = [{"iface": args.iface, "field": args.field,
                        "retired_in": "ad-hoc", "allow": args.allow}]
            only = None
    else:
        only = None

    if not entries:
        print("field-lint: no retirements recorded — nothing to enforce")
        return 0

    texts = [(str(p.relative_to(ROOT)), p.read_text()) for p in src_corpus()]
    lies = []
    for entry in entries:
        if only and (entry.get("iface"), entry.get("field")) != only:
            continue
        for msg in scan_entry(entry, texts):
            lies.append(msg)

    if lies:
        for m in lies:
            print(f"LIE: {m}")
        print(f"field-lint: {len(lies)} survivor(s) over {len(entries)} "
              f"retirement(s) — the field came back. Either the producer is a "
              f"real defect (the R49 class) or it feeds a different surface: "
              f"record it in the allow list, with proof.")
        return 1
    print(f"field-lint: {len(entries)} retirement(s) enforced over "
          f"{len(texts)} files — 0 survivors")
    return 0


if __name__ == "__main__":
    sys.exit(main())
