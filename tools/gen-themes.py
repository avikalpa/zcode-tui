#!/usr/bin/env python3
"""Generate src/tui/themes-generated.ts from the official OpenCode TUI themes.

The JSONs under tools/opencode-themes/ are verbatim copies of
anomalyco/opencode (mirror of sst/opencode) at
packages/tui/src/theme/assets/<name>.json, dev branch, fetched 2026-09-10.

Usage: python3 tools/gen-themes.py
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "tools" / "opencode-themes"
OUT = ROOT / "src" / "tui" / "themes-generated.ts"

# ThemeTokens mapping: token -> (theme key, fallback chain)
TOKEN_MAP = [
    ("bg", "background", ["backgroundPanel", "backgroundElement"]),
    ("panel", "backgroundPanel", ["backgroundElement", "background"]),
    ("surface", "backgroundElement", ["backgroundPanel", "background"]),
    ("border", "border", ["borderSubtle", "backgroundElement"]),
    ("borderActive", "borderActive", ["border", "borderSubtle"]),
    ("fg", "text", []),
    ("subtle", "textMuted", ["text"]),
    ("faint", "borderSubtle", ["border", "textMuted"]),
    ("brand", "text", []),
    ("accent", "primary", []),
    ("accentText", "background", []),
    ("user", "secondary", ["primary"]),
    ("assistant", "info", ["secondary"]),
    ("tool", "warning", []),
    ("warning", "warning", []),
    ("error", "error", []),
    ("success", "success", []),
    ("selected", "primary", []),
]

MD_MAP = [
    ("mdText", "markdownText", ["text"]),
    ("mdHeading", "markdownHeading", ["accent"]),
    ("mdLink", "markdownLink", ["primary"]),
    ("mdLinkText", "markdownLinkText", ["info"]),
    ("mdCode", "markdownCode", ["success"]),
    ("mdQuote", "markdownBlockQuote", ["warning"]),
    ("mdEmph", "markdownEmph", ["warning"]),
    ("mdStrong", "markdownStrong", ["warning"]),
    ("mdListItem", "markdownListItem", ["primary"]),
    ("mdListEnum", "markdownListEnumeration", ["info"]),
    ("synComment", "syntaxComment", ["textMuted"]),
    ("synKeyword", "syntaxKeyword", ["accent"]),
    ("synFunction", "syntaxFunction", ["primary"]),
    ("synVariable", "syntaxVariable", ["error"]),
    ("synString", "syntaxString", ["success"]),
    ("synNumber", "syntaxNumber", ["warning"]),
    ("synType", "syntaxType", ["warning"]),
    ("synOperator", "syntaxOperator", ["info"]),
    ("synPunct", "syntaxPunctuation", ["text"]),
]


def resolve(value, defs, depth=0):
    if depth > 8:
        raise RuntimeError("def cycle")
    if isinstance(value, str) and value in defs:
        return resolve(defs[value], defs, depth + 1)
    return value


def pick(theme, key, fallbacks, defs):
    entry = theme.get(key)
    if isinstance(entry, dict):
        raw = entry.get("dark", entry.get("light"))
    elif entry is None:
        raw = None
    else:
        raw = entry
    if raw is not None:
        return resolve(raw, defs)
    for fb in fallbacks:
        entry = theme.get(fb)
        if isinstance(entry, dict):
            raw = entry.get("dark", entry.get("light"))
        elif entry is not None:
            raw = entry
        else:
            raw = None
        if raw is not None:
            return resolve(raw, defs)
    return None


def normalize(v):
    if v == "transparent":
        return "#00000000"
    if isinstance(v, str) and v.startswith("#") and len(v) == 4:
        return "#" + "".join(c * 2 for c in v[1:])
    return v


def is_hex(v):
    return isinstance(v, str) and v.startswith("#") and len(v) in (4, 5, 7, 9)


def main():
    names = sorted(p.stem for p in SRC.glob("*.json"))
    if not names:
        sys.exit(f"no theme json under {SRC}")
    lines = [
        "// GENERATED FILE — do not hand-edit.",
        "// Source: anomalyco/opencode (mirror of sst/opencode) dev branch,",
        "// packages/tui/src/theme/assets/*.json, fetched 2026-09-10.",
        "// Regenerate: python3 tools/gen-themes.py",
        "",
        "export interface MdTokens {",
        *[f"  {name}: string;" for name, _, _fb in MD_MAP],
        "}",
        "",
        "// Exact OpenCode palettes (dark arm), one entry per official theme.",
        "export const OFFICIAL_THEMES: Record<string, {",
        *[f"  {name}: string;" for name, _, _fb in TOKEN_MAP],
        "}> = {",
    ]
    md_lines = ["", "export const OFFICIAL_MD: Record<string, MdTokens> = {"]
    problems = []
    for name in names:
        data = json.loads((SRC / f"{name}.json").read_text())
        defs = data.get("defs", {})
        theme = data.get("theme", {})
        tokens = {}
        for token, key, fallbacks in TOKEN_MAP:
            v = pick(theme, key, fallbacks, defs)
            if v is None or not is_hex(v):
                problems.append(f"{name}: {token} ({key}) -> {v!r}")
                v = "#000000"
            tokens[token] = normalize(v).lower()
        md = {}
        for token, key, fallbacks in MD_MAP:
            v = pick(theme, key, fallbacks, defs)
            if v is None or not is_hex(v):
                problems.append(f"{name}: md.{token} ({key}) -> {v!r}")
                v = "#000000"
            md[token] = normalize(v).lower()
        body = ", ".join(f"{k}: \"{v}\"" for k, v in tokens.items())
        lines.append(f"  \"{name}\": {{ {body} }},")
        mdbody = ", ".join(f"{k}: \"{v}\"" for k, v in md.items())
        md_lines.append(f"  \"{name}\": {{ {mdbody} }},")
    lines.append("} as const;")
    lines.extend(md_lines)
    lines.append("} as const;")
    OUT.write_text("\n".join(lines) + "\n")
    print(f"wrote {OUT} with {len(names)} themes")
    if problems:
        print("NON-HEX RESOLUTIONS (check these):")
        for p in problems:
            print(" ", p)


if __name__ == "__main__":
    main()
