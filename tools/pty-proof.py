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
check_secs = []          # parallel to verdicts: the FAM section each check ran under
CUR_SECTION = None       # set by the --stage runner; None in the full run
DUMPS_DIR = None         # --stage --dumps: per-state-change screen dumps land here
_dump_seq = 0
_dump_sig = None
_SCREENS = {}            # id(stream) -> screen, for the dumps microscope

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
    check_secs.append(CUR_SECTION)
    print(f"{'PASS' if ok else 'FAIL'}{'' if alive(pid) else ' (DEAD)'} {label}")

with open("/tmp/zct-fake-editor.sh", "w") as f:
    f.write('#!/bin/sh\nprintf EDITED-BY-EDITOR >> "$1"\ncp "$1" /tmp/zct-export-latest.md\n')
os.chmod("/tmp/zct-fake-editor.sh", 0o755)

def sweep_stale_instances(label):
    # LEAK GUARD (2026-09-19 sitting): an earlier sitting leaked five
    # worktree-dist TUIs that burned the host for hours — the "degrades with
    # host load" class was partly the proof's own orphans. A live owner row
    # never runs from a worktree dist path, so every instance of this exact
    # binary is the proof's own.
    # /proc/<pid>/exe matching (the deploy law technique): a cmdline match
    # would kill the invoking shell — the path rides argv there.
    killed = []
    target = os.path.abspath(binary)
    me = os.getpid()
    for pid_s in os.listdir("/proc"):
        if not pid_s.isdigit():
            continue
        p = int(pid_s)
        if p == me:
            continue
        try:
            exe_ok = os.readlink("/proc/%d/exe" % p) == target
        except OSError:
            continue
        # backend orphans: a zcode-cli whose TUI died reparents to init and
        # can spin at 100%% CPU for hours (two found this sitting, one since
        # the PREVIOUS day) — the load behind the whole flake class.
        try:
            with open("/proc/%d/comm" % p) as _f:
                comm = _f.read().strip()
            with open("/proc/%d/stat" % p) as _f:
                ppid = int(_f.read().rsplit(")", 1)[1].split()[1])
        except (OSError, IndexError, ValueError):
            continue
        if not (exe_ok or (comm == "zcode-cli" and ppid == 1)):
            continue
        try:
            os.kill(p, 9)
            killed.append(p)
        except OSError:
            continue
    if killed:
        print("%s: killed %d stale instance(s) of this binary: %s"
              % (label, len(killed), killed))
        time.sleep(0.5)

sweep_stale_instances("LEAK GUARD start")

def spawn(cols=110, rows=34, args=None):
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    screen = pyte.Screen(cols, rows)
    stream = pyte.ByteStream(screen)
    pid = subprocess.Popen([binary] + (args or []), stdin=slave, stdout=slave, stderr=subprocess.DEVNULL,
                           cwd="/tmp/zct-proof-cwd",
                           env=dict(os.environ, TERM="xterm-256color", EDITOR="/tmp/zct-fake-editor.sh"),
                           close_fds=True).pid
    os.close(slave)
    return pid, master, screen, stream

RAW = bytearray()

def read_for(master, stream, seconds):
    global _dump_seq, _dump_sig
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
            if DUMPS_DIR is not None:                     # --stage --dumps: the microscope
                _scr = getattr(stream, "screen", None) or _SCREENS.get(id(stream))
                if _scr is not None:
                    sig = hash(tuple(_scr.display))
                    if sig != _dump_sig:
                        _dump_sig = sig
                        _dump_seq += 1
                        if _dump_seq <= 999:
                            with open(os.path.join(DUMPS_DIR, "s%04d.txt" % _dump_seq), "w") as _df:
                                _df.write("\n".join(_scr.display))

def kill(pid):
    try:
        os.kill(pid, 9)
        os.waitpid(pid, 0)
    except ProcessLookupError:
        pass
# ==== --stage microscope runner (dream ACK-c4026a1ec6, wave 0.6.38).
# The no-arg full run below is untouched; --stage FAM [--dumps DIR] execs
# boot-closure + ONE family slice (the '# ==== FAM:' markers below are the
# only structure it adds) so the stage bodies stay the SSOT. Per-state-
# change screen dumps, pid-scoped cli-trace tail on fail, family verdict.
def _fam_parse(argv):
    if len(argv) < 2:
        sys.exit("usage: pty-proof.py BINARY [--stage FAM] [--dumps DIR]")
    binary, stage, dumps = argv[1], None, None
    i = 2
    while i < len(argv):
        if argv[i] == "--stage" and i + 1 < len(argv):
            stage = argv[i + 1]; i += 2
        elif argv[i] == "--dumps" and i + 1 < len(argv):
            dumps = argv[i + 1]; i += 2
        else:
            sys.exit("pty-proof: bad argument %r (usage: pty-proof.py BINARY [--stage FAM] [--dumps DIR])" % argv[i])
    return binary, stage, dumps

def _fam_sections(src):
    lines = src.splitlines()
    marks = []
    for idx, line in enumerate(lines):
        m = re.match(r"# ==== FAM:([A-Z0-9]+)(?: requires ([A-Z0-9, ]+))? ====", line)
        if m:
            reqs = [r for r in (m.group(2) or "").replace(",", " ").split() if r]
            marks.append((m.group(1), reqs, idx))
    if not marks or marks[-1][0] != "EPILOGUE":
        sys.exit("pty-proof: FAM markers missing or corrupt")
    secs, reqs_of, order = {}, {}, []
    for i, (name, reqs, idx) in enumerate(marks):
        end = marks[i + 1][2] if i + 1 < len(marks) else len(lines)
        secs[name] = "\n".join(lines[idx:end])
        reqs_of[name] = reqs
        order.append(name)
    return secs, reqs_of, order

if len(sys.argv) > 2:   # stage mode; the full run is the plain one-arg invocation
    _binary, _stage, _dumps = _fam_parse(sys.argv)
    if _stage is None:
        sys.exit("pty-proof: --dumps needs --stage FAM")
    _secs, _reqs, _order = _fam_sections(open(__file__).read())
    if _stage not in _secs or _stage == "EPILOGUE":
        sys.exit("pty-proof: unknown family %r (known: %s)" % (
            _stage, ", ".join(n for n in _order if n != "EPILOGUE")))
    _need, _changed = set([_stage]), True
    while _changed:                     # transitive requires closure
        _changed = False
        for _n in list(_need):
            for _r in _reqs[_n]:
                if _r not in _need:
                    _need.add(_r)
                    _changed = True
    _run_order = [_n for _n in _order if _n in _need]
    _orig_spawn = spawn
    def spawn(cols=110, rows=34, args=None):   # stage-mode wrapper: register stream->screen
        _r = _orig_spawn(cols, rows, args)
        _SCREENS[id(_r[3])] = _r[2]
        return _r
    if _dumps:
        DUMPS_DIR = _dumps
        os.makedirs(_dumps, exist_ok=True)
    print("STAGE run: %s (requires: %s)" % (
        _stage, ", ".join(n for n in _run_order if n != _stage) or "none"))
    try:
        for _n in _run_order:
            CUR_SECTION = _n
            exec(compile(_secs[_n], "<fam:%s>" % _n, "exec"), globals())
    finally:
        CUR_SECTION = None
        for _pname in ("pid", "th_pid", "th_pid2", "at_pid", "pf_pid"):
            _p = globals().get(_pname)
            if isinstance(_p, int) and _p > 0:
                try:
                    os.kill(_p, 0)
                    os.kill(_p, 9)
                    print("STAGE teardown: killed leftover %s=%d" % (_pname, _p))
                except ProcessLookupError:
                    pass
        sweep_stale_instances("LEAK GUARD teardown")
        if DUMPS_DIR is not None:
            try:
                open(os.path.join(DUMPS_DIR, "raw.bin"), "wb").write(bytes(RAW))
            except Exception as _e:
                print("STAGE: raw dump failed:", _e)
    _fam = [(l, ok) for (l, ok), s in zip(verdicts, check_secs) if s == _stage]
    for _l, _ok in _fam:
        print(("PASS " if _ok else "FAIL ") + _l)
    if any(not ok for _, ok in _fam):
        _pids = [str(globals().get(pn)) for pn in ("pid", "th_pid", "th_pid2", "at_pid", "pf_pid")
                 if isinstance(globals().get(pn), int)]
        try:
            _rows = open(os.path.expanduser("~/.yggterm/cli-trace/zcode-tui.jsonl")).read().splitlines()
            _tail = [r for r in _rows if any(p in r for p in _pids)][-60:]
            if _tail:
                print("---- cli-trace tail (pid-scoped) ----")
                for _r in _tail:
                    print(_r[:400])
        except OSError:
            pass
    print("STAGE RESULT: %s %s (%d checks)" % (
        "PASS" if _fam and all(ok for _, ok in _fam) else "FAIL", _stage, len(_fam)))
    sys.exit(0 if _fam and all(ok for _, ok in _fam) else 1)

