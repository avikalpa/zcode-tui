#!/usr/bin/env python3
"""ux-falsify TUI driver — the runtime half of the ux-falsify loop for TUIs.

rev 0.2 — repaired after the Sol REVISE review (2026-10-27): real PTY winsize,
execve-carried env, per-cell encoding (wide-char safe), resolved-style diff
comparison, per-subject masks, strict settle (timeout/exit can never pass),
resolved-style planted-defect selftest with per-plant verification, hashed
evidence bundles retained outside git.

Comparison verdicts: CLEAN | MISMATCH. The STATE verdict (MATCH) is granted
only by the full loop contract (two clean passes from independent resets,
transitions, visual acceptance) — never by this tool alone. Anything not
captured settles as UNVERIFIED.

  falsify.py capture states/home.toml [--ref|--cand|--both] [--out DIR]
  falsify.py diff    states/home.toml ref.cells.json cand.cells.json
  falsify.py selftest states/home.toml ref.cells.json
  falsify.py render  cells.json out.png
"""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import pty
import select
import shutil
import signal
import struct
import sys
import termios
import time
from pathlib import Path

try:
    import tomllib
except ModuleNotFoundError:  # py<3.11
    tomllib = None
import pyte

DRIVER = "falsify.py/0.2"
EVIDENCE_ROOT = Path(os.environ.get("UX_FALSIFY_EVIDENCE", Path.home() / ".local/share/ux-falsify-evidence"))
KEYMAP = {
    "enter": b"\r", "escape": b"\x1b", "esc": b"\x1b", "tab": b"\t",
    "space": b" ", "backspace": b"\x7f",
    "up": b"\x1b[A", "down": b"\x1b[B", "right": b"\x1b[C", "left": b"\x1b[D",
    "home": b"\x1b[H", "end": b"\x1b[F", "pageup": b"\x1b[5~", "pagedown": b"\x1b[6~",
    "delete": b"\x1b[3~",
}
NAMED = {"black": "#000000", "red": "#cd3131", "green": "#0dbc79", "yellow": "#e5e510",
         "blue": "#2472c8", "magenta": "#bc3fbc", "cyan": "#11a8cd", "white": "#e5e5e5",
         "brightblack": "#666666", "brightred": "#f14c4c", "brightgreen": "#23d18b",
         "brightyellow": "#f5f543", "brightblue": "#3b8eea", "brightmagenta": "#d670d6",
         "brightcyan": "#29b8db", "brightwhite": "#ffffff"}
DEFAULT_FG, DEFAULT_BG = "#d4d4d4", "#141414"


def keybytes(spec: str) -> bytes:
    if spec.startswith("text:"):
        return spec[5:].encode()
    if spec.startswith("hex:"):
        return bytes.fromhex(spec[4:])
    if spec.startswith("ctrl+") and len(spec) == 6:
        return bytes([ord(spec[5].lower()) - 0x60])
    if spec in KEYMAP:
        return KEYMAP[spec]
    return spec.encode()


