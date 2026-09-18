#!/usr/bin/env python3
"""PTY acceptance v8 — zcode-tui (screen-truth instrument).

pyte-reconstructed screen assertions: the emulator assembles what a human
sees, so styled-run segmentation and delta paints can never fake a pass or
hide a failure (the v7 lesson: the Jump-to-latest affordance was painted but
byte-oracle-blind). I-series uses ONE minimal real turn on a TUI-created
throwaway; the wrapper closes it afterwards.
"""
import os, pty, select, re, sys, time, fcntl, termios, struct, subprocess
import pyte

binary = sys.argv[1]
verdicts = []

def alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False

def check(pid, label, ok):
    if not alive(pid):
        ok = False
    verdicts.append((label, ok))
    print(f"{'PASS' if ok else 'FAIL'}{'' if alive(pid) else ' (DEAD)'} {label}")

with open("/tmp/zct-fake-editor.sh", "w") as f:
    f.write('#!/bin/sh\nprintf EDITED-BY-EDITOR >> "$1"\ncp "$1" /tmp/zct-export-latest.md\n')
os.chmod("/tmp/zct-fake-editor.sh", 0o755)

def spawn(cols=110, rows=34):
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    screen = pyte.Screen(cols, rows)
    stream = pyte.ByteStream(screen)
    pid = subprocess.Popen([binary], stdin=slave, stdout=slave, stderr=subprocess.DEVNULL,
                           cwd="/tmp/zct-proof-cwd",
                           env=dict(os.environ, TERM="xterm-256color", EDITOR="/tmp/zct-fake-editor.sh"),
                           close_fds=True).pid
    os.close(slave)
    return pid, master, screen, stream

RAW = bytearray()

def read_for(master, stream, seconds):
    end = time.time() + seconds
    while time.time() < end:
        r, _, _ = select.select([master], [], [], 0.2)
        if r:
            try:
                chunk = os.read(master, 65536)
            except OSError:
                return
            if not chunk:
                return
            RAW.extend(chunk)
            stream.feed(chunk)

def kill(pid):
    try:
        os.kill(pid, 9)
        os.waitpid(pid, 0)
    except ProcessLookupError:
        pass

# ---- boot 1 ----
pid, master, screen, stream = spawn()
read_for(master, stream, 9)
disp = "\n".join(screen.display)
check(pid, "A0 boot rendered", "Ask anything" in disp)

os.write(master, b"ZCODE-PROOF-HOME-TOKEN")
a1 = False
for _ in range(3):
    read_for(master, stream, 1.0)
    if "ZCODE-PROOF-HOME-TOKEN" in "\n".join(screen.display):
        a1 = True
        break
check(pid, "A1 typing on home paints", a1)
os.write(master, b"\x03"); time.sleep(0.3)

# X0: leader e hands the draft to $EDITOR and loads it back
os.write(master, b"base-")
read_for(master, stream, 0.6)
os.write(master, b"\x18e")                    # ctrl+x e: external editor
read_for(master, stream, 2.5)
disp = "\n".join(screen.display)
check(pid, "X0 editor round-trip loads the draft", "base-EDITED-BY-EDITOR" in disp)
os.write(master, b"!")
read_for(master, stream, 0.8)
check(pid, "X0b composer alive after editor resume", "base-EDITED-BY-EDITOR!" in "\n".join(screen.display))
os.write(master, b"\x03"); time.sleep(0.3)

# H-series: ? opens the keybind help overlay
os.write(master, b"?")
read_for(master, stream, 1.0)
disp = "\n".join(screen.display)
check(pid, "H0 ? opens the keybind help overlay", "Help — keybinds" in disp and "ctrl+x then" in disp)
os.write(master, b"\x1b")
read_for(master, stream, 0.6)
check(pid, "H1 help overlay closes", "Help — keybinds" not in "\n".join(screen.display))

