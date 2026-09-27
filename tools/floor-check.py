#!/usr/bin/env python3
"""floor-check — the campaign floor-liveness ritual as ONE verb.

Born as dream ACK-ea391349cf (R50 takeover-close sitting): the 4-probe
ritual — board tail since the claim, live pty-proof|bun|launcher processes
on the work host, worktree status + mtimes, proof-log tail scan — was
hand-assembled from door text by every seat every sitting (R38 wrote it,
R39/R43/R48/R50 re-ran it; one seat assembled it twice in a sitting). This
verb runs all four probes in one shot on the WORK HOST beside the worktree
and prints a HOT/COLD verdict with the evidence lines.

    python3 tools/floor-check.py WORKTREE [--board infra/meta]
        [--lane-marker STR] [--claim-ack ACK] [--self-ack ACK]
        [--since-hours H] [--fresh-minutes M] [--logs-glob GLOB]
        [--wait-window MIN] [--poll SEC] [--json]

Probes:
  procs   live processes matching pty-proof | bun | launch.sh (ps -eo,
          word-boundary bun; own pid tree and anything floor-check never
          counts). A live proof/bun run means dist/ is mid-race — HOT.
  tree    git status (dirty count, branch, ahead/behind) + newest file
          mtime under the worktree (.git/node_modules/dist pruned). A
          fresher-than --fresh-minutes mtime means a seat is mid-edit — HOT.
  logs    newest /tmp proof/launcher log (--logs-glob) + its last line.
          Fresher than --fresh-minutes means a run is firing or just did — HOT;
          a terminal verdict line (RESULT: / WAVE LAW: / SUPERVISION INVALID)
          marks a COMPLETED run and does not vote HOT on freshness alone
          (a finished launcher is designed death, not liveness).
  board   msgboard tail since --since-hours filtered to --lane-marker;
          computes silence-since-last-word and whether a claim-class post
          (note/hold/blocked/veto) sits UNANSWERED. Only answer-kind posts
          (OUTCOMEs) CLOSE, and they close a warm post they cite or share
          a thread ref with (the progress inherits its claim's outcome);
          the warm post's own citations never close it. OUTCOME posts
          often drop the full lane refspec, so closers are matched
          board-wide, not just on marker posts. Warnings/corrections are
          advisory, not hot.
          --self-ack excludes the caller's own claim (a seat re-checking
          its own floor must not flag itself). --claim-ack narrows the
          probe to one thread (transitively: the post and everything
          citing it).

Verdict/exit: 0 COLD, 1 HOT, 3 DEGRADED (computed COLD but >=1 probe
could not run — treat as UNKNOWN, never as a clean cold). --wait-window
MIN re-runs the probes every --poll SEC until COLD or the window expires
(compact one-line polls; full evidence on the final verdict only — the
hail -> HOLD -> takeover LADDER STAYS POLICY: this verb only waits and
reports, it never posts and never takes over).

Stdlib only by law: floor-check must run before pty-proof (which imports
pyte) and on any host, in any venv.
"""
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone

DEFAULT_LANE_MARKER = "lane/zcode-tui/ux-parity"
DEFAULT_LOGS_GLOB = "/tmp/*proof*.log"
PRUNE_DIRS = {".git", "node_modules", "dist", "__pycache__", "target"}
WARM_KINDS = {"note", "hold", "blocked", "veto"}
CLOSE_KINDS = {"answer"}
ADVISORY_KINDS = {"warning", "correction", "question"}


def _die(msg, code=2):
    print("floor-check: %s" % msg, file=sys.stderr)
    sys.exit(code)


def _parse_opts(argv):
    opts = {
        "worktree": None, "board": "infra/meta", "lane_marker": DEFAULT_LANE_MARKER,
        "claim_ack": None, "self_ack": None, "since_hours": 24.0,
        "fresh_minutes": 20.0, "logs_glob": DEFAULT_LOGS_GLOB,
        "wait_window": 0.0, "poll": 60.0, "json": False,
    }
    i = 0
    while i < len(argv):
        a = argv[i]
        if not a.startswith("-") and opts["worktree"] is None:
            opts["worktree"] = a
            i += 1
        elif a == "--board":
            opts["board"] = argv[i + 1]; i += 2
        elif a == "--lane-marker":
            opts["lane_marker"] = argv[i + 1]; i += 2
        elif a == "--claim-ack":
            opts["claim_ack"] = argv[i + 1]; i += 2
        elif a == "--self-ack":
            opts["self_ack"] = argv[i + 1]; i += 2
        elif a == "--since-hours":
            opts["since_hours"] = float(argv[i + 1]); i += 2
        elif a == "--fresh-minutes":
            opts["fresh_minutes"] = float(argv[i + 1]); i += 2
        elif a == "--logs-glob":
            opts["logs_glob"] = argv[i + 1]; i += 2
        elif a == "--wait-window":
            opts["wait_window"] = float(argv[i + 1]); i += 2
        elif a == "--poll":
            opts["poll"] = float(argv[i + 1]); i += 2
        elif a == "--json":
            opts["json"] = True; i += 1
        elif a in ("-h", "--help"):
            print(__doc__); sys.exit(0)
        else:
            _die("unknown argument %r" % a)
    if not opts["worktree"]:
        _die("WORKTREE path is required")
    if not os.path.isdir(opts["worktree"]):
        _die("worktree %r is not a directory" % opts["worktree"])
    return opts


