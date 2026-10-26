#!/usr/bin/env python3
"""ux-falsify TUI driver — the runtime half of the ux-falsify loop for TUIs.

Drives a TUI program in a fixed-geometry PTY, snapshots the settled cell grid
(pyte = terminal-state truth), renders it to PNG (visual layer), diffs two
captures cell-by-cell under declared masks, and self-tests the differ with
planted defects. Pairs live in design/ux/states/<state>.toml.

  falsify.py capture states/home.toml [--ref|--cand|--both] [--out DIR]
  falsify.py diff    home.toml ref.cells.json cand.cells.json
  falsify.py selftest ref.cells.json            # planted-defect calibration
  falsify.py render  cells.json out.png

Verdicts follow the ux-falsify skill: MATCH needs every unmasked cell equal
(char AND style); masks are declared in the manifest with reasons; anything
that could not be captured settles as UNVERIFIED, never MATCH.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import pty
import select
import signal
import subprocess
import sys
import time
from pathlib import Path

try:
    import tomllib
except ModuleNotFoundError:  # py<3.11
    tomllib = None
import pyte

DRIVER = "falsify.py/0.1"
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
    """'ctrl+x' / 'enter' / 'text:hello' / raw passthrough."""
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
    """One program instance in a fixed PTY, snapshot via pyte."""

    def __init__(self, cmd: list[str], cwd: str, cols: int, rows: int, env_extra: dict | None = None,
                 sig_masks: list | None = None):
        self.cols, self.rows = cols, rows
        self.sig_masks = sig_masks or []  # rects blanked in the stability signature
        self.alive = True
        pid, fd = pty.fork()
        if pid == 0:
            env = dict(os.environ, TERM="xterm-256color", COLORTERM="truecolor", LINES=str(rows), COLUMNS=str(cols))
            env.update(env_extra or {})
            os.chdir(cwd)
            try:
                os.execvp(cmd[0], cmd)
            except Exception:
                os._exit(127)
        self.pid, self.fd = pid, fd
        self.t0 = time.time()
        self.screen = pyte.Screen(cols, rows)
        self.stream = pyte.ByteStream(self.screen)
        self.byte_log = bytearray()

    def pump(self, seconds: float) -> None:
        deadline = time.time() + seconds
        while time.time() < deadline:
            r, _, _ = select.select([self.fd], [], [], 0.1)
            if not r:
                continue
            try:
                data = os.read(self.fd, 65536)
            except OSError:
                self.alive = False
                return
            if not data:
                self.alive = False
                return
            self.byte_log.extend(data[-200000:])
            self.stream.feed(data)

    def send(self, data: bytes) -> None:
        os.write(self.fd, data)

    def _sig(self) -> str:
        """Display with cursor + declared animated regions blanked — blinking
        cursors and typewriter cyclers are expected animation and must not
        block settle; spinners outside declared regions still do."""
        rows = [list(r) for r in self.screen.display]
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
        """Wait until warmup elapsed AND the screen stopped changing (and readiness shows).

        The warmup floor exists because a freshly-spawned blank screen is
        trivially "stable" — without it the snapshot races the first draw.
        Stability is judged on the cursor-insensitive signature.
        """
        deadline = time.time() + timeout
        last, last_change = self._sig(), time.time()
        while time.time() < deadline:
            self.pump(0.15)
            cur = self._sig()
            if cur != last:
                last, last_change = cur, time.time()
                continue
            warmed = (time.time() - self.t0) * 1000 >= warmup_ms
            stable = (time.time() - last_change) * 1000 >= stable_ms
            if warmed and stable:
                disp = self._display()
                if readiness is None or readiness in disp:
                    return True, "settled"
                if not self.alive:
                    return False, f"exited before readiness {readiness!r}"
        return (readiness is None or readiness in self._display()), (
            "timeout; readiness not shown" if readiness else "timeout")

    def _display(self) -> str:
        return "\n".join(self.screen.display)

    def snapshot(self) -> dict:
        """Cell grid → {text rows, style rows, deduped palette}."""
        styles: dict[tuple, int] = {}
        srows: list[list[int]] = []
        for y in range(self.rows):
            srow = []
            for x in range(self.cols):
                ch = self.screen.buffer[y][x]
                key = (ch.fg, ch.bg, bool(ch.bold), bool(ch.reverse), bool(ch.underscore))
                if key not in styles:
                    styles[key] = len(styles)
                srow.append(styles[key])
            srows.append(srow)
        return {
            "driver": DRIVER,
            "geometry": [self.cols, self.rows],
            "captured_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "text": list(self.screen.display),
            "styles": srows,
            "palette": [f"{k[0]}|{k[1]}|{'B' if k[2] else ''}{'R' if k[3] else ''}{'U' if k[4] else ''}"
                        for k in sorted(styles, key=styles.get)],
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
    env = app.get("env", {})
    return TUI(app["cmd"], app["cwd"], *manifest["environment"]["geometry"], env,
               sig_masks=[m["rect"] for m in app.get("sig_masks", {}).values()])


def drive(app_cfg: dict, t: TUI) -> tuple[bool, str]:
    """Run the app's drive steps, then settle. UNVERIFIED on failure."""
    for step in app_cfg.get("drive", []):
        if "send" in step:
            t.send(keybytes(step["send"]))
        t.pump(step.get("ms", 400) / 1000.0)
    ok, why = t.settle(readiness=app_cfg.get("readiness"),
                       stable_ms=app_cfg.get("stable_ms", 500),
                       timeout=app_cfg.get("timeout", 25.0),
                       warmup_ms=app_cfg.get("warmup_ms", 2500))
    return ok, why