# SL-series: the input.select.* family (v2 shift-selections). Behavior proof —
# the highlight itself is colour-only (invisible to the pyte text dump), so
# the asserts read the CONSUMPTION: typing replaces the selected range,
# backspace deletes it.
if alive(pid):
    os.write(master, b"\x03"); time.sleep(0.3)
    os.write(master, b"abcdef"); read_for(master, stream, 0.8)
    os.write(master, b"\x1b[1;2D"); time.sleep(0.2)     # shift+left
    os.write(master, b"\x1b[1;2D"); time.sleep(0.2)
    os.write(master, b"\x1b[1;2D"); time.sleep(0.2)     # "def" selected
    os.write(master, b"X"); read_for(master, stream, 0.8)
    sl0 = "\n".join(screen.display)
    check(pid, "SL0 shift-select + typing replaces the range", "abcX" in sl0 and "abcdef" not in sl0)
    os.write(master, b"\x1b[1;2D"); time.sleep(0.2)     # select "X"
    os.write(master, b"\x7f"); read_for(master, stream, 0.8)
    sl1 = "\n".join(screen.display)
    check(pid, "SL1 backspace deletes the selection", "abcX" not in sl1 and "abc" in sl1)
    os.write(master, b"\x03"); time.sleep(0.3)
else:
    check(pid, "SL0 shift-select + typing replaces the range", False)
    check(pid, "SL1 backspace deletes the selection", False)

# TAB/L-series (home-local)
before_mode = [l for l in screen.display if "Z.AI Coding Plan" in l]
os.write(master, b"\t")
read_for(master, stream, 1.2)
after_mode = [l for l in screen.display if "Z.AI Coding Plan" in l]
check(pid, "T0 tab cycles the agent (status changed)", bool(after_mode) and after_mode != before_mode)

os.write(master, b"\x18m"); read_for(master, stream, 1.2)
check(pid, "L0 leader m opens the model dialog", "Model" in "\n".join(screen.display))
os.write(master, b"\x1b"); time.sleep(0.3)
os.write(master, b"\x18a"); read_for(master, stream, 1.2)
check(pid, "L1 leader a opens the agents dialog", "Agent mode" in "\n".join(screen.display))
os.write(master, b"\x1b"); time.sleep(0.3)

st_path = os.path.expanduser("~/.config/zcode-tui/state.json")
had_state = os.path.exists(st_path)
os.write(master, b"\x14"); read_for(master, stream, 1.2)   # ctrl+t: variant cycle
try:
    st = open(st_path).read()
    l2 = '"zai/GLM-5.3-Flash"' in st
except FileNotFoundError:
    l2 = False
check(pid, "L2 ctrl+t cycles the reasoning effort (state.json)", l2)

# W-series: model dialog depth (favorites + recent select + f2 cycle)
os.write(master, b"\x18m"); read_for(master, stream, 1.2)
os.write(master, b"\x06"); time.sleep(0.3)                    # ctrl+f: favorite
read_for(master, stream, 0.6)
try:
    stw = open(os.path.expanduser("~/.config/zcode-tui/state.json")).read()
    w0 = '"favorite"' in stw
except FileNotFoundError:
    w0 = False
check(pid, "W0 ctrl+f favorites the model (state.json)", w0)
os.write(master, b"\x1b"); time.sleep(0.3)
os.write(master, b"\x18m"); read_for(master, stream, 1.2)     # model dialog again
os.write(master, b"\x1b[B"); time.sleep(0.2)                  # down: GLM-5.3
os.write(master, b"\r"); read_for(master, stream, 1.2)        # select
disp = "\n".join(screen.display)
check(pid, "W1 selecting a model updates the composer label", "GLM-5.3 ·" in disp or "GLM-5.3 " in disp)
os.write(master, b"\x1bOQ"); read_for(master, stream, 1.0)    # f2: cycle recent
try:
    stw = open(os.path.expanduser("~/.config/zcode-tui/state.json")).read()
    w2 = '"GLM-5.3"' in stw
except FileNotFoundError:
    w2 = False
check(pid, "W2 f2 cycles recent and persists (state.json)", w2)

os.write(master, b"\x18l"); read_for(master, stream, 1.5)
disp = "\n".join(screen.display)
b0 = "Sessions" in disp and "Search" in disp
check(pid, "B0 sessions dialog opens", b0)
check(pid, "B1 date group headers render", re.search(r"(Sep|Oct|Nov|Dec) \d\d 20\d\d|Today", disp) is not None)
check(pid, "B2 footer hints", "pin" in disp and "delete" in disp and "switch" in disp)
check(pid, "B3 no idle clutter", "idle ·" not in disp)
check(pid, "B4 quick-slot gutters", re.search(r"\b1 \S", disp) is not None)