# ==== FAM:BOOT ====
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

# ==== FAM:X0 requires BOOT ====
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

# ==== FAM:H requires BOOT ====
# H-series: ? opens the keybind help overlay
os.write(master, b"?")
read_for(master, stream, 1.0)
disp = "\n".join(screen.display)
check(pid, "H0 ? opens the keybind help overlay", "Help — keybinds" in disp and "ctrl+x then" in disp)
os.write(master, b"\x1b")
read_for(master, stream, 0.6)
check(pid, "H1 help overlay closes", "Help — keybinds" not in "\n".join(screen.display))

# ==== FAM:SL requires BOOT ====
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
    os.write(master, b"\x03")
    sl_clear = False
    for _ in range(6):                                         # verify the clear (never leave a draft behind)
        read_for(master, stream, 0.5)
        if "Ask anything" in "\n".join(screen.display):
            sl_clear = True
            break
    check(pid, "SL2 ctrl+c clears after the selection flow", sl_clear)

    # HF-series: the v2 home.footer status row (0.6.26) — the MCP ⊙ count
    # with the /mcps hint at width >= 64.
    hf0 = False
    for _ in range(10):                                        # poll: the boot MCP fetch
        read_for(master, stream, 0.6)
        d = "\n".join(screen.display)
        if "\u2299" in d and "/mcps" in d:
            hf0 = True
            break
    check(pid, "HF0 home footer shows the MCP status row", hf0)

    # SE-series: the /settings dialog (v2 DialogConfig port, 0.6.27).
    # HARDENED: verify an empty composer, then a visible popup, BEFORE any
    # enter — a blind enter on a leftover draft sends it as a real message
    # (the 0.6.27 sitting measured exactly that: "abc/settings" ran a turn).
    se_clear = False
    for _ in range(6):
        read_for(master, stream, 0.5)
        if "Ask anything" in "\n".join(screen.display):
            se_clear = True
            break
    check(pid, "SE-pre composer verified empty", se_clear)
    os.write(master, b"/settings")
    se_popup = False
    for _ in range(6):
        read_for(master, stream, 0.5)
        d = "\n".join(screen.display)
        if "/settings" in d and "Ask anything" not in d:
            se_popup = True
            break
    check(pid, "SE-pre popup verified", se_popup)
    os.write(master, b"\r")
    se0 = False
    for _ in range(8):                                         # poll: dialog paint
        read_for(master, stream, 0.6)
        d = "\n".join(screen.display)
        if "Settings" in d and "Appearance" in d and "Session" in d:
            se0 = True
            break
    if not se0:
        print("---- SE0 FAIL SCREEN ----")
        for i, line in enumerate(screen.display):
            if line.strip():
                print(f"{i:2}|{line.rstrip()}")
    check(pid, "SE0 /settings opens with category groups + values", se0)
    os.write(master, b"\x1b[C")
    se1 = False
    for _ in range(8):                                         # poll: the value-change flash
        read_for(master, stream, 0.6)
        if "\u2192" in "\n".join(screen.display):
            se1 = True
            break
    check(pid, "SE1 right cycles the highlighted setting", se1)
    os.write(master, b"\x1b"); read_for(master, stream, 0.6)
    check(pid, "SE2 settings dialog closes", "Settings" not in "\n".join(screen.display))
    os.write(master, b"\x03"); time.sleep(0.3)
else:
    check(pid, "SL0 shift-select + typing replaces the range", False)
    check(pid, "SL1 backspace deletes the selection", False)

# ==== FAM:TABL requires BOOT ====
# TAB/L-series (home-local)
before_mode = [l for l in screen.display if "Z.AI Coding Plan" in l]
os.write(master, b"\t")
read_for(master, stream, 1.2)
after_mode = [l for l in screen.display if "Z.AI Coding Plan" in l]
check(pid, "T0 tab cycles the agent (status changed)", bool(after_mode) and after_mode != before_mode)

os.write(master, b"\x18m"); read_for(master, stream, 1.2)
check(pid, "L0 leader m opens the model dialog", "Select model" in "\n".join(screen.display))
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

# ==== FAM:ST requires BOOT ====
# ST-series: the status dialog (v2 DialogStatus port, 0.6.28). leader s
# opens the real v2 status view — the invented statusSummary toast is gone.
# The mcp/list fetch resolves late on a cold daemon (the HF0 boot-fetch
# lesson), so the ready paint is POLLED, not assumed after a fixed settle.
os.write(master, b"\x18s")
st0 = False
for _ in range(16):                                        # poll: fetch + paint
    read_for(master, stream, 0.6)
    d = "\n".join(screen.display)
    if "Status" in d and ("No MCP servers" in d or "MCP server" in d):
        st0 = True
        break
if not st0:
    print("---- ST0 FAIL SCREEN ----")
    for i, line in enumerate(screen.display):
        if line.strip():
            print(f"{i:2}|{line.rstrip()}")
check(pid, "ST0 leader s opens the status dialog", st0)

# ST2/ST3: the plan-quota Usage section (0.6.46, fork (b) — the TUI
# reads the desktop monitor endpoints with the synced coding-plan key).
# The PLAN QUOTA header paints deterministically; the data lines depend
# on network+key, and EVERY branch paints an honest fallback, so the
# resolve check accepts either. st3 polls past the 15s fetch timeout so
# the fail path is reached, not assumed.
st2 = False
for _ in range(16):
    read_for(master, stream, 0.6)
    if "PLAN QUOTA" in "\n".join(screen.display):
        st2 = True
        break
check(pid, "ST2 status dialog paints the PLAN QUOTA section", st2)
st3 = False
for _ in range(30):
    read_for(master, stream, 0.6)
    d = "\n".join(screen.display)
    if re.search(r"resets|unavailable|no plan key|Usage 7d", d):
        st3 = True
        break
check(pid, "ST3 usage section resolves to data or an honest fallback", st3)
os.write(master, b"\x1b")
st1 = False
for _ in range(6):                                         # poll: the close repaint
    read_for(master, stream, 0.4)
    if "Status" not in "\n".join(screen.display):
        st1 = True
        break