class TUI:
    """One program instance in a fixed-geometry PTY (winsize set for real)."""

    def __init__(self, cmd: list[str], cwd: str, cols: int, rows: int,
                 env_extra: dict | None = None, sig_masks: list | None = None):
        self.cols, self.rows = cols, rows
        self.sig_masks = sig_masks or []
        self.alive = True
        self.exit_reason = ""
        pid, fd = pty.fork()
        if pid == 0:
            env = dict(os.environ, TERM="xterm-256color", COLORTERM="truecolor",
                       LINES=str(rows), COLUMNS=str(cols))
            env.update(env_extra or {})
            os.chdir(cwd)
            try:
                os.execve(cmd[0], cmd, env)  # execve: the constructed env is used
            except Exception:
                os._exit(127)
        self.pid, self.fd = pid, fd
        self.t0 = time.time()
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
        self.screen = pyte.Screen(cols, rows)
        self.stream = pyte.ByteStream(self.screen)

    def pump(self, seconds: float) -> None:
        deadline = time.time() + seconds
        while time.time() < deadline:
            r, _, _ = select.select([self.fd], [], [], 0.1)
            if not r:
                continue
            try:
                data = os.read(self.fd, 65536)
            except OSError:
                self.alive, self.exit_reason = False, "pty read failed"
                return
            if not data:
                self.alive, self.exit_reason = False, "child closed pty"
                return
            self.stream.feed(data)

    def send(self, data: bytes) -> None:
        os.write(self.fd, data)

    def _cells(self) -> tuple[list[str], list[list[int]], list[str]]:
        """Per-cell text + deduped style indices + palette (resolved strings).

        Cells come straight from the pyte buffer so text and styles are
        aligned cell-for-cell even with wide characters.
        """
        styles: dict[tuple, int] = {}
        palette: list[str] = []
        text_rows: list[str] = []
        style_rows: list[list[int]] = []
        for y in range(self.rows):
            trow, srow = [], []
            for x in range(self.cols):
                ch = self.screen.buffer[y][x]
                key = (ch.fg, ch.bg, bool(ch.bold), bool(ch.reverse), bool(ch.underscore))
                if key not in styles:
                    styles[key] = len(palette)
                    palette.append(f"{key[0]}|{key[1]}|{'B' if key[2] else ''}{'R' if key[3] else ''}{'U' if key[4] else ''}")
                trow.append(ch.data or " ")
                srow.append(styles[key])
            text_rows.append("".join(trow))
            style_rows.append(srow)
        return text_rows, style_rows, palette

    def _sig(self) -> str:
        """Stability signature: cells + RESOLVED styles, with the cursor cell
        and declared animated regions blanked. Style-only animation (bold
        blink, reverse flicker) blocks settle just like text animation."""
        text, srows, palette = self._cells()
        rows = [list(r) for r in text]
        for y, srow in enumerate(srows):
            for x, s in enumerate(srow):
                rows[y][x] = f"{rows[y][x]}\x1f{palette[s]}"
        cx, cy = self.screen.cursor.x, self.screen.cursor.y
        if 0 <= cy < len(rows) and 0 <= cx < len(rows[cy]):
            rows[cy][cx] = "\x00"
        for r0, c0, r1, c1 in self.sig_masks:
            for y in range(r0, min(r1 + 1, self.rows)):
                for x in range(c0, min(c1 + 1, self.cols)):
                    rows[y][x] = "\x00"
        return "\n".join("".join(r) for r in rows)

    def settle(self, readiness: str | None = None, stable_ms: int = 500,
               timeout: float = 20.0, warmup_ms: int = 2500) -> tuple[bool, str]:
        """True only when: warmup elapsed, signature stable for stable_ms,
        readiness shown, child still alive. Timeout/exit are ALWAYS False."""
        deadline = time.time() + timeout
        last, last_change = self._sig(), time.time()
        while time.time() < deadline:
            self.pump(0.15)
            if not self.alive:
                return False, f"exited before settle ({self.exit_reason})"
            cur = self._sig()
            if cur != last:
                last, last_change = cur, time.time()
                continue
            warmed = (time.time() - self.t0) * 1000 >= warmup_ms
            stable = (time.time() - last_change) * 1000 >= stable_ms
            if warmed and stable:
                disp = "\n".join(self.screen.display)
                if readiness is None or readiness in disp:
                    return True, "settled"
        return False, "timeout before stable+readiness"

    def snapshot(self) -> dict:
        text, srows, palette = self._cells()
        return {
            "driver": DRIVER,
            "geometry": [self.cols, self.rows],
            "captured_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "text": text,
            "styles": srows,
            "palette": palette,
        }

    def kill(self) -> None:
        try:
            os.kill(self.pid, signal.SIGKILL)
            os.waitpid(self.pid, 0)
        except (ProcessLookupError, ChildProcessError):
            pass
        try:
            os.close(self.fd)
        except OSError:
            pass