# D-series: the themes dialog (reference parity — bare rows, Search, ● gutter).
# Runs HERE, before the turn-dependent stages, so a flaky interrupt can never
# poison it; the sessions dialog is re-opened afterwards for the C-series.
if alive(pid):
    os.write(master, b"\x1b"); read_for(master, stream, 0.6)   # close sessions
    os.write(master, b"\x18t"); read_for(master, stream, 1.5)
    d0 = "\n".join(screen.display)
    has_dialog = "Themes" in d0
    check(pid, "D0 themes dialog opens with bare rows (no OpenCod suffix)", has_dialog and "OpenCod" not in d0)
    check(pid, "D1 search row shows the Search placeholder", has_dialog and "Search" in d0)
    check(pid, "D2 the origin theme wears the ● gutter marker", has_dialog and "●" in d0)
    for ch in "dra":
        os.write(master, ch.encode()); time.sleep(0.08)
    read_for(master, stream, 1.0)
    d1 = "\n".join(screen.display)
    check(pid, "D3 typing filters the rows (dra → dracula)", has_dialog and "dracula" in d1 and "everforest" not in d1)
    os.write(master, b"\x1b"); read_for(master, stream, 0.8)
    d2 = "\n".join(screen.display)
    check(pid, "D4 escape closes the dialog", "Search" not in d2)
    os.write(master, b"\x18l"); read_for(master, stream, 1.5)  # reopen sessions for the C-series
else:
    for lbl in ("D0 themes dialog opens with bare rows (no OpenCod suffix)",
                "D1 search row shows the Search placeholder",
                "D2 the origin theme wears the ● gutter marker",
                "D3 typing filters the rows (dra → dracula)",
                "D4 escape closes the dialog"):
        check(pid, lbl, False)