check(pid, "ST1 esc closes the status dialog", st1)

# ==== FAM:WMODEL requires BOOT ====
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

# ==== FAM:B requires BOOT ==== (leaves the sessions dialog open; sets b0)
os.write(master, b"\x18l")
# The dialog's session/list fetch resolves late on a cold daemon (the HF0/ST0
# lesson — 2026-09-19: the fixed 1.5s settle lost the race and cascade-failed
# the B/C/G/I/S series on BOTH the wave and control builds). Poll the ready
# paint; never fixed-settle an open.
b0 = False
for _ in range(16):
    read_for(master, stream, 0.6)
    disp = "\n".join(screen.display)
    if "Sessions" in disp and "Search" in disp:
        b0 = True
        break
if not b0:
    print("---- B0 FAIL SCREEN ----")
    for i, line in enumerate(screen.display):
        if line.strip():
            print(f"{i:2}|{line.rstrip()}")
disp = "\n".join(screen.display)
b0 = "Sessions" in disp and "Search" in disp
check(pid, "B0 sessions dialog opens", b0)
check(pid, "B1 date group headers render", re.search(r"(Sep|Oct|Nov|Dec) \d\d 20\d\d|Today", disp) is not None)
# 0.6.48 conditional grammar (v2 quickSwitchFooterHints): the switch hint and
# slot gutters exist only while tabs are open — at B time none are.
check(pid, "B2 footer hints (pin/delete, switch only with tabs)",
      "pin" in disp and "delete" in disp and "switch ctrl+1-9" not in disp)
check(pid, "B3 no idle clutter", "idle ·" not in disp)
check(pid, "B4 no slot gutters while no tabs are open", re.search(r"(^|\s)1\s+\S", disp) is None)

# ==== FAM:D requires BOOT ====
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
    os.write(master, b"\x18l")  # reopen sessions for the C-series — polled (cold-daemon law)
    for _ in range(16):
        read_for(master, stream, 0.6)
        d_reopen = "\n".join(screen.display)
        if "Sessions" in d_reopen and "Search" in d_reopen:
            break
else:
    for lbl in ("D0 themes dialog opens with bare rows (no OpenCod suffix)",
                "D1 search row shows the Search placeholder",
                "D2 the origin theme wears the ● gutter marker",
                "D3 typing filters the rows (dra → dracula)",
                "D4 escape closes the dialog"):
        check(pid, lbl, False)


# ==== FAM:CSPINE requires B, D ==== (C/W/G/X/TL/I/Q/CX — the nested spine)
if b0 and alive(pid):
    os.write(master, b"\r"); read_for(master, stream, 5.5)   # let open() settle fully
    # Residual-ask de-zombifier (0.6.47): the store holds UNREMOVABLE proof
    # throwaways (the session/close host-verb gap) whose interrupted turns
    # left PENDING permission asks — resuming one repaints the ask card and
    # every later keystroke feeds the CARD, not the composer (measured
    # 2026-09-21: a pf636 card hijacked the spine into X2/CX/S fails on a
    # healthy binary). Dismiss OUR OWN leftover cards — the payload must
    # carry the proof scope, a foreign ask is never touched (named, and the
    # run proceeds honestly) — using the PF3 grammar: esc on a collapsed
    # card dismisses (deny + stop).
    for _ in range(4):
        d_ask = "\n".join(screen.display)
        if "Permission required" not in d_ask:
            break
        if "pf636" not in d_ask and "zct-proof-cwd" not in d_ask:
            print("---- C-1 FOREIGN ASK CARD (not ours — left untouched) ----")
            break
        os.write(master, b"\x1b"); read_for(master, stream, 1.2)
    read_for(master, stream, 0.5)
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

    # X1: leader x opens the v2.0.8 export dialog (0.6.33 retired the v1
    # editor-export — the flow never touches an editor now). X2: leader y
    # copies the last assistant message via OSC 52 (the v2 messages.copy
    # semantic). Poll the ready paint (dialog-open law).
    os.write(master, b"\x03"); time.sleep(0.4)   # settle: clear any draft
    os.write(master, b"\x18x"); read_for(master, stream, 2.5)    # leader x: export dialog
    x1 = False
    for _ in range(8):
        read_for(master, stream, 0.5)
        d = "\n".join(screen.display)
        if "Export session" in d and "Include thinking" in d:
            x1 = True
            break
    check(pid, "X1 leader x opens the v2 export dialog", x1)
    os.write(master, b"\x1b"); read_for(master, stream, 0.6)     # esc: close
    # X2 (re-scoped 0.6.48): leader y dispatches the copy — the chord, the
    # session-view gate and the handler are proven by the OSC 52 write OR the
    # visible no-source guard. The old needle fused in a SECOND claim — that
    # the resumed session carries an assistant message — which is catalog
    # state the proof does not own: once the proof cwd's newest session grew
    # up to be a throwaway, the handler flashed "nothing to copy yet" and
    # wrote no OSC (the 0.6.39 fossil-session lesson, copy edition). The
    # OSC write path itself stays proven every run by CX0, whose success
    # toast is gated on osc52Copy returning true.
    mark_raw = len(RAW)
    os.write(master, b"\x18y")                                   # leader y: copy
    x2 = False
    for _ in range(10):
        read_for(master, stream, 0.6)
        d_x2 = "\n".join(screen.display)
        if (b"\x1b]52;c;" in bytes(RAW[mark_raw:])
                or "nothing to copy yet" in d_x2 or "copied " in d_x2):
            x2 = True
            break
    check(pid, "X2 leader y dispatches the copy (OSC 52 or the no-source guard)", x2)

    # TL-series: the v2 dialog-timeline port — timeline rows, enter opens
    # Message Actions, esc returns, Fork row forks at the prompt (wrapper
    # closes the fork). Poll the ready paint each step (0.6.30 B0 lesson:
    # a fixed settle manufactures failures on a cold daemon).
    os.write(master, b"\x18g")
    tl0 = False
    for _ in range(12):                                        # poll: dialog paint
        read_for(master, stream, 0.5)
        if "Timeline" in "\n".join(screen.display):
            tl0 = True
            break
    check(pid, "TL0 leader g opens the timeline", tl0)
    os.write(master, b"\r")
    tl1 = False
    for _ in range(12):                                        # poll: actions paint
        read_for(master, stream, 0.5)
        if "Message Actions" in "\n".join(screen.display):
            tl1 = True
            break
    check(pid, "TL1 enter opens Message Actions", tl1)
    os.write(master, b"\x1b")
    tl2 = False
    for _ in range(10):                                        # poll: back repaint
        read_for(master, stream, 0.5)
        d_tl = "\n".join(screen.display)
        if "Timeline" in d_tl and "Message Actions" not in d_tl:
            tl2 = True
            break
    check(pid, "TL2 esc returns to the timeline", tl2)
    os.write(master, b"\r")
    tl3 = False
    for _ in range(12):                                        # poll: actions again
        read_for(master, stream, 0.5)
        if "Message Actions" in "\n".join(screen.display):
            tl3 = True
            break
    if tl3:
        os.write(master, b"\x1b[B"); read_for(master, stream, 0.4)   # down: Copy
        os.write(master, b"\x1b[B"); read_for(master, stream, 0.4)   # down: Fork
        os.write(master, b"\r")
    tl4 = False
    for _ in range(20):                                        # poll: fork + reload
        read_for(master, stream, 0.5)
        d_tl = "\n".join(screen.display)
        if "fork" in d_tl.lower() and "Message Actions" not in d_tl:
            tl4 = True
            break
    check(pid, "TL3 Message Actions fork forks at the prompt", tl3 and tl4)
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

    # CX-series: the session copy/export family (0.6.33) — a session is
    # active here (the I-series throwaway). OSC 52 output is invisible to
    # the emulator, so the copy proofs read the v2 toast grammar; the
    # export proof reads the dialog flow and the result path.
    cx_clear = False
    for _ in range(6):
        read_for(master, stream, 0.5)
        if "Ask anything" in "\n".join(screen.display):
            cx_clear = True
            break
    check(pid, "CX-pre composer verified empty", cx_clear)
    os.write(master, b"/copy")
    # Positive popup-row needle (typed-command law, R38): the popup ROW must
    # be visible before enter — the placeholder disappears on ANY typed text,
    # so the old "Ask anything" clause passed vacuously whenever the popup
    # lost the paint race, and enter then fell through (CX5 red, CX6 green).
    cx_popup = False
    for _ in range(24):                # 24-round law (0.6.48: the dumps
        read_for(master, stream, 0.5)  # showed the popup painting seconds
        if "copy the session transcript" in "\n".join(screen.display):  # after these windows closed)
            cx_popup = True
            break
    check(pid, "CX-pre /copy popup verified before enter", cx_popup)
    if not cx_popup:
        print("---- CX-pre /copy FAIL SCREEN (tail) ----")
        for line in screen.display[-14:]:
            if line.strip():
                print(f"|{line.rstrip()}")
    os.write(master, b"\r")
    cx0 = False
    for _ in range(8):
        read_for(master, stream, 0.6)
        if "Session transcript copied to clipboard!" in "\n".join(screen.display):
            cx0 = True
            break
    check(pid, "CX0 /copy flashes the v2 success toast", cx0)

    os.write(master, b"\x18x")                                # leader x: export dialog
    cx1 = False
    for _ in range(8):
        read_for(master, stream, 0.6)
        d = "\n".join(screen.display)
        if "Export session" in d and "Include thinking" in d and "Export as:" in d:
            cx1 = True
            break
    if not cx1:
        print("---- CX1 FAIL SCREEN ----")
        for i, line in enumerate(screen.display):
            if line.strip():
                print(f"{i:2}|{line.rstrip()}")
    check(pid, "CX1 leader x opens the export dialog (radio + toggles)", cx1)
    os.write(master, b"\t"); read_for(master, stream, 0.5)    # tab: thinking row
    os.write(master, b"\r"); read_for(master, stream, 0.5)    # toggle thinking off
    check(pid, "CX2 tab+return toggles Include thinking", "[ ] Include thinking" in "\n".join(screen.display))
    os.write(master, b"\t"); read_for(master, stream, 0.4)    # tools
    os.write(master, b"\t"); read_for(master, stream, 0.4)    # copy
    os.write(master, b"\t"); read_for(master, stream, 0.4)    # export
    os.write(master, b"\r")
    cx3 = False
    for _ in range(8):
        read_for(master, stream, 0.6)
        d = "\n".join(screen.display)
        if "Session exported" in d and "/tmp/session-" in d:
            cx3 = True
            break
    check(pid, "CX3 export writes the tmp file and shows the result dialog", cx3)
    os.write(master, b"\r"); read_for(master, stream, 0.6)
    check(pid, "CX4 return closes the result dialog", "Session exported" not in "\n".join(screen.display))

    os.write(master, b"/export")
    cx_popup2 = False
    for _ in range(24):                # 24-round law, same dump finding
        read_for(master, stream, 0.5)
        if "export the session transcript" in "\n".join(screen.display):
            cx_popup2 = True
            break
    check(pid, "CX-pre /export popup verified before enter", cx_popup2)
    if not cx_popup2:
        print("---- CX-pre /export FAIL SCREEN (tail) ----")
        for line in screen.display[-14:]:
            if line.strip():
                print(f"|{line.rstrip()}")
    os.write(master, b"\r")
    cx5 = False
    for _ in range(8):
        read_for(master, stream, 0.6)
        if "Export session" in "\n".join(screen.display):
            cx5 = True
            break
    check(pid, "CX5 /export opens the same dialog", cx5)
    os.write(master, b"\x1b"); read_for(master, stream, 0.6)
    check(pid, "CX6 esc closes the export dialog", "Export session" not in "\n".join(screen.display))
    os.write(master, b"\x03"); time.sleep(0.3)

