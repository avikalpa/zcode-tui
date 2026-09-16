#!/usr/bin/env python3
"""PTY acceptance v5 — zcode-tui 0.6.8 (owner report 2026-09-16).

Laws: TUI paints deltas (strip ANSI, resize for full frames) · never type
into a live draft without an escape · never SEND (tokens are draft-only;
effort is selected on HOME so the write is local) · every stage is gated on
process liveness so a dead app can never pass vacuously (run 5 lesson).
"""
import os, pty, select, re, sys, time, fcntl, termios, struct

binary = sys.argv[1]
verdicts = []
ANSI = re.compile(rb"\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[()][0-9A-B]")

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

def spawn(cols=110):
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir("/tmp/zct-proof-cwd")
        os.execve(binary, [binary], dict(os.environ, TERM="xterm-256color"))
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 34, cols, 0, 0))
    return pid, fd

def read_for(fd, buf, seconds):
    end = time.time() + seconds
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.2)
        if r:
            try:
                chunk = os.read(fd, 65536)
            except OSError:
                return
            if not chunk:
                return
            buf.extend(chunk)

def plain(buf):
    return ANSI.sub(b"", bytes(buf))

def kill(pid):
    try:
        os.kill(pid, 9)
        os.waitpid(pid, 0)
    except ProcessLookupError:
        pass

# ---- boot 1 ----
buf = bytearray()
pid, fd = spawn()
read_for(fd, buf, 9)
check(pid, "A0 boot rendered", b"Ask anything" in plain(buf))

os.write(fd, b"ZCODE-PROOF-HOME-TOKEN")
read_for(fd, buf, 1.5)
check(pid, "A1 typing on home paints", b"ZCODE-PROOF-HOME-TOKEN" in plain(buf))

os.write(fd, b"\x1b"); time.sleep(0.3)  # escape -> nav surface (draft cleared)
os.write(fd, b"e")                      # nav 'e': effort dialog (home, local-only)
read_for(fd, buf, 2.0)
check(pid, "D0 effort dialog opens (nav e)", b"Reasoning effort" in plain(buf))
os.write(fd, b"\r")                     # select Low; dialog self-closes
read_for(fd, buf, 2.0)
check(pid, "D1 effort Low selected (local)", b"effort \xe2\x86\x92 low" in plain(buf))

# T-series: the 4th-instance regression — a dialog SELECT must restore typing.
os.write(fd, b"ZCODE-PROOF-AFTER-SELECT")
read_for(fd, buf, 1.5)
check(pid, "T0 typing composes right after a dialog select", b"ZCODE-PROOF-AFTER-SELECT" in plain(buf))
os.write(fd, b"\x1b"); time.sleep(0.3)  # clear draft (nav surface now)

os.write(fd, b"\x18l")                  # ctrl+x l -> sessions dialog
read_for(fd, buf, 1.5)
dialog = plain(buf)
b0 = b"Sessions" in dialog and b"search" in dialog
check(pid, "B0 sessions dialog opens", b0)
check(pid, "B1 date group headers render", re.search(rb"(Sep|Oct|Nov|Dec) \d\d 20\d\d|Today", dialog) is not None)
check(pid, "B2 footer hints", b"pin" in dialog and b"delete" in dialog and b"switch" in dialog)
check(pid, "B3 no idle clutter", b"idle \xc2\xb7" not in dialog)
check(pid, "B4 quick-slot gutters", re.search(rb" 1 \S", dialog) is not None)

if b0 and alive(pid):
    os.write(fd, b"\r")                 # open row 1 (typing only, never send)
    read_for(fd, buf, 4.5)
    opened = plain(buf)
    check(pid, "C-1 open() completed (messages witness)", b"messages" in opened)
    os.write(fd, b"ZCODE-PROOF-AFTER-OPEN")
    read_for(fd, buf, 1.5)
    check(pid, "C0 typing after open() paints — THE bug", b"ZCODE-PROOF-AFTER-OPEN" in plain(buf))

    # S-series: seamless scroll (hidden scrollbar, follow-tail, affordance).
    w0 = plain(buf)
    os.write(fd, b"\x1b[5~"); time.sleep(0.4)
    os.write(fd, b"\x1b[5~"); time.sleep(0.8)
    read_for(fd, buf, 1.0)
    w1 = plain(buf)
    check(pid, "S0 pageup scrolls (content changed)", w1 != w0)
    check(pid, "S1 Jump-to-latest affordance appears", b"Jump to latest" in w1)
    os.write(fd, b"\x1b\x07"); time.sleep(0.6)   # ctrl+alt+g -> jump to latest
    for _ in range(12):                            # pagedown flood: deterministic bottom
        os.write(fd, b"\x1b[6~"); time.sleep(0.08)
    read_for(fd, buf, 1.5)
    start_mark = len(buf) - min(len(buf), 20000)
    w2 = plain(buf[start_mark:])
    check(pid, "S2 affordance clears at the bottom", b"Jump to latest" not in w2)
else:
    check(pid, "C-1 open() completed (messages witness)", False)
    check(pid, "C0 typing after open() paints — THE bug", False)
kill(pid)

# ---- boot 2: persisted effort advertised ----
buf2 = bytearray()
pid, fd = spawn()
read_for(fd, buf2, 9)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 34, 111, 0, 0))
read_for(fd, buf2, 2.5)
check(pid, "F0 restart advertises persisted effort low", b"\xc2\xb7 low" in plain(buf2))
kill(pid)

print("RESULT:", "PASS" if all(ok for _, ok in verdicts) else "FAIL")
sys.exit(0 if all(ok for _, ok in verdicts) else 1)