def spawn_from(manifest: dict, which: str) -> TUI:
    app = manifest[which]
    cmd = list(app["cmd"])
    if not os.path.isabs(cmd[0]):  # execve does no PATH lookup — resolve
        import shutil
        resolved = shutil.which(cmd[0])
        if not resolved:
            raise SystemExit(f"{which}: command not found: {cmd[0]}")
        cmd[0] = resolved
    return TUI(cmd, app["cwd"], *manifest["environment"]["geometry"],
               env_extra=app.get("env", {}),
               sig_masks=[m["rect"] for m in app.get("sig_masks", {}).values()])


def drive(app_cfg: dict, t: TUI) -> tuple[bool, str]:
    for step in app_cfg.get("drive", []):
        if "send" in step:
            t.send(keybytes(step["send"]))
        t.pump(step.get("ms", 400) / 1000.0)
        if not t.alive:
            return False, f"exited during drive ({t.exit_reason})"
    return t.settle(readiness=app_cfg.get("readiness"),
                    stable_ms=app_cfg.get("stable_ms", 500),
                    timeout=app_cfg.get("timeout", 25.0),
                    warmup_ms=app_cfg.get("warmup_ms", 2500))


# ---------------------------------------------------------------- masks

def mask_rects(masks: dict, which: str) -> tuple[list, dict]:
    """Per-subject masks: masks['both'|which] apply to that subject only;
    the other subject's rects never hide its findings."""
    out = []
    defs = {}
    for scope in ("both", which):
        for name, m in (masks.get(scope, {}) or {}).items():
            out.append(m["rect"])
            defs[f"{scope}.{name}"] = {"rect": m["rect"], "reason": m.get("reason", "")}
    return out, defs


def is_masked(masked_rects: list, y: int, x: int) -> bool:
    for r0, c0, r1, c1 in masked_rects:
        if r0 <= y <= r1 and c0 <= x <= c1:
            return True
    return False


# ---------------------------------------------------------------- diff

def diff_cells(ref: dict, cand: dict, masks: dict | None = None) -> dict:
    if ref["geometry"] != cand["geometry"]:
        return {"verdict": "UNVERIFIED", "why": f"geometry differs {ref['geometry']} vs {cand['geometry']}"}
    for b, who in ((ref, "reference"), (cand, "candidate")):
        if not b.get("meta", {}).get("verifiable", False):
            return {"verdict": "UNVERIFIED", "why": f"{who} capture did not settle: {b['meta'].get('settle')}"}
    masks = masks or {}
    ref_masks, ref_defs = mask_rects(masks, "reference")
    cand_masks, cand_defs = mask_rects(masks, "candidate")
    cols, rows_ = ref["geometry"]
    char_diffs, style_diffs = [], []
    for y in range(rows_):
        for x in range(cols):
            rc, cc = ref["text"][y][x], cand["text"][y][x]
            rs = ref["palette"][ref["styles"][y][x]]  # RESOLVED styles, never local indices
            cs = cand["palette"][cand["styles"][y][x]]
            r_masked = is_masked(ref_masks, y, x)
            c_masked = is_masked(cand_masks, y, x)
            if r_masked and c_masked:
                continue
            if rc != cc and not (r_masked or c_masked):
                char_diffs.append((y, x, rc, cc))
            elif rs != cs and not (r_masked or c_masked):
                style_diffs.append((y, x, rs, cs))
    def band(cells):
        out, cur = [], None
        for y, *_ in cells:
            if cur and y == cur[1] + 1:
                cur[1] = y
            else:
                cur = [y, y]
                out.append(cur)
        return out
    return {
        "verdict": "CLEAN" if not (char_diffs or style_diffs) else "MISMATCH",
        "state_verdict": "UNVERIFIED",  # MATCH requires the full loop contract, not one comparison
        "geometry": [cols, rows_],
        "masks": {**ref_defs, **cand_defs},
        "char_diff_count": len(char_diffs),
        "style_diff_count": len(style_diffs),
        "char_bands": band(char_diffs),
        "samples": {
            "chars": [f"({y},{x}) ref={r!r} cand={c!r}" for y, x, r, c in char_diffs[:12]],
            "styles": [f"({y},{x}) ref={rs} cand={cs}" for y, x, rs, cs in style_diffs[:12]],
        },
    }