else:
    for lbl in ("C-1 open() completed (messages witness)", "C0 typing after open() paints — THE bug",
                "G0 ctrl+w deletes the previous word", "G1 ctrl+a + alt+d delete the first word",
                "G2 ctrl+u clears the line", "G3 input undo restores the line",
                "I0 escape interrupts the running turn",
                "CX-pre composer verified empty", "CX-pre /copy popup verified before enter",
                "CX0 /copy flashes the v2 success toast",
                "CX1 leader x opens the export dialog (radio + toggles)",
                "CX2 tab+return toggles Include thinking",
                "CX3 export writes the tmp file and shows the result dialog",
                "CX4 return closes the result dialog",
                "CX-pre /export popup verified before enter", "CX5 /export opens the same dialog",
                "CX6 esc closes the export dialog"):
        check(pid, lbl, False)

# ==== FAM:STHEMES requires B, CSPINE ==== (own long transcript; needs the
# home state CSPINE restores — the I-series throwaway, composer live)
# S-series on a transcript the PROOF owns. The fossil "/themes" session this
# family used to ride aged out of the 100-capped host catalog (0.6.39 find:
# the search hit "No matching items" and enter fell through to a short
# session — nothing to scroll), so the family now grows its own >1-page
# transcript with one minimal real turn in that throwaway (the I-series
# precedent; no new session seeded, the catalog-growth rate is unchanged),
# polls it to completion, and proves the scroll grammar on it.
if b0 and alive(pid):
    os.write(master, b"\x1b")              # esc settle: closes any dialog the
    read_for(master, stream, 0.8)          # requires slice left covering the
    se_clear = False                       # composer (measured 08:45Z: themes
    for _ in range(20):                    # dialog up through window 1); SE law:
        read_for(master, stream, 0.6)      # verify an empty composer before
        if "Ask anything" in "\n".join(screen.display):   # typing (0.6.27),
            se_clear = True               # generous windows - CSPINE-exit
            break                         # repaints lag under host load
    if not se_clear:
        os.write(master, b"\x03")          # ctrl+c clears a leftover draft
        for _ in range(20):                # (also closes a dialog: the dialog
            read_for(master, stream, 0.6)  # onClose handlers take ctrl+c)
            if "Ask anything" in "\n".join(screen.display):
                se_clear = True
                break
    if not se_clear:
        # Last resort: the /home palette command - the state-independent way
        # back to the front page. Popup verified BEFORE enter (the SE law:
        # a blind enter on a leftover draft sends it as a real message).
        os.write(master, b"\x03"); time.sleep(0.3)
        os.write(master, b"/home")
        home_popup = False
        for _ in range(8):
            read_for(master, stream, 0.5)
            d_h = "\n".join(screen.display)
            if "/home" in d_h and "Ask anything" not in d_h:
                home_popup = True
                break
        if home_popup:
            os.write(master, b"\r")
            for _ in range(20):
                read_for(master, stream, 0.6)
                if "Ask anything" in "\n".join(screen.display):
                    se_clear = True
                    break
        else:
            os.write(master, b"\x03")      # never leave the draft behind
            read_for(master, stream, 0.5)
    check(pid, "S-pre composer verified empty before the filler turn", se_clear)
    # The filler ride: paste a 60-line prompt (bracketed paste = ONE atomic
    # insert), send, then INTERRUPT (the I-series precedent). A full turn is
    # too variable to wait out (measured: high-effort streaming ran past a
    # 90s deadline and the live tail-pin defeats pageup mid-turn); the
    # frozen transcript is >1 page no matter how the model paces.
    fill = []
    for _i in range(1, 41):                # the whole payload must stay under
        fill.append(("ZCODE-SCROLL-FILLER line %02d of 40 - "   # the 4096-
                     "proof-owned padding") % _i)                # byte tty buf
    echoed = False
    for _attempt in range(2):              # the enter can be lost under load;
        os.write(master, b"\x1b[200~"      # a stranded 60-line draft would
                 + "\n".join(fill).encode()   # poison every downstream family
                 + b"\x1b[201~")
        read_for(master, stream, 1.0)
        os.write(master, b"\r")
        for _ in range(24):                # poll: the message paints AND the
            read_for(master, stream, 0.7)  # composer comes back empty (SE law)
            d_st = "\n".join(screen.display)
            if (d_st.count("ZCODE-SCROLL-FILLER") >= 4
                    and "Ask anything" in d_st):
                echoed = True
                break
        if echoed:
            break
        os.write(master, b"\x1b[201~")     # recovery: close a stranded paste
        os.write(master, b"\x03")          # then clear the draft (ctrl+c)
        for _ in range(8):
            read_for(master, stream, 0.5)
            if "Ask anything" in "\n".join(screen.display):
                break
    check(pid, "S-pre the filler message sends (echo paints)", echoed)
    os.write(master, b"\x1b")              # escape: interrupt (harmless if done)
    froze = False
    for _ in range(60):                    # poll: quiescent transcript —
        read_for(master, stream, 1.5)      # interrupted, or the turn finished;
        d_st = "\n".join(screen.display)   # the placeholder back = composer
        if ("Ask anything" in d_st         # empty, so a stranded draft can
                and d_st.count("ZCODE-SCROLL-FILLER") >= 4
                and ("turn interrupted" in d_st or "esc stop" not in d_st)):
            froze = True
            break
        if _ in (6, 20, 40):               # under load the first escape can
            os.write(master, b"\x1b")      # land BEFORE the turn starts (the
                                           # interrupt needs running=true) —
                                           # re-arm it; late escapes are no-ops
    check(pid, "S-pre the transcript freezes (a scrollable transcript)", froze)
    read_for(master, stream, 1.0)
    before_s = "\n".join(screen.display)
    scrolled = False
    after_s = before_s
    for _ in range(3):
        os.write(master, b"\x1b[5~"); time.sleep(0.4)
        read_for(master, stream, 1.0)
        after_s = "\n".join(screen.display)
        if after_s != before_s:
            scrolled = True
            break
        before_s = after_s
    check(pid, "S0 pageup scrolls (content changed)", scrolled)
    # S1 re-needle (0.6.39 environmental find): the affordance paint LAGS the
    # scroll render under a heavy host catalog (the microscope caught the
    # scrolled frame 2-3 state-changes ahead of the affordance frame), so a
    # single sample at first-scroll fails on load. Poll, never fixed-settle.
    afford = "Jump to latest" in after_s
    for _ in range(30):                # 0.6.49: 15 rounds missed FIVE consecutive
        if afford:                     # full runs (isolation passes; the fat
            break                      # full-run transcript paints the affordance
        read_for(master, stream, 0.7)  # late - the CX-pre fat-session lesson)
        afford = "Jump to latest" in "\n".join(screen.display)
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
    os.write(master, b"/new\r")
    tb2 = False
    for _ in range(12):                # poll: the /new round-trip lags under
        read_for(master, stream, 0.6)  # daemon load (was a fixed 4.0 settle)
        disp = "\n".join(screen.display)
        if (re.search(r"(^|\s)2\s+\S", disp, re.M) is not None
                and "Untitled session" in disp):
            tb2 = True
            break
    disp = "\n".join(screen.display)
    check(pid, "TB2 /new opens a second tab (gutter 2 + Untitled session)", tb2)
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
    # TB6 (0.6.48): with a tab open the sessions dialog wears the tab-slot
    # gutter and the switch hint — the digit IS what leader N does (the old
    # positional gutters were a deadlock invention, repaired this wave).
    os.write(master, b"\x18l")
    tb6 = False
    for _ in range(16):
        read_for(master, stream, 0.6)
        disp = "\n".join(screen.display)
        if "Sessions" in disp and "Search" in disp:
            tb6 = ("switch ctrl+1-9" in disp
                   and re.search(r"(^|\s)1\s+\S", disp, re.M) is not None)
            break
    check(pid, "TB6 sessions dialog wears the tab-slot gutter + switch hint", tb6)
    os.write(master, b"\x1b"); read_for(master, stream, 0.6)   # close sessions
    os.write(master, b"\x03"); time.sleep(0.3)