def _age_minutes(ts_epoch, now):
    return max(0.0, (now - ts_epoch) / 60.0)


def _fmt_age(minutes):
    if minutes < 1.0:
        return "%ds" % int(minutes * 60)
    if minutes < 120.0:
        return "%.1fh" % (minutes / 60.0) if minutes >= 60 else "%dm" % int(minutes)
    return "%.1fh" % (minutes / 60.0)


def probe_procs(now):
    """Live pty-proof / bun / launcher processes (door law pattern)."""
    try:
        out = subprocess.run(
            ["ps", "-eo", "pid,etimes,args"], capture_output=True, text=True, timeout=15
        ).stdout
    except Exception as exc:  # ps missing or killed
        return {"status": "ERROR", "lines": ["[procs] ERROR: ps failed: %s" % exc], "hits": []}
    pat = re.compile(r"pty-proof|\bbun\b|launch\.sh")
    hits = []
    own = {os.getpid(), os.getppid()}
    for line in out.splitlines()[1:]:
        parts = line.strip().split(None, 2)
        if len(parts) < 3:
            continue
        pid, etimes, args = int(parts[0]), int(parts[1]), parts[2]
        if pid in own or "floor-check" in args or "ps -eo" in args:
            continue
        if pat.search(args):
            hits.append({"pid": pid, "age_min": round(etimes / 60.0, 1), "cmd": args[:200]})
    if hits:
        lines = ["[procs] HOT: %d live process(es)" % len(hits)]
        lines += ["[procs]   pid %d (%s old) %s" % (h["pid"], _fmt_age(h["age_min"]), h["cmd"]) for h in hits]
        return {"status": "HOT", "lines": lines, "hits": hits}
    return {"status": "ok", "lines": ["[procs] no live pty-proof/bun/launcher processes"], "hits": []}


def probe_tree(opts, now):
    """git status + newest mtime under the worktree (pruned walk)."""
    wt = opts["worktree"]
    lines, dirty, branch, head, ahead = [], 0, "?", "?", 0
    try:
        st = subprocess.run(["git", "-C", wt, "status", "--porcelain=v1", "-b"],
                            capture_output=True, text=True, timeout=20).stdout.splitlines()
        if st:
            first = st[0]  # branch line
            m = re.match(r"## ([^.\s]+)", first)
            branch = m.group(1) if m else first
            head = subprocess.run(["git", "-C", wt, "rev-parse", "--short", "HEAD"],
                                  capture_output=True, text=True, timeout=10).stdout.strip()
            dirty = sum(1 for l in st[1:] if l.strip())
            ma = re.search(r"\[ahead (\d+)(?:, behind \d+)?\]", first)
            ahead = int(ma.group(1)) if ma else 0
        else:
            dirty = 0
    except Exception as exc:
        return {"status": "ERROR", "lines": ["[tree] ERROR: git failed: %s" % exc],
                "dirty": None, "newest": None}
    newest_path, newest_ts = None, None
    seen = 0
    for root, dirs, files in os.walk(wt):
        dirs[:] = [d for d in dirs if d not in PRUNE_DIRS]
        for f in files:
            seen += 1
            if seen > 50000:
                break
            p = os.path.join(root, f)
            try:
                mt = os.lstat(p).st_mtime
            except OSError:
                continue
            if newest_ts is None or mt > newest_ts:
                newest_ts, newest_path = mt, os.path.relpath(p, wt)
    newest = None
    tree_hot = False
    if newest_ts is not None:
        age = _age_minutes(newest_ts, now)
        newest = {"path": newest_path, "age_min": round(age, 1)}
        # R58 law: liveness is UNCOMMITTED or UNPUSHED work. A clean
        # tree at a synced head is cold no matter how fresh the
        # mtimes are — they belong to committed, pushed history (the
        # R57 SSOT-edit false HOT, posted-OUTCOME floor).
        tree_hot = ahead > 0 or (dirty > 0 and age < opts["fresh_minutes"])
        note = "" if (dirty or ahead) else " (committed, synced)"
        lines.append("[tree] branch %s head %s dirty=%d ahead=%d; newest mtime %s (%s ago)%s%s"
                     % (branch, head, dirty, ahead, newest_path, _fmt_age(age),
                        " — FRESH (< %gm)" % opts["fresh_minutes"] if tree_hot else "",
                        note))
    else:
        lines.append("[tree] branch %s head %s dirty=%d; no files found" % (branch, head, dirty))
    status = "HOT" if tree_hot else "ok"
    return {"status": status, "lines": lines, "dirty": dirty, "branch": branch,
            "head": head, "newest": newest}