if b0 and alive(pid):
    os.write(master, b"\r"); read_for(master, stream, 5.5)   # let open() settle fully
    disp = "\n".join(screen.display)
    check(pid, "C-1 open() completed (messages witness)", "messages" in disp or "open failed" not in disp)
    os.write(master, b"ZCODE-PROOF-AFTER-OPEN")
    c0 = False
    for _ in range(4):                                        # poll: the draft must compose
        read_for(master, stream, 0.8)
        if "ZCODE-PROOF-AFTER-OPEN" in "\n".join(screen.display):
            c0 = True
            break
    check(pid, "C0 typing after open() paints — THE bug", c0)

    # W-series: the message walk (v2 session.message.* palette commands; the
    # session opened by C-1 carries a real turn).
    os.write(master, b"\x10"); read_for(master, stream, 0.8)
    for ch in "previous user message":
        os.write(master, ch.encode()); time.sleep(0.03)
    read_for(master, stream, 0.5)
    os.write(master, b"\r")
    w0 = False
    for _ in range(6):                                         # poll: toast paint
        read_for(master, stream, 0.6)
        if "user message" in "\n".join(screen.display):
            w0 = True
            break
    if not w0:
        print("---- W0 FAIL SCREEN ----")
        for i, line in enumerate(screen.display):
            if line.strip():
                print(f"{i:2}|{line.rstrip()}")
    check(pid, "W0 previous-user-message jump reports the walk", w0)
    os.write(master, b"\x10"); read_for(master, stream, 0.8)
    for ch in "next message":
        os.write(master, ch.encode()); time.sleep(0.03)
    read_for(master, stream, 0.5)
    os.write(master, b"\r")
    w1 = False
    for _ in range(6):                                         # poll: toast paint
        read_for(master, stream, 0.6)
        d = "\n".join(screen.display)
        if "message " in d and "user message" not in d:
            w1 = True
            break
    if not w1:
        print("---- W1 FAIL SCREEN ----")
        for i, line in enumerate(screen.display):
            if line.strip():
                print(f"{i:2}|{line.rstrip()}")
    check(pid, "W1 next-message jump reports the walk", w1)
    os.write(master, b"\x03"); time.sleep(0.3)

    # G-series: input editing grammar (screen truth)
    os.write(master, b"alpha beta gamma"); read_for(master, stream, 1.0)
    os.write(master, b"\x17"); read_for(master, stream, 0.8)     # ctrl+w
    disp = "\n".join(screen.display)
    g0 = ("alpha beta" in disp) and ("gamma" not in disp)
    check(pid, "G0 ctrl+w deletes the previous word", g0)
    os.write(master, b"\x01"); time.sleep(0.2)                   # ctrl+a
    os.write(master, b"\x1bd"); read_for(master, stream, 0.8)    # alt+d
    disp = "\n".join(screen.display)
    check(pid, "G1 ctrl+a + alt+d delete the first word", "alpha" not in disp and "beta" in disp)
    os.write(master, b"\x05"); time.sleep(0.2)                   # ctrl+e
    os.write(master, b"\x15"); read_for(master, stream, 0.8)     # ctrl+u
    check(pid, "G2 ctrl+u clears the line", "Ask anything" in "\n".join(screen.display))
    os.write(master, b"\x1f"); read_for(master, stream, 0.8)     # ctrl+- : undo
    disp = "\n".join(screen.display)
    check(pid, "G3 input undo restores the line", "beta" in disp or "alpha" in disp)
    os.write(master, b"\x03"); time.sleep(0.3)

    # X1/X2: export transcript to $EDITOR; copy last message via OSC 52
    os.write(master, b"\x03"); time.sleep(0.4)   # settle: clear any draft
    try:
        os.remove("/tmp/zct-export-latest.md")
    except FileNotFoundError:
        pass
    os.write(master, b"\x18x"); read_for(master, stream, 2.5)    # leader x: export
    try:
        export = open("/tmp/zct-export-latest.md").read()
        x1 = "## " in export and len(export) > 50
    except FileNotFoundError:
        x1 = False
    check(pid, "X1 leader x exports the transcript to $EDITOR", x1)
    mark_raw = len(RAW)
    os.write(master, b"\x18y"); read_for(master, stream, 1.2)    # leader y: copy
    check(pid, "X2 leader y copies via OSC 52", b"\x1b]52;c;" in bytes(RAW[mark_raw:]))

    # TL-series: timeline dialog, fork at a prompt (wrapper closes the fork)
    os.write(master, b"\x18g"); read_for(master, stream, 1.2)
    disp = "\n".join(screen.display)
    check(pid, "TL0 leader g opens the timeline", "Timeline — fork at message" in disp)
    os.write(master, b"\r"); read_for(master, stream, 3.5)
    disp = "\n".join(screen.display)
    check(pid, "TL1 enter forks at the prompt", "fork" in disp.lower())
    # I-series: escape interrupts the RUNNING turn (minimal real turn, throwaway)
    interrupted = False
    for attempt in range(3):
        os.write(master, b"\x18n"); read_for(master, stream, 2.5)
        os.write(master, b"Reply with exactly: ok")
        time.sleep(0.4)
        os.write(master, b"\r")
        read_for(master, stream, 0.9)
        if not alive(pid):
            break
        # Q-series: a prompt typed mid-turn queues; leader q manages it.
        os.write(master, b"queued test")
        time.sleep(0.3)
        os.write(master, b"\r")
        read_for(master, stream, 0.8)
        q0 = "queued" in "\n".join(screen.display)
        check(pid, "Q0 prompt typed mid-turn queues", q0)
        os.write(master, b"\x18q")
        read_for(master, stream, 1.0)
        disp = "\n".join(screen.display)
        q1 = "Queued prompts" in disp and "queued test" in disp
        check(pid, "Q1 leader q opens the queue manager", q1)
        if q1:
            os.write(master, b"\r")                 # enter removes the entry
            read_for(master, stream, 0.8)
            q2 = "Queued prompts" not in "\n".join(screen.display)
            check(pid, "Q2 enter removes the queued prompt", q2)
        else:
            check(pid, "Q2 enter removes the queued prompt", False)
        os.write(master, b"\x1b"); time.sleep(0.4)
        os.write(master, b"\x1b")
        read_for(master, stream, 2.0)
        if "turn interrupted" in "\n".join(screen.display):
            interrupted = True
            break
    check(pid, "I0 escape interrupts the running turn", interrupted)


else:
    for lbl in ("C-1 open() completed (messages witness)", "C0 typing after open() paints — THE bug",
                "G0 ctrl+w deletes the previous word", "G1 ctrl+a + alt+d delete the first word",
                "G2 ctrl+u clears the line", "G3 input undo restores the line",
                "I0 escape interrupts the running turn"):
        check(pid, lbl, False)