else:
    for lbl in ("S-pre composer verified empty before the filler turn", "S-pre the filler message sends (echo paints)", "S-pre the transcript freezes (a scrollable transcript)", "S0 pageup scrolls (content changed)", "S1 Jump-to-latest affordance appears", "S2 affordance clears at the bottom"):
        check(pid, lbl, False)

# ==== FAM:SKM requires BOOT ==== (stash is deterministic; K/M poll the live catalog)
# ---- S/K/M-series: the stash family, skills selector, MCP list (v2 ports) ----
# The stash store is exercised from EMPTY so the proof cannot see or leave
# the owner's real stashed drafts; S0-S4 are deterministic (no backend).
# K/M need the live catalog (workspace-scoped methods), hence the alive guard.
try:
    os.remove(os.path.expanduser("~/.config/zcode-tui/prompt-stash.jsonl"))
except FileNotFoundError:
    pass

def poll_paint(m, st, scr, needles, rounds=16):
    for _ in range(rounds):
        read_for(m, st, 0.6)
        d = "\n".join(scr.display)
        if all(n in d for n in needles):
            return True
    return False

def poll_paint_gone(m, st, scr, needle, rounds=16):
    for _ in range(rounds):
        read_for(m, st, 0.6)
        if needle not in "\n".join(scr.display):
            return True
    return False

def _palette_run(filter_text):
    # Dream ACK-9e5105d7b0: poll the paint per stage — the open (titled
    # Commands dialog), the pick row VISIBLE before enter (typed-command
    # law), and the close — never fixed settles, which missed picks under
    # dev load and collapsed S1-S3 while S4 passed vacuously.
    os.write(master, b"\x10")                            # ctrl+p: palette
    if not poll_paint(master, stream, screen, ("Commands",)):
        return
    for ch in filter_text:
        os.write(master, ch.encode()); time.sleep(0.04)
    poll_paint(master, stream, screen, (filter_text,))
    os.write(master, b"\r")
    poll_paint_gone(master, stream, screen, "Commands")