# ---------------------------------------------------------------- render

def _color(spec: str, default: str) -> str:
    if not spec or spec == "default":
        return default
    if spec in NAMED:
        return NAMED[spec]
    return spec if spec.startswith("#") else f"#{spec[-6:]}"


def render_png(bundle: dict, out: Path, cell_w: int = 9, cell_h: int = 18) -> str:
    from PIL import Image, ImageDraw, ImageFont
    cols, rows_ = bundle["geometry"]
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 14)
    img = Image.new("RGB", (cols * cell_w, rows_ * cell_h), DEFAULT_BG)
    d = ImageDraw.Draw(img)
    for y, (text, srow) in enumerate(zip(bundle["text"], bundle["styles"])):
        for x, (char, sidx) in enumerate(zip(text, srow)):
            parts = bundle["palette"][sidx].split("|")
            fg, bg = parts[0], parts[1]
            flags = parts[2] if len(parts) > 2 else ""
            fgc, bgc = _color(fg, DEFAULT_FG), _color(bg, DEFAULT_BG)
            if "R" in flags:
                fgc, bgc = bgc, fgc
            if bgc != DEFAULT_BG:
                d.rectangle([x * cell_w, y * cell_h, (x + 1) * cell_w - 1, (y + 1) * cell_h - 1], fill=bgc)
            if char.strip():
                d.text((x * cell_w + 1, y * cell_h + 1), char, font=font, fill=fgc,
                       stroke_width=1 if "B" in flags else 0)
    img.save(out)
    return str(out)


# ---------------------------------------------------------------- commands

def load_manifest(path: str) -> dict:
    if tomllib is None:
        sys.exit("python3.11+ required (tomllib)")
    return tomllib.loads(Path(path).read_text())


def retain(bundle_path: Path) -> str:
    """Hash the artifact and retain a copy in the private evidence store
    (gitignored runs are regenerable; retained hashed bundles are not)."""
    digest = hashlib.sha256(bundle_path.read_bytes()).hexdigest()
    dest = EVIDENCE_ROOT / time.strftime("%Y%m%d-%H%M%S") / bundle_path.name
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(bundle_path, dest)
    return digest


def do_capture(args) -> None:
    m = load_manifest(args.manifest)
    state = m["identity"]["state"]
    outdir = Path(args.out or Path(args.manifest).parent.parent / "runs" / time.strftime("%Y%m%d-%H%M%S"))
    outdir.mkdir(parents=True, exist_ok=True)
    targets = ["reference", "candidate"] if args.both else (["reference"] if args.ref else ["candidate"])
    summary = {}
    for which in targets:
        t = spawn_from(m, which)
        try:
            t.pump(0.5)
            ok, why = drive(m[which], t)
            bundle = t.snapshot()
            bundle["meta"] = {"app": which, "app_name": m[which]["app"], "state": state, "settle": why,
                              "verifiable": ok, "cmd": m[which]["cmd"], "cwd": m[which]["cwd"],
                              "env": m[which].get("env", {})}
            stem = f"{m[which]['app']}.{state}"
            cells_path = outdir / f"{stem}.cells.json"
            cells_path.write_text(json.dumps(bundle))
            png = render_png(bundle, outdir / f"{stem}.png")
            digest = retain(cells_path)
            summary[which] = {"ok": ok, "why": why, "cells": str(cells_path), "png": png,
                              "cells_sha256": digest, "evidence": str(EVIDENCE_ROOT)}
        finally:
            t.kill()
    (outdir / "bundle.json").write_text(json.dumps(
        {"state_manifest": str(args.manifest), "contract_rev": m["identity"]["contract_rev"],
         "state": state, "captures": summary}, indent=2))
    print(json.dumps(summary, indent=2))