def probe_logs(opts, now):
    """Newest proof/launcher log + its last line."""
    try:
        logs = [p for p in glob.glob(opts["logs_glob"]) if os.path.isfile(p)]
    except Exception as exc:
        return {"status": "ERROR", "lines": ["[logs] ERROR: glob failed: %s" % exc], "newest": None}
    if not logs:
        return {"status": "ok", "lines": ["[logs] no logs match %s" % opts["logs_glob"]], "newest": None}
    newest_path, newest_ts = None, None
    for p in logs:
        try:
            mt = os.stat(p).st_mtime
        except OSError:
            continue
        if newest_ts is None or mt > newest_ts:
            newest_ts, newest_path = mt, p
    age = _age_minutes(newest_ts, now)
    hot = age < opts["fresh_minutes"]
    last = ""
    try:
        with open(newest_path, "rb") as fh:
            fh.seek(0, 2)
            size = fh.tell()
            fh.seek(max(0, size - 4096))
            tail = fh.read().decode("utf-8", "replace").strip().splitlines()
            last = tail[-1][:160] if tail else ""
    except OSError:
        pass
    # A terminal verdict line means the newest run FINISHED — freshness
    # alone must not vote HOT on it (a finished launcher is designed
    # death, not liveness; mid-run logs carry no terminal line and keep
    # voting HOT).
    completed = last.startswith(("RESULT:", "STAGE RESULT:", "WAVE LAW:", "SUPERVISION INVALID"))
    line = "[logs] %d log(s) under %s; newest %s (%s ago)" % (
        len(logs), opts["logs_glob"], newest_path, _fmt_age(age))
    if last:
        line += "; last: %s" % last
    if hot:
        line += " — FRESH (< %gm)" % opts["fresh_minutes"]
    if hot and completed:
        line += " — COMPLETED-RUN (terminal verdict; not HOT on freshness alone)"
    status = "HOT" if hot and not completed else "ok"
    return {"status": status, "lines": [line],
            "newest": {"path": newest_path, "age_min": round(age, 1)},
            "completed_run": completed}


def _board_cmd():
    """msgboard CLI: PATH first, then the known install homes — the board
    probe must work under NON-INTERACTIVE ssh, where ~/.local/bin is
    typically off PATH (measured on dev, 0.6.66 sitting)."""
    env = os.environ.get("MSGBOARD")
    if env:
        return env
    found = shutil.which("msgboard")
    if found:
        return found
    home = os.path.expanduser("~")
    for cand in (os.path.join(home, ".local", "bin", "msgboard"),
                 os.path.join(home, "data", "msggraph", "bin", "msgboard")):
        if os.path.isfile(cand) and os.access(cand, os.X_OK):
            return cand
    return None


def _load_posts(opts):
    """Read the board tail via msgboard; returns (posts, error)."""
    cmd = _board_cmd()
    if not cmd:
        return None, "msgboard not found (PATH, ~/.local/bin, ~/data/msggraph/bin; or set MSGBOARD)"
    since_iso = (datetime.now(timezone.utc) - timedelta(hours=opts["since_hours"])).strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        out = subprocess.run([cmd, "read", opts["board"], "--since", since_iso],
                             capture_output=True, text=True, timeout=60).stdout
    except Exception as exc:
        return None, "msgboard read failed: %s" % exc
    posts = []
    for line in out.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            raw = json.loads(line)
        except ValueError:
            continue
        ts = raw.get("ts")
        try:
            ts_epoch = datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
        except Exception:
            continue
        frm = raw.get("from") or {}
        posts.append({
            "ack": raw.get("ack_token") or "",
            "ts": ts, "ts_epoch": ts_epoch,
            "kind": raw.get("kind") or "note",
            "body": raw.get("body") or "",
            "refs": raw.get("refs") or [],
            "tags": raw.get("tags") or [],
            "from": "%s/%s" % (frm.get("harness", "?"), str(frm.get("row_uuid", ""))[:12]),
        })
    return posts, None


def _marker_hit(post, marker):
    hay = " ".join([post["body"], " ".join(post["refs"]), " ".join(post["tags"])])
    return marker in hay