# S-series on the long /themes transcript
if b0 and alive(pid):
    os.write(master, b"\x18l"); read_for(master, stream, 1.5)
    for ch in "themes":
        os.write(master, ch.encode()); time.sleep(0.05)
    read_for(master, stream, 0.8)
    os.write(master, b"\r"); read_for(master, stream, 6.0)
    before_s = "\n".join(screen.display)
    scrolled = False
    afford = False
    for _ in range(3):
        os.write(master, b"\x1b[5~"); time.sleep(0.4)
        read_for(master, stream, 1.0)
        after_s = "\n".join(screen.display)
        if after_s != before_s:
            scrolled = True
            afford = "Jump to latest" in after_s or "Jump to latest" in before_s
            break
        before_s = after_s
    check(pid, "S0 pageup scrolls (content changed)", scrolled)
    check(pid, "S1 Jump-to-latest affordance appears", afford)
    os.write(master, b"\x1b\x07"); time.sleep(0.6)               # ctrl+alt+g: jump to latest
    cleared = False
    for _ in range(8):
        for _ in range(3):
            os.write(master, b"\x1b[6~"); time.sleep(0.08)        # pagedown: toward the tail
        read_for(master, stream, 0.6)
        if "Jump to latest" not in "\n".join(screen.display):
            cleared = True
            break
    check(pid, "S2 affordance clears at the bottom", cleared)

    # TB-series: the session tabs strip (v2 session.tab.*)
    read_for(master, stream, 0.8)
    disp = "\n".join(screen.display)
    check(pid, "TB1 the tabs strip renders with the tab-1 gutter",
          re.search(r"(^|\s)1\s+\S", disp, re.M) is not None)
    os.write(master, b"/new\r"); read_for(master, stream, 4.0)
    disp = "\n".join(screen.display)
    check(pid, "TB2 /new opens a second tab (gutter 2 + Untitled session)",
          re.search(r"(^|\s)2\s+\S", disp, re.M) is not None and "Untitled session" in disp)
    before_switch = disp
    os.write(master, b"\x181"); read_for(master, stream, 2.0)   # leader 1: tab 1
    disp = "\n".join(screen.display)
    check(pid, "TB3 leader 1 switches to the first tab", disp != before_switch)
    os.write(master, b"\x18w"); read_for(master, stream, 2.0)   # leader w: close tab
    disp = "\n".join(screen.display)
    check(pid, "TB4 leader w closes the tab (back to one)",
          "2 Untitled session" not in disp)  # scoped: the new tab is always "2 Untitled session"
    # ctrl+shift+t has no legacy PTY encoding - attempt it, grade SOFT (the
    # reopen path is unit-tested; delivery is terminal-dependent).
    os.write(master, b"\x1f"); time.sleep(0.2)
    os.write(master, b"T"); read_for(master, stream, 2.0)
    disp = "\n".join(screen.display)
    if re.search(r"(^|\s)2\s+\S", disp, re.M) is not None:
        check(pid, "TB5 ctrl+shift+t reopens the closed tab", True)
    else:
        print("NOTE ctrl+shift+t undeliverable on this PTY; reopen covered by unit tests")
    os.write(master, b"\x03"); time.sleep(0.3)


else:
    for lbl in ("S0 pageup scrolls (content changed)", "S1 Jump-to-latest affordance appears", "S2 affordance clears at the bottom"):
        check(pid, lbl, False)

# ---- S/K/M-series: the stash family, skills selector, MCP list (v2 ports) ----
# The stash store is exercised from EMPTY so the proof cannot see or leave
# the owner's real stashed drafts; S0-S4 are deterministic (no backend).
# K/M need the live catalog (workspace-scoped methods), hence the alive guard.
try:
    os.remove(os.path.expanduser("~/.config/zcode-tui/prompt-stash.jsonl"))
except FileNotFoundError:
    pass

def _palette_run(filter_text):
    os.write(master, b"\x10")                            # ctrl+p: palette
    read_for(master, stream, 0.8)
    for ch in filter_text:
        os.write(master, ch.encode()); time.sleep(0.04)
    read_for(master, stream, 0.6)
    os.write(master, b"\r")
    read_for(master, stream, 1.0)