# ---------------------------------------------------------------- render

def _color(spec: str, default: str) -> str:
    if not spec or spec == "default":
        return default
    if spec in NAMED:
        return NAMED[spec]
    return spec if spec.startswith("#") else f"#{spec[-6:]}"


def render_png(bundle: dict, out: Path, cell_w: int = 9, cell_h: int = 18) -> str:
    from PIL import Image, ImageDraw, ImageFont
    cols, rows = bundle["geometry"]
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 14)
    img = Image.new("RGB", (cols * cell_w, rows * cell_h), DEFAULT_BG)
    d = ImageDraw.Draw(img)
    for y, (text, srow) in enumerate(zip(bundle["text"], bundle["styles"])):
        for x, (char, sidx) in enumerate(zip(text, srow)):
            fg, bg, flags = bundle["palette"][sidx].split("|")
            fgc = _color(fg, DEFAULT_FG)
            bgc = _color(bg, DEFAULT_BG)
            if "R" in flags:
                fgc, bgc = bgc, fgc
            if bgc != DEFAULT_BG:
                d.rectangle([x * cell_w, y * cell_h, (x + 1) * cell_w - 1, (y + 1) * cell_h - 1], fill=bgc)
            if char.strip():
                d.text((x * cell_w + 1, y * cell_h + 1), char, font=font,
                       fill=fgc, stroke_width=1 if "B" in flags else 0)
    img.save(out)
    return str(out)


# ---------------------------------------------------------------- diff

def apply_masks(bundle: dict, masks: dict) -> tuple[set, dict]:
    """Masked (y,x) set + mask reasons (rect = [row0, col0, row1, col1] inclusive)."""
    masked: set = set()
    for name, m in (masks or {}).items():
        r0, c0, r1, c1 = m["rect"]
        reason = m.get("reason", "")
        for y in range(r0, min(r1 + 1, bundle["geometry"][1])):
            for x in range(c0, min(c1 + 1, bundle["geometry"][0])):
                masked.add((y, x))
        _ = reason  # reasons are echoed into findings by diff()
    return masked, masks or {}


def diff_cells(ref: dict, cand: dict, masks: dict | None = None) -> dict:
    if ref["geometry"] != cand["geometry"]:
        return {"verdict": "UNVERIFIED", "why": f"geometry differs {ref['geometry']} vs {cand['geometry']}"}
    masked, maskdefs = apply_masks(ref, masks)
    char_diffs, style_diffs = [], []
    for y in range(ref["geometry"][1]):
        for x in range(ref["geometry"][0]):
            if (y, x) in masked:
                continue
            rc, cc = ref["text"][y][x], cand["text"][y][x]
            rs, cs = ref["styles"][y][x], cand["styles"][y][x]
            if rc != cc:
                char_diffs.append((y, x, rc, cc))
            elif rs != cs:
                style_diffs.append((y, x, ref["palette"][rs], cand["palette"][cs]))
    def band(rowspans):
        out, cur = [], None
        for y, *_ in rowspans:
            if cur and y == cur[1] + 1:
                cur[1] = y
            else:
                cur = [y, y]
                out.append(cur)
        return out
    verdict = "MATCH" if not (char_diffs or style_diffs) else "MISMATCH"
    return {
        "verdict": verdict,
        "geometry": ref["geometry"],
        "masks": {k: {"rect": v["rect"], "reason": v.get("reason", "")} for k, v in maskdefs.items()},
        "char_diff_count": len(char_diffs),
        "style_diff_count": len(style_diffs),
        "char_bands": band(char_diffs),
        "samples": {
            "chars": [f"({y},{x}) ref={r!r} cand={c!r}" for y, x, r, c in char_diffs[:12]],
            "styles": [f"({y},{x}) ref={rs} cand={cs}" for y, x, rs, cs in style_diffs[:12]],
        },
    }