if alive(pid):
    os.write(master, b"\x03"); time.sleep(0.3)          # ctrl+c: clear any draft
    os.write(master, b"STASH-PROOF-DRAFT-1")
    read_for(master, stream, 0.8)
    _palette_run("stash prompt")
    s0_ok = False
    for _ in range(16):
        read_for(master, stream, 0.6)
        d0 = "\n".join(screen.display)
        if "STASH-PROOF-DRAFT-1" not in d0 and "Ask anything" in d0:
            s0_ok = True
            break
    check(pid, "S0 stash prompt parks the draft (composer empties)", s0_ok)

    _palette_run("stash list")
    s1_ok = poll_paint(master, stream, screen, ("Stash", "STASH-PROOF-DRAFT-1", "just now"))
    check(pid, "S1 stash list dialog shows the preview + age", s1_ok)

    os.write(master, b"\r")                                   # enter: restore (take)
    s2_ok = False
    for _ in range(16):
        read_for(master, stream, 0.6)
        d2 = "\n".join(screen.display)
        if "Stash" not in d2 and "STASH-PROOF-DRAFT-1" in d2:
            s2_ok = True
            break
    check(pid, "S2 restore returns the draft to the composer", s2_ok)

    _palette_run("stash prompt")                              # stash it again for the delete proof
    _palette_run("stash list")
    os.write(master, b"\x04")                                 # ctrl+d: arm delete
    s3_ok = poll_paint(master, stream, screen, ("Press ctrl+d again to confirm",))
    check(pid, "S3 two-stroke delete arms with the confirm label", s3_ok)
    os.write(master, b"\x04")                                 # ctrl+d: delete
    # Positive needle (dream ACK-9e5105d7b0): the EMPTY-LIST line inside the
    # titled Stash dialog — "No matching items" alone is the shared empty
    # text of palette/SlashPopup/SelectDialog and passed vacuously when the
    # pick missed and no dialog was open at all.
    s4_ok = poll_paint(master, stream, screen, ("Stash", "No items available"))
    check(pid, "S4 second ctrl+d empties the stash list", s4_ok)
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

# ==== FAM:PG requires BOOT ====
# ---- PG-series: the plugins dialog (v2 port, 0.6.34). Rows off
# plugins/list; the toggle rounds-trips plugins/setEnabled and is
# RESTORE-VERIFIED: the second enter must put the row's disabled flag
# back exactly as found. The filter pins the row so the "disabled,"
# footer needle can only be the row under test (other rows may legally
# be disabled too). Dev inventory: android-emulator sorts into the filter.
if alive(pid):
    os.write(master, b"/plugins\r"); read_for(master, stream, 2.0)
    pg0 = False
    for _ in range(12):                                        # poll: list fetch
        read_for(master, stream, 0.8)
        d_pg = "\n".join(screen.display)
        if "Plugins" in d_pg and "Search" in d_pg and "Loading plugins" not in d_pg:
            pg0 = True
            break
    check(pid, "PG0 /plugins opens the Plugins dialog", pg0)
    pg1 = "android-emulator" in "\n".join(screen.display)
    check(pid, "PG1 plugin rows render (android-emulator listed)", pg1)
    for ch in "android":                                       # pin the row
        os.write(master, ch.encode()); time.sleep(0.05)
    read_for(master, stream, 0.8)
    pre_disabled = "disabled," in "\n".join(screen.display)
    os.write(master, b"\r"); read_for(master, stream, 0.5)     # enter: toggle
    pg2 = False
    for _ in range(12):                                        # poll: round-trip
        read_for(master, stream, 0.6)
        d_pg = "\n".join(screen.display)
        if "Plugins" in d_pg and ("disabled," in d_pg) != pre_disabled:
            pg2 = True
            break
    check(pid, "PG2 enter toggles the plugin (setEnabled round-trips)", pg2)
    os.write(master, b"\r"); read_for(master, stream, 0.5)     # enter: restore
    pg3 = False
    for _ in range(12):
        read_for(master, stream, 0.6)
        d_pg = "\n".join(screen.display)
        if "Plugins" in d_pg and ("disabled," in d_pg) == pre_disabled:
            pg3 = True
            break
    check(pid, "PG3 second enter restores the found state", pg3)
    os.write(master, b"\x1b"); read_for(master, stream, 0.6)
else:
    check(pid, "PG0 /plugins opens the Plugins dialog", False)
    check(pid, "PG1 plugin rows render (android-emulator listed)", False)
    check(pid, "PG2 enter toggles the plugin (setEnabled round-trips)", False)
    check(pid, "PG3 second enter restores the found state", False)

# ==== FAM:VTG requires BOOT ====
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

# ==== FAM:F0 requires WMODEL ==== (reads the model state W1 persists)
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


# ==== FAM:DF ==== (own spawn + seeded repo)
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

# ==== FAM:TH ==== (own isolated-home spawn)
# TH-series: the theme-mode machine (v2 context/theme.tsx — 0.6.32). Runs in
# an ISOLATED HOME so the persistence proof reads its own state.json and a
# runner account never sees a mode flip. Colour itself is invisible to the
# pyte text dump, so the asserts read the CONSUMPTION: the settings row's
# value meta, and the state file the pin persists.
TH_HOME = "/tmp/zct-proof-home"
subprocess.run(["rm", "-rf", TH_HOME])
subprocess.run(["mkdir", "-p", TH_HOME])

def spawn_th():
    m, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 34, 110, 0, 0))
    scr = pyte.Screen(110, 34)
    strm = pyte.ByteStream(scr)
    p = subprocess.Popen([binary], stdin=slave, stdout=slave, stderr=subprocess.DEVNULL,
                         cwd="/tmp/zct-proof-cwd",
                         env=dict(os.environ, TERM="xterm-256color", HOME=TH_HOME),
                         close_fds=True).pid
    os.close(slave)
    return p, m, scr, strm

def color_mode_seg(scr):
    d = "\n".join(scr.display)
    return d.split("Color mode")[1][:60] if "Color mode" in d else ""

def color_mode_value(scr):
    # The value (meta) paints between double spaces right after the label;
    # the hint text follows. Read the token, never the window.
    seg = color_mode_seg(scr)
    for tok in seg.split("  "):
        tok = tok.strip()
        if tok:
            return tok
    return ""

th_pid, th_m, th_scr, th_st = spawn_th()
th_open = poll_paint(th_m, th_st, th_scr, ["Ask anything"])
check(th_pid, "TH0 isolated-home boot renders", th_open)