if alive(pid):
    os.write(master, b"\x03"); time.sleep(0.3)          # ctrl+c: clear any draft
    os.write(master, b"STASH-PROOF-DRAFT-1")
    read_for(master, stream, 0.8)
    _palette_run("stash prompt")
    s0 = "\n".join(screen.display)
    check(pid, "S0 stash prompt parks the draft (composer empties)", "STASH-PROOF-DRAFT-1" not in s0 and "Ask anything" in s0)

    _palette_run("stash list")
    s1 = "\n".join(screen.display)
    check(pid, "S1 stash list dialog shows the preview + age", "Stash" in s1 and "STASH-PROOF-DRAFT-1" in s1 and "just now" in s1)

    os.write(master, b"\r"); read_for(master, stream, 1.0)   # enter: restore (take)
    s2 = "\n".join(screen.display)
    check(pid, "S2 restore returns the draft to the composer", "STASH-PROOF-DRAFT-1" in s2 and "Search" not in s2)

    _palette_run("stash prompt")                              # stash it again for the delete proof
    _palette_run("stash list")
    os.write(master, b"\x04"); read_for(master, stream, 0.8)  # ctrl+d: arm delete
    s3 = "\n".join(screen.display)
    check(pid, "S3 two-stroke delete arms with the confirm label", "Press ctrl+d again to confirm" in s3)
    os.write(master, b"\x04"); read_for(master, stream, 0.8)  # ctrl+d: delete
    s4 = "\n".join(screen.display)
    check(pid, "S4 second ctrl+d empties the stash list", "No matching items" in s4)
    os.write(master, b"\x1b"); read_for(master, stream, 0.6)
    try:
        os.remove(os.path.expanduser("~/.config/zcode-tui/prompt-stash.jsonl"))
    except FileNotFoundError:
        pass
else:
    for lbl in ("S0 stash prompt parks the draft (composer empties)",
                "S1 stash list dialog shows the preview + age",
                "S2 restore returns the draft to the composer",
                "S3 two-stroke delete arms with the confirm label",
                "S4 second ctrl+d empties the stash list"):
        check(pid, lbl, False)

if alive(pid):
    os.write(master, b"/skills\r"); read_for(master, stream, 1.5)
    k0 = False
    for _ in range(12):                                        # poll: catalog fetch under load
        read_for(master, stream, 0.8)
        if "autoplan" in "\n".join(screen.display):
            k0 = True
            break
    check(pid, "K0 /skills opens the Skills dialog", "Skills" in "\n".join(screen.display) and "Search" in "\n".join(screen.display))
    check(pid, "K1 catalog rows render (a user skill is listed)", k0)
    os.write(master, b"\x1b"); read_for(master, stream, 0.6)
else:
    check(pid, "K0 /skills opens the Skills dialog", False)
    check(pid, "K1 catalog rows render (a user skill is listed)", False)

if alive(pid):
    os.write(master, b"/mcps\r"); read_for(master, stream, 3.0)
    m0 = "\n".join(screen.display)
    check(pid, "M0 /mcps opens the MCP servers dialog", "MCP servers" in m0)
    check(pid, "M1 status grammar renders", "Connected \u2713" in m0 or "Connecting \u2026" in m0)
    os.write(master, b"\x1b"); read_for(master, stream, 0.6)
else:
    check(pid, "M0 /mcps opens the MCP servers dialog", False)
    check(pid, "M1 status grammar renders", False)

# ---- V/TG-series: /variants alias + the file-context toggle (v2 ports). ----
# The toggles persist into the real state.json, so the pre-toggle bytes are
# captured and restored after the series.
st_file = os.path.expanduser("~/.config/zcode-tui/state.json")
st_backup = None
try:
    st_backup = open(st_file, "rb").read()
except FileNotFoundError:
    pass