# ---------------------------------------------------------------- commands

def load_manifest(path: str) -> dict:
    if tomllib is None:
        sys.exit("python3.11+ required (tomllib)")
    return tomllib.loads(Path(path).read_text())


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
            bundle["meta"] = {"app": which, "state": state, "settle": why,
                              "verifiable": ok, "cmd": m[which]["cmd"], "cwd": m[which]["cwd"]}
            stem = f"{m[which]['app']}.{state}"
            (outdir / f"{stem}.cells.json").write_text(json.dumps(bundle))
            png = render_png(bundle, outdir / f"{stem}.png")
            summary[which] = {"ok": ok, "why": why, "cells": str(outdir / f"{stem}.cells.json"), "png": png}
        finally:
            t.kill()
    (outdir / "bundle.json").write_text(json.dumps(
        {"state_manifest": str(args.manifest), "state": state, "contract_rev": m["identity"]["contract_rev"],
         "captures": summary}, indent=2))
    print(json.dumps(summary, indent=2))


def do_diff(args) -> None:
    m = load_manifest(args.manifest)
    masks = m.get("evaluate", {}).get("masks", {})
    ref = json.loads(Path(args.ref).read_text())
    cand = json.loads(Path(args.cand).read_text())
    for b, who in ((ref, "reference"), (cand, "candidate")):
        if not b["meta"].get("verifiable", False):
            print(json.dumps({"verdict": "UNVERIFIED",
                              "why": f"{who} capture did not settle: {b['meta'].get('settle')}"}))
            return
    r = diff_cells(ref, cand, masks)
    r["reference"] = args.ref
    r["candidate"] = args.cand
    out = Path(args.ref).parent / f"findings.{m['identity']['state']}.json"
    out.write_text(json.dumps(r, indent=2))
    print(json.dumps(r, indent=2))
    print(f"findings → {out}", file=sys.stderr)


def do_selftest(args) -> None:
    """Planted-defect calibration: the differ MUST catch every mutation."""
    import random
    bundle = json.loads(Path(args.ref).read_text())
    rng = random.Random(20261027)
    plants = []
    b = json.loads(json.dumps(bundle))
    for _ in range(10):  # char swaps
        y = rng.randrange(bundle["geometry"][1]); x = rng.randrange(bundle["geometry"][0])
        if bundle["text"][y][x].strip():
            row = list(b["text"][y]); row[x] = "X"; b["text"][y] = "".join(row)
            plants.append(("char", y, x))
    for _ in range(10):  # style flips
        y = rng.randrange(bundle["geometry"][1]); x = rng.randrange(bundle["geometry"][0])
        b["styles"][y][x] = (b["styles"][y][x] + 1) % len(bundle["palette"])
        plants.append(("style", y, x))
    r = diff_cells(bundle, b, None)
    caught = r["char_diff_count"] + r["style_diff_count"]
    result = {"planted": len(plants), "detected": caught, "pass": caught >= len(plants),
              "verdict_after_plant": r["verdict"]}
    print(json.dumps(result, indent=2))
    if not result["pass"]:
        sys.exit(1)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("capture"); c.add_argument("manifest"); c.add_argument("--out")
    c.add_argument("--both", action="store_true"); c.add_argument("--ref", action="store_true")
    d = sub.add_parser("diff"); d.add_argument("manifest"); d.add_argument("ref"); d.add_argument("cand")
    s = sub.add_parser("selftest"); s.add_argument("ref")
    r = sub.add_parser("render"); r.add_argument("cells"); r.add_argument("out")
    a = ap.parse_args()
    if a.cmd == "render":
        do_render(a)
    else:
        {"capture": do_capture, "diff": do_diff, "selftest": do_selftest}[a.cmd](a)


def do_render(args):
    render_png(json.loads(Path(args.cells).read_text()), Path(args.out))


if __name__ == "__main__":
    main()
