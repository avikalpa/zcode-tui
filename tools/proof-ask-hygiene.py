#!/usr/bin/env python3
r"""proof-ask-hygiene — the ask-hygiene gate (0.6.74, dream ACK-aa2f75ee28).

Law (R62/R63, measured): a probe/proof ASK is uncontrolled model-facing
input whose MODEL-GENERATED session title enters the shared daemon session
list — and the sessions dialog renders titles. The R63 sitting's ask
("count slowly from 1 to 30") generated the title "Spawn subagent to count
1 to 30"; B4's absence regex matched it and failed two gated runs. The
corpus is protocol-UNREMOVABLE (session/close refuses inactive sessions),
so poison prevention is the only lever: every ask literal must be
needle-inert by construction.

Rules enforced over ask literals:
  D  no STANDALONE digits (\b\d+\b) — the B4/TB poison class ("count 1 to
     30"); identifiers like pf636 are exempt (no digit word-boundary).
  C  no chrome tokens — modified-key substrings (ctrl+…) and key words
     (esc/enter/tab/…), the vocabulary stages assert on screens.
  A  no asserted-absence vocabulary — the manifest list of literals some
     stage checks `not in` the screen (swear new ones in at the manifest,
     the field-lint pattern).

Ask-literal producers scanned:
  tools/pty-proof.py   os.write(<fd>, b"...") prose writes (asks). Short
                       control-byte writes and space-free keystroke runs
                       are not asks; a prose write that is NOT an ask is
                       excused only by an explicit manifest allow entry.
  tools/*.ts           content: "..." / content: '...' protocol sends.

Exit: 0 clean, 1 violations, 2 usage/self-test-failed.
"""
import ast
import json
import os
import re
import sys

MANIFEST_PATH = os.path.join("tools", "proof-ask-hygiene.json")

PY_ASK_RE = re.compile(r"os\.write\(\s*[\w.\[\]]+\s*,\s*(b\"(?:[^\"\\]|\\.)*\")")
TS_ASK_RES = (
    re.compile(r"content\s*:\s*\"((?:[^\"\\]|\\.)*)\""),
    re.compile(r"content\s*:\s*'((?:[^'\\]|\\.)*)'"),
)

# A py write is ask-shaped when it is prose (has a space and >=3 letters);
# everything else is a keystroke and must be allow-listed to be scanned.
def is_ask_prose(text: str) -> bool:
    return bool(re.search(r"\s", text)) and len(re.findall(r"[A-Za-z]", text)) >= 3


def load_manifest():
    if not os.path.exists(MANIFEST_PATH):
        sys.exit(f"manifest missing: {MANIFEST_PATH}")
    with open(MANIFEST_PATH, encoding="utf-8") as fh:
        m = json.load(fh)
    for key in ("chrome_substrings", "chrome_words", "absence_vocabulary", "allow"):
        if key not in m:
            sys.exit(f"manifest missing key: {key}")
    return m


def violations_for(text: str, manifest) -> list:
    low = text.lower()
    hits = []
    if re.search(r"\b\d+\b", text):
        hits.append("D standalone-digit")
    for sub in manifest["chrome_substrings"]:
        if sub.lower() in low:
            hits.append(f"C chrome-substring:{sub}")
            break
    for word in manifest["chrome_words"]:
        if re.search(rf"\b{re.escape(word)}\b", low):
            hits.append(f"C chrome-word:{word}")
            break
    for needle in manifest["absence_vocabulary"]:
        if needle.lower() in low:
            hits.append(f"A absence-vocabulary:{needle}")
            break
    return hits


def allowed(text: str, manifest) -> bool:
    return any(a in text for a in manifest["allow"])


def scan_file(path: str, manifest, is_ts: bool):
    out = []
    with open(path, encoding="utf-8") as fh:
        src = fh.read()
    if is_ts:
        for rx in TS_ASK_RES:
            for m in rx.finditer(src):
                line = src.count("\n", 0, m.start()) + 1
                out.append((line, m.group(1), violations_for(m.group(1), manifest)))
    else:
        for m in PY_ASK_RE.finditer(src):
            line = src.count("\n", 0, m.start()) + 1
            text = ast.literal_eval(m.group(1)).decode("utf-8", "replace")
            if not is_ask_prose(text):
                continue  # keystroke class: control bytes, bare slash commands
            if allowed(text, manifest):
                continue  # excused by an explicit manifest entry (review-prompt, never silent)
            out.append((line, text, violations_for(text, manifest)))
    return out


def self_test(manifest) -> bool:
    ok = True
    cases = [
        ("count slowly from 1 to 30 then reply", ["D standalone-digit"]),
        ("press ctrl+f to expand the card", ["C chrome-substring:ctrl+"]),
        ("press esc to dismiss", ["C chrome-word:esc"]),
        ("leave the permission required card alone", ["A absence-vocabulary:permission required"]),
        ("Reply with the single word banana", []),
        ("create the file /tmp/zct-proof-cwd/pf636.txt containing just ok", []),
    ]
    for text, want in cases:
        got = violations_for(text, manifest)
        if got != want:
            ok = False
            print(f"SELF-TEST FAIL: {text!r} -> {got}, want {want}")
    if not is_ask_prose("Reply with exactly: ok") or is_ask_prose(""):
        ok = False
        print("SELF-TEST FAIL: prose classifier regressed")
    return ok


def main() -> None:
    args = sys.argv[1:]
    manifest = load_manifest()
    if "--self-test" in args:
        sys.exit(0 if self_test(manifest) else 2)
    if "--allow-scan" in args:
        for a in manifest["allow"]:
            print(f"allow: {a}")
        sys.exit(0)

    root = args[0] if args else "."
    tools = os.path.join(root, "tools")
    if not os.path.isdir(tools):
        sys.exit(f"no tools dir under {root!r} (run from the repo root)")

    bad = 0
    files = [os.path.join("tools", "pty-proof.py")] + sorted(
        os.path.join("tools", f)
        for f in os.listdir(tools)
        if f.endswith(".ts") and f != "pty-proof.py"
    )
    for rel in files:
        if not os.path.exists(rel):
            continue
        for line, text, hits in scan_file(rel, manifest, is_ts=rel.endswith(".ts")):
            if hits:
                bad += 1
                print(f"{rel}:{line}: {'; '.join(hits)}")
                print(f"    ask: {text[:110]!r}")
    if bad:
        print(f"PROOF-ASK HYGIENE: {bad} violation(s) — asks are needle-bait, fix the text")
        sys.exit(1)
    print("proof-ask-hygiene: 0 violations (asks needle-inert)")


if __name__ == "__main__":
    main()