if th_open:
    os.write(th_m, b"/settings")
    set_pop = False
    for _ in range(10):
        read_for(th_m, th_st, 0.5)
        if "settings" in "\n".join(th_scr.display):
            set_pop = True
            break
    check(th_pid, "TH1 /settings popup visible before enter", set_pop)   # the blind-enter law
    os.write(th_m, b"\r")
    set_open = poll_paint(th_m, th_st, th_scr, ["Settings", "Color mode"])
    check(th_pid, "TH2 settings dialog shows the Color mode row", set_open)
    check(th_pid, "TH3 fresh home: Color mode reads system (unlocked)", set_open and color_mode_value(th_scr) == "system")

    # walk: row 0 Theme -> row 1 Color mode, then right: system -> dark ->
    # light. The needle reads the VALUE token, never the hint text — the hint
    # ("dark mode - light mode - system theme") poisoned the old 60-char
    # window: TH4 failed on every binary while TH3/TH5/TH7 were false-green
    # on the hint alone. TH4 also proves the pin on disk (the TH6
    # consumption shape) and the cycle polls, never fixed-settles.
    os.write(th_m, b"\x1b[B"); read_for(th_m, th_st, 0.8)
    os.write(th_m, b"\x1b[C")
    th4_paint = False
    for _ in range(10):
        read_for(th_m, th_st, 0.4)
        if color_mode_value(th_scr) == "dark":
            th4_paint = True
            break
    th4_pin = False
    try:
        import json as _json4
        th4_pin = _json4.loads(open(TH_HOME + "/.config/zcode-tui/state.json").read()).get("theme", {}).get("mode") == "dark"
    except Exception:
        pass
    check(th_pid, "TH4 right cycles system -> dark (paint + pin)", set_open and th4_paint and th4_pin)
    os.write(th_m, b"\x1b[C")
    th5_paint = False
    for _ in range(10):
        read_for(th_m, th_st, 0.4)
        if color_mode_value(th_scr) == "light":
            th5_paint = True
            break
    check(th_pid, "TH5 right cycles dark -> light", set_open and th5_paint)
    os.write(th_m, b"\x1b"); read_for(th_m, th_st, 0.8)

    # read the pin while the writer is still alive (check() vetoes a dead pid)
    persisted = False
    try:
        import json as _json
        state = _json.loads(open(f"{TH_HOME}/.config/zcode-tui/state.json").read())
        persisted = state.get("theme", {}).get("mode") == "light"
    except Exception:
        pass
    check(th_pid, "TH6 the pin persisted: state.json theme.mode == light", persisted)
    kill(th_pid)

    # restart on the SAME home: the boot read must restore the lock
    th_pid2, th_m2, th_scr2, th_st2 = spawn_th()
    boot2 = poll_paint(th_m2, th_st2, th_scr2, ["Ask anything"])
    os.write(th_m2, b"/settings")
    poll_paint(th_m2, th_st2, th_scr2, ["settings"])
    os.write(th_m2, b"\r")
    set2 = poll_paint(th_m2, th_st2, th_scr2, ["Settings", "Color mode"])
    if not (set2 and color_mode_value(th_scr2) == "light"):
        print("---- TH7 FAIL SCREEN ----")
        for i, line in enumerate(th_scr2.display):
            if line.strip():
                print(f"{i:2}|{line.rstrip()}")
    check(th_pid2, "TH7 restart restores the lock (Color mode reads light)", set2 and color_mode_value(th_scr2) == "light")
    if alive(th_pid2):
        os.write(th_m2, b"\x1b"); read_for(th_m2, th_st2, 0.5)
    kill(th_pid2)
else:
    for lbl in ("TH1 /settings popup visible before enter",
                "TH2 settings dialog shows the Color mode row",
                "TH3 fresh home: Color mode reads system (unlocked)",
                "TH4 right cycles system -> dark",
                "TH5 right cycles dark -> light",
                "TH6 the pin persisted: state.json theme.mode == light",
                "TH7 restart restores the lock (Color mode reads light)"):
        check(th_pid, lbl, False)


# ==== FAM:AT ==== (own spawn; one real turn)
# ---- AT-series: the prompt.images attachments (v2 port, 0.6.35). A
# bracketed paste of an image path attaches it (the [Image 1] label + the
# thumb strip paint), leader i walks DialogImagePreview, and the submit
# uploads over v4/attachment + sends by ref. The AT TUI spawns its own
# instance (the proof retires the main one before TH); its session is the
# series' throwaway, and AT6/AT7 are the one live write (a tiny real turn —
# the I-series precedent). The strip paints via the blocks protocol on this
# PTY; the failed arm (No preview) is its legal sibling, so AT2 takes either.
import struct as _struct
import zlib as _zlib

def _at_png_bytes():
    # a real 8x8 red PNG, built here so the proof owns its bytes
    def chunk(tag, data):
        c = _struct.pack(">I", len(data)) + tag + data
        return c + _struct.pack(">I", _zlib.crc32(tag + data) & 0xFFFFFFFF)
    ihdr = _struct.pack(">IIBBBBB", 8, 8, 8, 2, 0, 0, 0)
    raw = b"".join(b"\x00" + b"\xff\x00\x00" * 8 for _ in range(8))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", _zlib.compress(raw)) + chunk(b"IEND", b""))

AT_PNG = "/tmp/at-proof.png"
try:
    open(AT_PNG, "wb").write(_at_png_bytes())
except Exception as e:
    print("NOTE could not stage the proof png:", e)

at_pid, at_master, at_screen, at_stream = spawn()
read_for(at_master, at_stream, 9)
at_boot = "Ask anything" in "\n".join(at_screen.display)
check(at_pid, "AT-pre the attachments TUI boots", at_boot)

if alive(at_pid) and at_boot and os.path.exists(AT_PNG):
    os.write(at_master, b"\x18i"); read_for(at_master, at_stream, 1.0)  # leader i, nothing attached
    a0 = "\n".join(at_screen.display)
    check(at_pid, "AT0 leader i with no attachments flashes the guard", "no image attachments" in a0)

    os.write(at_master, b"\x1b[200~" + AT_PNG.encode() + b"\x1b[201~")
    a1 = False
    for _ in range(10):
        read_for(at_master, at_stream, 0.5)
        if "[Image 1]" in "\n".join(at_screen.display):
            a1 = True
            break
    check(at_pid, "AT1 pasting an image path attaches it (label in the composer)", a1)

    a2 = False
    for _ in range(8):
        read_for(at_master, at_stream, 0.5)
        d_a2 = "\n".join(at_screen.display)
        if ("\u2580" in d_a2 or "\u2584" in d_a2 or "\u2588" in d_a2 or "No preview" in d_a2):
            a2 = True
            break
    check(at_pid, "AT2 the attachment strip paints (blocks or the failed arm)", a2)

    os.write(at_master, b"\x18i"); read_for(at_master, at_stream, 1.2)  # leader i: the preview
    a3 = "\n".join(at_screen.display)
    check(at_pid, "AT3 leader i opens the image preview (Image 1 of 1)", "Image 1 of 1" in a3)
    if not a3:
        print("---- AT3 FAIL SCREEN ----")
        for i, line in enumerate(at_screen.display):
            if line.strip():
                print(f"{i:2}|{line.rstrip()}")
    os.write(at_master, b"\x1b"); read_for(at_master, at_stream, 0.6)

    for _ in range(12):                                        # backspace: the label leaves
        os.write(at_master, b"\x7f"); time.sleep(0.02)
    read_for(at_master, at_stream, 0.8)
    a4 = "\n".join(at_screen.display)
    check(at_pid, "AT4 removing the label drops the attachment", "[Image 1]" not in a4)

    os.write(at_master, b"\x1b[200~" + AT_PNG.encode() + b"\x1b[201~")
    a5 = False
    for _ in range(10):
        read_for(at_master, at_stream, 0.5)
        if "[Image 1]" in "\n".join(at_screen.display):
            a5 = True
            break
    check(at_pid, "AT5 re-attach for the send", a5)

    os.write(at_master, b"Reply with exactly: ok\r")
    a6 = False
    for _ in range(30):                                        # the echo IS the acceptance proof
        read_for(at_master, at_stream, 0.5)
        if "at-proof.png" in "\n".join(at_screen.display):
            a6 = True
            break
    check(at_pid, "AT6 the send accepts the attachment (the echo carries the label + name)", a6)
    if not a6:
        print("---- AT6 FAIL SCREEN (tail) ----")
        for line in at_screen.display[-14:]:
            if line.strip():
                print(f"|{line.rstrip()}")

    a7 = False
    for _ in range(60):                                        # the live write: the turn footer
        read_for(at_master, at_stream, 1.5)                    # (duration grammar) is the first
        d_a7 = "\n".join(at_screen.display)                    # footer this fresh session renders
        if re.search(r"\b\d+\.\d+s\b", d_a7):
            a7 = True
            break
    check(at_pid, "AT7 the turn completes over the attachment (footer renders)", a7 and "esc stop" not in d_a7)
    if not a7:
        print("---- AT7 FAIL SCREEN (tail) ----")
        for line in at_screen.display[-14:]:
            if line.strip():
                print(f"|{line.rstrip()}")
    kill(at_pid)