def do_diff(args) -> None:
    m = load_manifest(args.manifest)
    ref = json.loads(Path(args.ref).read_text())
    cand = json.loads(Path(args.cand).read_text())
    r = diff_cells(ref, cand, m.get("evaluate", {}).get("masks", {}))
    r["reference"] = args.ref
    r["candidate"] = args.cand
    r["reference_sha256"] = hashlib.sha256(Path(args.ref).read_bytes()).hexdigest()
    r["candidate_sha256"] = hashlib.sha256(Path(args.cand).read_bytes()).hexdigest()
    out = Path(args.ref).parent / f"comparison.{m['identity']['state']}.json"
    out.write_text(json.dumps(r, indent=2))
    print(json.dumps(r, indent=2))
    print(f"comparison → {out}", file=sys.stderr)


def do_selftest(args) -> None:
    """Calibration: every planted defect MUST surface in the comparison and
    the verdict must flip to MISMATCH. Plants mutate visible chars and
    RESOLVED styles (new palette entry with an altered color), skip masked
    cells, and never rely on aggregate counts of vacuous palette mutations.
    """
    m = load_manifest(args.manifest)
    masks = m.get("evaluate", {}).get("masks", {})
    bundle = json.loads(Path(args.ref).read_text())
    ref_masks, _ = mask_rects(masks, "reference")
    cand_masks, _ = mask_rects(masks, "candidate")
    import random
    rng = random.Random(20261027)
    cols, rows_ = bundle["geometry"]
    plants, cand = [], json.loads(json.dumps(bundle))
    planted_at: set = set()
    # char plants on visible cells unmasked on BOTH subjects — a cell masked
    # on either side is unjudgeable by design and would swallow the plant
    tries = 0
    while len(plants) < 6 and tries < 8000:
        y, x = rng.randrange(rows_), rng.randrange(cols)
        tries += 1
        if (y, x) in planted_at:
            continue
        if (bundle["text"][y][x].strip() and not is_masked(ref_masks, y, x)
                and not is_masked(cand_masks, y, x)):
            row = list(cand["text"][y])
            row[x] = "█"
            cand["text"][y] = "".join(row)
            plants.append(("char", y, x))
            planted_at.add((y, x))
    # resolved-style plants: append a NEW palette entry with a changed color
    made = 0
    for y in range(rows_ - 1, -1, -1):
        if made >= 6:
            break
        for x in range(0, cols, 9):
            if made >= 6:
                break
            if not is_masked(cand_masks, y, x) and not is_masked(ref_masks, y, x):
                cand["palette"].append("brightmagenta|#5a0a0a|B")
                cand["styles"][y][x] = len(cand["palette"]) - 1
                plants.append(("style", y, x))
                made += 1
    r = diff_cells(bundle, cand, masks)
    result = {
        "planted": len(plants),
        "char_diff_count": r["char_diff_count"],
        "style_diff_count": r["style_diff_count"],
        "verdict_after_plant": r["verdict"],
        "pass": r["verdict"] == "MISMATCH"
                and r["char_diff_count"] >= sum(1 for k, _, _ in plants if k == "char")
                and r["style_diff_count"] >= sum(1 for k, _, _ in plants if k == "style"),
    }
    print(json.dumps(result, indent=2))
    if not result["pass"]:
        sys.exit(1)


def do_render(args):
    render_png(json.loads(Path(args.cells).read_text()), Path(args.out))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("capture"); c.add_argument("manifest"); c.add_argument("--out")
    c.add_argument("--both", action="store_true"); c.add_argument("--ref", action="store_true")
    d = sub.add_parser("diff"); d.add_argument("manifest"); d.add_argument("ref"); d.add_argument("cand")
    s = sub.add_parser("selftest"); s.add_argument("manifest"); s.add_argument("ref")
    r = sub.add_parser("render"); r.add_argument("cells"); r.add_argument("out")
    a = ap.parse_args()
    if a.cmd == "render":
        do_render(a)
    else:
        {"capture": do_capture, "diff": do_diff, "selftest": do_selftest}[a.cmd](a)


if __name__ == "__main__":
    main()