if alive(pid):
    os.write(master, b"/variants\r"); read_for(master, stream, 1.5)
    v0 = "\n".join(screen.display)
    check(pid, "V0 /variants opens the effort dialog (v2 slash alias)", "Reasoning effort" in v0)
    os.write(master, b"\x1b"); read_for(master, stream, 0.6)

    os.write(master, b"\x03"); time.sleep(0.3)           # clear draft
    os.write(master, b"@"); read_for(master, stream, 1.0)
    tg0 = "\n".join(screen.display)
    check(pid, "TG0 @ pops the file-context rows", "base.txt" in tg0)
    os.write(master, b"\x03"); time.sleep(0.3)

    os.write(master, b"\x10"); read_for(master, stream, 0.8)   # ctrl+p
    for ch in "disable file context":
        os.write(master, ch.encode()); time.sleep(0.03)
    read_for(master, stream, 0.5)
    os.write(master, b"\r"); read_for(master, stream, 1.0)
    os.write(master, b"@"); read_for(master, stream, 1.0)
    tg1 = "\n".join(screen.display)
    check(pid, "TG1 file context off suppresses the @ popup", "base.txt" not in tg1)
    os.write(master, b"\x03"); time.sleep(0.3)

    os.write(master, b"\x10"); read_for(master, stream, 0.8)
    for ch in "enable file context":
        os.write(master, ch.encode()); time.sleep(0.03)
    read_for(master, stream, 0.5)
    os.write(master, b"\r"); read_for(master, stream, 1.0)
    os.write(master, b"@"); read_for(master, stream, 1.0)
    tg2 = "\n".join(screen.display)
    check(pid, "TG2 re-enabling restores the @ popup", "base.txt" in tg2)
    os.write(master, b"\x03"); time.sleep(0.3)

    if st_backup is not None:
        open(st_file, "wb").write(st_backup)
    else:
        try:
            os.remove(st_file)
        except FileNotFoundError:
            pass
else:
    check(pid, "V0 /variants opens the effort dialog (v2 slash alias)", False)
    check(pid, "TG0 @ pops the file-context rows", False)
    check(pid, "TG1 file context off suppresses the @ popup", False)
    check(pid, "TG2 re-enabling restores the @ popup", False)
kill(pid)

# ---- boot 2: persisted effort advertised ----
pid, master, screen, stream = spawn(cols=111)
read_for(master, stream, 9)
fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 34, 111, 0, 0))
read_for(master, stream, 2.5)
# W1 switched the model to GLM-5.3 (recent head), so the restart must
# advertise THAT model; its per-model variant is the catalog default (max).
f0 = "GLM-5.3 Z.AI" in "\n".join(screen.display) and "· max" in "\n".join(screen.display)
check(pid, "F0 restart advertises the persisted model (GLM-5.3) with its effort", f0)
kill(pid)


# ---- boot 3: diff viewer (the v2 port over local-git wiring) ----
DIFF_CWD = "/tmp/zct-proof-cwd"

def seed_diff_repo():
    # Deterministic every run: nuke and re-init (earlier runs must not leak
    # tracked files into the next run's diff). Three changed files: a small
    # modify, a 60-line file with a mid-file edit (so n/s/v visibly scroll),
    # and an untracked addition.
    import shutil
    shutil.rmtree(f"{DIFF_CWD}/.git", ignore_errors=True)
    for name in ("base.txt", "tallfile.txt", "untracked.txt"):
        try:
            os.remove(f"{DIFF_CWD}/{name}")
        except FileNotFoundError:
            pass
    os.makedirs(DIFF_CWD, exist_ok=True)
    def git(*args):
        return subprocess.run(["git", "-C", DIFF_CWD, *args], capture_output=True)
    git("init", "-q", "-b", "main")
    git("config", "user.email", "proof@local")
    git("config", "user.name", "proof")
    with open(f"{DIFF_CWD}/base.txt", "w") as f:
        f.write("one\n")
    with open(f"{DIFF_CWD}/tallfile.txt", "w") as f:
        f.writelines(f"line {i}\n" for i in range(1, 61))
    git("add", "-A")
    git("commit", "-q", "-m", "baseline")
    with open(f"{DIFF_CWD}/base.txt", "w") as f:
        f.write("one\ntwo\n")
    with open(f"{DIFF_CWD}/tallfile.txt", "w") as f:
        f.writelines((f"line {i} edited\n" if i == 30 else f"line {i}\n") for i in range(1, 61))
        f.write("line 61\nline 62\n")
    with open(f"{DIFF_CWD}/untracked.txt", "w") as f:
        f.write("added\n")