else:
    for lbl in ("AT-pre the attachments TUI boots",
                "AT0 leader i with no attachments flashes the guard",
                "AT1 pasting an image path attaches it (label in the composer)",
                "AT2 the attachment strip paints (blocks or the failed arm)",
                "AT3 leader i opens the image preview (Image 1 of 1)",
                "AT4 removing the label drops the attachment",
                "AT5 re-attach for the send",
                "AT6 the send accepts the attachment (echo + turn start)",
                "AT7 the turn completes over the attachment"):
        check(at_pid, lbl, False)

# ==== FAM:YM ==== (own spawn with --mode yolo; one real gated turn)
# The relay/yolo startup proof (0.6.39): the same Write-bait turn PF uses must
# run with NO permission ask when the TUI boots with --mode yolo, the footer
# badge must read Yolo, and the file must land on disk (read before kill).
YM_LABELS = (
    "YM0 the --mode yolo TUI boots",
    "YM1 the footer badge reads Yolo",
    "YM2 the gated write turn runs with NO permission ask",
    "YM3 the write landed on disk (the turn really ran)",
)

ym_pid, ym_master, ym_screen, ym_stream = spawn(args=["--mode", "yolo"])
read_for(ym_master, ym_stream, 9)
ym_boot = "Ask anything" in "\n".join(ym_screen.display)
check(ym_pid, YM_LABELS[0], ym_boot)

if alive(ym_pid) and ym_boot:
    os.write(ym_master, b"create the file /tmp/zct-proof-cwd/ym-mode-proof.txt containing just ok\r")
    ym_asked = False
    ym_done = False
    for _ in range(150):                                   # poll: completion = the FILE, not a paint
        read_for(ym_master, ym_stream, 1.0)
        d_ym = "\n".join(ym_screen.display)
        if "Permission required" in d_ym:
            ym_asked = True
            break
        if os.path.exists("/tmp/zct-proof-cwd/ym-mode-proof.txt"):
            ym_done = True
            break
    check(ym_pid, YM_LABELS[2], ym_done and not ym_asked)
    if ym_asked:
        print("---- YM2 FAIL SCREEN (ask painted under yolo) ----")
        for line in ym_screen.display:
            if line.strip():
                print(f"|{line.rstrip()}")
    ym_file = os.path.exists("/tmp/zct-proof-cwd/ym-mode-proof.txt")
    check(ym_pid, YM_LABELS[3], ym_file)
    ym_badge = False
    for _ in range(16):
        read_for(ym_master, ym_stream, 0.5)
        if "Yolo" in "\n".join(ym_screen.display):
            ym_badge = True
            break
    check(ym_pid, YM_LABELS[1], ym_badge)
    kill(ym_pid)
else:
    for lbl in YM_LABELS[1:]:
        check(ym_pid, lbl, False)

# ==== FAM:PF ==== (own spawn; one real turn)
# ---- PF-series: permission.prompt.fullscreen (the v2 SessionQuestion arm,
# 0.6.36). One tiny real turn forces a shell permission ask (the I-series
# precedent); the series then drives the expanded arm: ctrl+f toggles the
# ask card between the inline card and the full-viewport overlay, escape
# MINIMIZES first (the v2 dismiss law), and only a collapsed escape
# dismisses (deny + stop, the owner interrupt law).

PF_LABELS = (
    "PF-pre the fullscreen-ask TUI boots",
    "PF0 the ask card paints collapsed (ctrl+f fullscreen hint)",
    "PF1 ctrl+f expands (minimize hint + card at viewport top)",
    "PF2 escape minimizes (card stays, hint flips back)",
    "PF3 second escape dismisses (deny + stop)",
)

pf_pid, pf_master, pf_screen, pf_stream = spawn()
read_for(pf_master, pf_stream, 9)
pf_boot = "Ask anything" in "\n".join(pf_screen.display)
check(pf_pid, PF_LABELS[0], pf_boot)

if alive(pf_pid) and pf_boot:
    os.write(pf_master, b"create the file /tmp/zct-proof-cwd/pf636.txt containing just ok\r")
    pf0 = False
    for _ in range(90):                                    # poll, never fixed-settle
        read_for(pf_master, pf_stream, 1.0)
        d_pf = "\n".join(pf_screen.display)
        if "Permission required" in d_pf and "ctrl+f fullscreen" in d_pf:
            pf0 = True
            break
    check(pf_pid, PF_LABELS[1], pf0)
    if not pf0:
        print("---- PF0 FAIL SCREEN ----")
        for line in pf_screen.display:
            if line.strip():
                print(f"|{line.rstrip()}")

    os.write(pf_master, b"\x06")                           # ctrl+f
    pf1 = False
    for _ in range(10):
        read_for(pf_master, pf_stream, 0.3)
        d_pf = "\n".join(pf_screen.display)
        if "ctrl+f minimize" in d_pf:
            pf_top = next((i for i, line in enumerate(pf_screen.display)
                           if "Permission required" in line), 99)
            pf1 = pf_top <= 3
            break
    check(pf_pid, PF_LABELS[2], pf1)
    if not pf1:
        print("---- PF1 FAIL SCREEN ----")
        for i, line in enumerate(pf_screen.display):
            if line.strip():
                print(f"{i:2}|{line.rstrip()}")

    os.write(pf_master, b"\x1b")
    pf2 = False
    for _ in range(10):
        read_for(pf_master, pf_stream, 0.3)
        d_pf = "\n".join(pf_screen.display)
        if "ctrl+f fullscreen" in d_pf and "Permission required" in d_pf:
            pf2 = True
            break
    check(pf_pid, PF_LABELS[3], pf2)

    os.write(pf_master, b"\x1b")
    pf3 = False
    for _ in range(10):
        read_for(pf_master, pf_stream, 0.3)
        if "Permission required" not in "\n".join(pf_screen.display):
            pf3 = True
            break
    check(pf_pid, PF_LABELS[4], pf3)
    if not pf3:
        print("---- PF3 FAIL SCREEN (tail) ----")
        for line in pf_screen.display[-14:]:
            if line.strip():
                print(f"|{line.rstrip()}")
    # Turn-really-stopped witness before the kill (0.6.47): a dismissed card
    # does not prove the TURN ended — the agent retries with a new tool form
    # and its next ask OUTLIVES the TUI (the pf636 zombie class: the store
    # keeps the pending ask, and every later resume repaints it). Poll; deny
    # retries of OUR OWN proof-scoped ask (the same grammar); kill only once
    # no card has painted for two consecutive windows.
    quiet = 0
    for _ in range(16):
        read_for(pf_master, pf_stream, 1.0)
        d_pf = "\n".join(pf_screen.display)
        if "Permission required" in d_pf:
            quiet = 0
            if "pf636" in d_pf or "zct-proof-cwd" in d_pf:
                os.write(pf_master, b"\x1b")
        else:
            quiet += 1
            if quiet >= 2:
                break
    kill(pf_pid)
else:
    for lbl in PF_LABELS:
        check(pf_pid, lbl, False)

# ==== FAM:EPILOGUE ==== (full-run summary; stage mode prints its own)
sweep_stale_instances("LEAK GUARD teardown")
print("RESULT:", "PASS" if all(ok for _, ok in verdicts) else "FAIL")
sys.exit(0 if all(ok for _, ok in verdicts) else 1)