def probe_board(opts, now):
    posts, err = _load_posts(opts)
    if posts is None:
        return {"status": "ERROR", "lines": ["[board] ERROR: %s" % err], "open": [], "last": None}
    lane = [p for p in posts if _marker_hit(p, opts["lane_marker"])]
    if opts["claim_ack"]:
        keep = {opts["claim_ack"]}
        for _ in range(3):  # claim <- progress <- outcome depth
            grown = set(keep)
            for p in lane:
                if p["ack"] in keep:
                    grown |= set(p["refs"])  # parents it cites
                if set(p["refs"]) & keep:
                    grown.add(p["ack"])      # children citing it
            keep = grown
        lane = [p for p in lane if p["ack"] in keep]
    lane.sort(key=lambda p: p["ts_epoch"])
    if not lane:
        return {"status": "ok", "lines": ["[board] 0 lane posts on %s matching %r in the last %gh"
                                          % (opts["board"], opts["lane_marker"], opts["since_hours"])],
                "open": [], "last": None}
    # Only ANSWER-kind posts (OUTCOMEs) CLOSE: a warm post is closed when an
    # answer post cites it, or cites something it refs (the progress post
    # inherits its claim's outcome). Citations made BY the warm post itself
    # never close it — a fresh claim that refs the previous wave's outcome
    # for acknowledgment must stay open (all three rules measured 0.6.66:
    # marker-less outcomes, the R53 progress inheritance, this self-cite).
    closers = [p for p in posts if p["kind"] in CLOSE_KINDS]

    def _closed(post):
        for q in closers:
            if q["ack"] == post["ack"]:
                continue
            if post["ack"] in q["refs"]:
                return True
            if set(post["refs"]) & set(q["refs"]):
                return True
        return False

    opens = [p for p in lane
             if p["kind"] in WARM_KINDS and not _closed(p) and p["ack"] != opts["self_ack"]]
    last = lane[-1]
    last_age = _age_minutes(last["ts_epoch"], now)
    lines = ["[board] %d lane post(s) since %s; last word %s (%s/%s, %s ago)"
             % (len(lane), datetime.fromtimestamp(now - opts["since_hours"] * 3600, timezone.utc).strftime("%m-%dT%H:%MZ"),
                last["ack"], last["kind"], last["from"], _fmt_age(last_age))]
    if opens:
        for p in opens:
            lines.append("[board] OPEN: %s (%s/%s, %s ago) — unanswered claim-class post"
                         % (p["ack"], p["kind"], p["from"], _fmt_age(_age_minutes(p["ts_epoch"], now))))
    status = "HOT" if opens else "ok"
    return {"status": status, "lines": lines, "open": [p["ack"] for p in opens],
            "last": {"ack": last["ack"], "kind": last["kind"], "age_min": round(last_age, 1)}}


def run_probes(opts, now):
    return {
        "procs": probe_procs(now),
        "tree": probe_tree(opts, now),
        "logs": probe_logs(opts, now),
        "board": probe_board(opts, now),
    }


def verdict_of(probes):
    errors = [k for k, v in probes.items() if v["status"] == "ERROR"]
    hot = [k for k, v in probes.items() if v["status"] == "HOT"]
    if hot:
        return "HOT", hot, errors
    return ("DEGRADED", hot, errors) if errors else ("COLD", hot, errors)


def main():
    opts = _parse_opts(sys.argv[1:])
    deadline = time.time() + opts["wait_window"] * 60.0
    poll_n = 0
    while True:
        now = time.time()
        probes = run_probes(opts, now)
        verdict, hot_probes, errors = verdict_of(probes)
        poll_n += 1
        waiting = verdict == "HOT" and opts["wait_window"] > 0 and time.time() < deadline
        if opts["json"]:
            print(json.dumps({"verdict": verdict, "hot_probes": hot_probes, "errors": errors,
                              "probes": probes, "ts": datetime.now(timezone.utc).isoformat()},
                             indent=2))
        elif waiting:
            print("floor-check poll %d: HOT (%s) — waiting, %.1f of %gm left"
                  % (poll_n, ",".join(hot_probes) or "no probe", deadline - time.time(),
                     opts["wait_window"]))
        else:
            for v in probes.values():
                for line in v["lines"]:
                    print(line)
            why = ("hot: " + ",".join(hot_probes)) if hot_probes else "no hot probe"
            if errors and verdict != "HOT":
                why += "; DEGRADED probes: " + ",".join(errors)
            print("FLOOR VERDICT: %s (%s)" % (verdict, why))
        if verdict == "COLD" or verdict == "DEGRADED" or opts["wait_window"] <= 0:
            sys.exit({"HOT": 1, "COLD": 0, "DEGRADED": 3}[verdict])
        if time.time() >= deadline:
            print("floor-check: wait window (%gm) expired still HOT" % opts["wait_window"], file=sys.stderr)
            sys.exit(1)
        time.sleep(min(opts["poll"], max(1.0, deadline - time.time())))


if __name__ == "__main__":
    main()