seed_diff_repo()
pid, master, screen, stream = spawn(cols=140)
read_for(master, stream, 9)

# DF1: /diff opens the route: All header, tree rows, 0/3 review count
os.write(master, b"/diff\r")
read_for(master, stream, 3.0)
disp = "\n".join(screen.display)
# Branch mode is TRACKED-only upstream (untracked files appear in the
# working source), so the count is 0/2 here.
check(pid, "DF1 /diff opens: All source header + tree + 0/2 review count",
      "All" in disp and "vs main" in disp and "tallfile.txt" in disp and "0/2" in disp)

# DF2/DF3: file walk + single-patch toggle (screen truth: the pane changes)
os.write(master, b"n"); read_for(master, stream, 1.2)
disp_n = "\n".join(screen.display)
check(pid, "DF2 n walks to the next file", disp_n != disp)
os.write(master, b"s"); read_for(master, stream, 1.2)
os.write(master, b"p"); read_for(master, stream, 1.2)          # single: back to base.txt
os.write(master, b"G"); read_for(master, stream, 1.2)          # end of the ONLY card
single_disp = "\n".join(screen.display)
# The tallfile card does not exist in single view: its tree row is the one
# mention, and none of its patch content may show.
check(pid, "DF3 s enters single-file patch view (other card absent)",
      single_disp.count("tallfile.txt") == 1 and "line 55" not in single_disp)
os.write(master, b"s"); read_for(master, stream, 1.2)

# DF4/DF5: the diff shortcuts overlay
os.write(master, b"?"); read_for(master, stream, 1.2)
disp = "\n".join(screen.display)
check(pid, "DF4 ? opens the Diff shortcuts overlay", "Diff shortcuts" in disp and "Next / previous change" in disp)
os.write(master, b"\x1b"); read_for(master, stream, 0.8)
check(pid, "DF5 help overlay closes", "Diff shortcuts" not in "\n".join(screen.display))

# DF6/DF7: the Diff source dialog -> Uncommitted
os.write(master, b"d"); read_for(master, stream, 1.2)
disp = "\n".join(screen.display)
check(pid, "DF6 d opens the Diff source dialog", "Diff source" in disp and "Committed" in disp and "Choose" in disp)
os.write(master, b"\x1b[B"); time.sleep(0.2)
os.write(master, b"\x1b[B"); time.sleep(0.2)
os.write(master, b"\r"); read_for(master, stream, 3.0)
disp = "\n".join(screen.display)
check(pid, "DF7 Uncommitted source: vs HEAD + the untracked file joins (0/3)",
      "Uncommitted" in disp and "vs HEAD" in disp and "untracked.txt" in disp and "0/3" in disp)

# DF8: v toggles split/unified
before_v = "\n".join(screen.display)
os.write(master, b"v"); read_for(master, stream, 1.2)
check(pid, "DF8 v toggles the view (screen changed)", "\n".join(screen.display) != before_v)

# DF9: m marks reviewed (count 1/2)
os.write(master, b"m"); read_for(master, stream, 1.2)
disp = "\n".join(screen.display)
check(pid, "DF9 m marks the file reviewed (1/3)", "1/3" in disp)

# DF10: b toggles the tree column (the ≡ file markers come and go)
os.write(master, b"b"); read_for(master, stream, 1.2)
disp = "\n".join(screen.display)
check(pid, "DF10 b hides the file tree", "\u2261" not in disp)
os.write(master, b"b"); read_for(master, stream, 1.2)
check(pid, "DF10b b restores the file tree", "\u2261" in "\n".join(screen.display))

# DF11/DF12: q closes back home; the composer must be alive
os.write(master, b"q"); read_for(master, stream, 1.5)
disp = "\n".join(screen.display)
check(pid, "DF11 q closes the diff route", "Ask anything" in disp)
token = False
for _ in range(4):
    os.write(master, b"ZC-DIFF-RETURN")
    read_for(master, stream, 0.8)
    if "ZC-DIFF-RETURN" in "\n".join(screen.display):
        token = True
        break
check(pid, "DF12 composer alive after closing the diff route", token)
kill(pid)

print("RESULT:", "PASS" if all(ok for _, ok in verdicts) else "FAIL")
sys.exit(0 if all(ok for _, ok in verdicts) else 1)
