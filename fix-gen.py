from pathlib import Path
p = Path("tools/gen-themes.py")
s = p.read_text()
old = "MD_MAP = ["
new = """DIFF_MAP = [
    ("diffAdded", "diffAdded", ["success"]),
    ("diffRemoved", "diffRemoved", ["error"]),
    ("diffContext", "diffContext", ["subtle"]),
    ("diffAddedBg", "diffAddedBg", []),
    ("diffRemovedBg", "diffRemovedBg", []),
    ("diffContextBg", "diffContextBg", []),
]

MD_MAP = ["""
assert "DIFF_MAP" not in s, "already applied"
s = s.replace(old, new, 1)
old = """        md_lines.append(f"  \\"{name}\\": {{ {mdbody} }}),")"""
new = """        md_lines.append(f"  \\"{name}\\": {{ {mdbody} }}),")
        dv = {}
        for token, key, fallbacks in DIFF_MAP:
            v = pick(theme, key, fallbacks, defs)
            if v is None:
                v = {"diffAdded": "#4fd6be", "diffRemoved": "#c53b53", "diffContext": "#828bb8",
                     "diffAddedBg": "#20303b", "diffRemovedBg": "#37222c", "diffContextBg": "#1e1e1e"}[token]
            dv[token] = normalize(v).lower()
        dbody = ", ".join(f"{k}: \\"{v}\\"" for k, v in dv.items())
        diff_lines.append(f"  \\"{name}\\": {{ {dbody} }}),")"""
assert old in s, "loop emit"
s = s.replace(old, new, 1)
old = """    lines.append("} as const;")
    lines.extend(md_lines)
    lines.append("} as const;")"""
new = """    lines.append("} as const;")
    lines.extend(md_lines)
    lines.append("} as const;")
    lines.extend(diff_lines)
    lines.append("} as const;")"""
assert old in s, "tail emit"
s = s.replace(old, new, 1)
old = '''    md_lines = ["", "export const OFFICIAL_MD: Record<string, MdTokens> = {"]'''
new = '''    diff_lines = ["", "export const OFFICIAL_DIFF: Record<string, {", *[f"  {name}: string;" for name, _, _fb in DIFF_MAP], "}> = {"]
    md_lines = ["", "export const OFFICIAL_MD: Record<string, MdTokens> = {"]'''
assert old in s, "diff_lines init"
s = s.replace(old, new, 1)
p.write_text(s)
print("generator extended ok")
