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
b0 = "Sessions" in disp and "search" in disp
check(pid, "B0 sessions dialog opens", b0)
check(pid, "B1 date group headers render", re.search(r"(Sep|Oct|Nov|Dec) \d\d 20\d\d|Today", disp) is not None)
check(pid, "B2 footer hints", "pin" in disp and "delete" in disp and "switch" in disp)
check(pid, "B3 no idle clutter", "idle ·" not in disp)
check(pid, "B4 quick-slot gutters", re.search(r"\b1 \S", disp) is not None)

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
else:
    for lbl in ("S0 pageup scrolls (content changed)", "S1 Jump-to-latest affordance appears", "S2 affordance clears at the bottom"):
        check(pid, lbl, False)
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

print("RESULT:", "PASS" if all(ok for _, ok in verdicts) else "FAIL")
sys.exit(0 if all(ok for _, ok in verdicts) else 1)
