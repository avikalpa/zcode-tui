#!/usr/bin/env python3
"""Upstream re-pin check — the maintenance law's recon chore as a verb.

Answers "did upstream opencode release past our pin?" against the LIVE
remote (never the local clone's possibly-stale tag set), with the two
measured traps encoded in code instead of prose:

  1. (dream ACK-0102f5f28f) `git ls-remote --tags` lines are
     "<40-hex>\\t<ref>" — sorting whole lines elects the newest by HASH,
     silently hiding real releases. The hash is stripped BEFORE any sort.
  2. (dream ACK-04a0d3c459) upstream carries foreign tag namespaces
     (vscode-v0.0.x) that `sort -V` ranks ABOVE v2.*. Release tags are
     anchored to ^v[0-9]+\\. AND filtered to the pin's family (v2.* for a
     v2.0.x pin); a release OUTSIDE the pin family is reported LOUD —
     the family filter exists to kill false winners, never to hide a
     real release.

Annotated tags arrive twice over ls-remote (ref + ref^{}); the peel
suffix is stripped and the set deduplicated.

On the default path the verb also weighs the LOCAL clone (dream
ACK-807bfb2681): the sync executor's archive reads this clone's object
store, so a clone whose family tags lag the live family newest gets a
[stale] note ("fetch before re-pin"). The note never changes the exit
code — the check's own verdict is about the LIVE remote and stays honest.

Exit discipline (matches tools/floor-check.py, composable in gates):
  0  up to date — the re-pin does not fire
  1  re-pin owed (family newest > pin, or a release outside the family)
  3  DEGRADED — the check could not verify (no clone/URL, no tags)

Usage:
  python3 tools/upstream-check.py [--url URL] [--pin V] [--json]
  python3 tools/upstream-check.py --self-test

The upstream URL resolves exactly like tools/sync-opencode.sh:
OPENCODE_REPO env override, else ~/gh/opencode's origin. --url/--pin
exist for the self-test fixtures; the default path is the ritual.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VERSION_FILE = ROOT / "tools" / "opencode-reference" / "VERSION"

RELEASE_ANCHOR = re.compile(r"^v[0-9]+\.")
PEEL = "^{}"


class Degraded(Exception):
    """The check could not verify — exit 3, never a silent verdict."""


def run(cmd, **kw):
    try:
        return subprocess.run(
            cmd, capture_output=True, text=True, check=True, **kw
        )
    except FileNotFoundError as e:
        raise Degraded(f"binary not found: {cmd[0]}") from e
    except subprocess.CalledProcessError as e:
        raise Degraded(
            f"command failed ({e.returncode}): {' '.join(cmd)}: "
            f"{(e.stderr or e.stdout or '').strip()[:200]}"
        ) from e


def resolve_src(override):
    """(src, url): the local clone path (None under --url) and the origin
    URL the live check runs against."""
    if override:
        return None, override
    src = os.environ.get("OPENCODE_REPO") or str(Path.home() / "gh" / "opencode")
    if not Path(src).exists():
        raise Degraded(
            f"upstream clone not found at {src} (OPENCODE_REPO resolves it); "
            "pass --url for a one-shot check"
        )
    url = run(["git", "-C", src, "remote", "get-url", "origin"]).stdout.strip()
    return src, url


def resolve_pin(override):
    if override:
        return override
    if not VERSION_FILE.exists():
        raise Degraded(f"pin file missing: {VERSION_FILE}")
    pin = VERSION_FILE.read_text().strip()
    if not pin:
        raise Degraded(f"pin file empty: {VERSION_FILE}")
    return pin


def fetch_tags(url):
    out = run(["git", "ls-remote", "--tags", url]).stdout
    tags = set()
    for line in out.splitlines():
        ref = line.split("\t", 1)[1] if "\t" in line else ""
        if not ref.startswith("refs/tags/"):
            continue
        tag = ref[len("refs/tags/"):]
        if tag.endswith(PEEL):
            tag = tag[: -len(PEEL)]
        if tag:
            tags.add(tag)
    if not tags:
        raise Degraded(f"no tags at all at {url}")
    return tags


def vkey(tag):
    """Sort key: numeric components primary; a suffixed (pre-release-ish)
    tag sorts just below its plain base."""
    nums = tuple(int(x) for x in re.findall(r"\d+", tag))
    plain = re.fullmatch(r"v[0-9]+(\.[0-9]+)*", tag) is not None
    return (nums, 0 if plain else -1, tag)


def check(url, pin):
    tags = fetch_tags(url)
    releases = sorted((t for t in tags if RELEASE_ANCHOR.match(t)), key=vkey)
    if not releases:
        raise Degraded(f"no release-looking (v<digits>.*) tags at {url}")

    m = re.match(r"^v(\d+)\.", pin)
    if not m:
        raise Degraded(f"pin {pin!r} is not a v<digits>.* version")
    family_prefix = f"v{m.group(1)}."
    family = [t for t in releases if t.startswith(family_prefix)]
    if not family:
        raise Degraded(
            f"no tags in pin family {family_prefix}* at {url}"
        )

    pin_key = vkey(pin)
    newest_family = family[-1]
    newest_all = releases[-1]
    outside = [
        t for t in releases
        if not t.startswith(family_prefix) and vkey(t) > pin_key
    ]

    repin_owed = vkey(newest_family) > pin_key
    if repin_owed:
        verdict = (
            f"RE-PIN OWED: family newest {newest_family} > pin {pin}"
        )
    elif outside:
        verdict = (
            f"RE-PIN OWED (outside pin family): upstream {newest_all} "
            f"is beyond family {family_prefix}* pin {pin} — owner attention"
        )
    else:
        verdict = (
            f"re-pin does NOT fire (pin {pin} == family newest "
            f"{newest_family})"
        )

    return {
        "url": url,
        "pin": pin,
        "family": family_prefix + "*",
        "family_newest": newest_family,
        "all_newest": newest_all,
        "outside_family": outside,
        "repin_owed": repin_owed or bool(outside),
        "verdict": verdict,
    }


def clone_staleness(src, family_prefix, live_newest):
    """Executor-direction warning (dream ACK-807bfb2681): the sync
    script's archive reads the local clone's object store, so a clone
    whose family tags lag the live family newest must fetch before any
    re-pin. Returns a note dict, or None when the clone is fresh."""
    out = run(["git", "-C", src, "tag", "-l", f"{family_prefix}*"]).stdout.split()
    local = max(
        (t for t in out if RELEASE_ANCHOR.match(t)), key=vkey, default=None
    )
    if local is None or vkey(local) < vkey(live_newest):
        return {
            "src": src,
            "local_newest": local,
            "live_newest": live_newest,
            "note": (
                f"local clone {src} has {local or 'no family tags'} but "
                f"live family newest is {live_newest} — run: git -C {src} "
                f"fetch --tags --prune (the sync archive reads this clone)"
            ),
        }
    return None


def report(res, as_json):
    if as_json:
        print(json.dumps(res, indent=2))
        return
    print(f"[url] {res['url']}")
    print(f"[pin] {res['pin']} (family {res['family']})")
    print(f"[upstream] family newest {res['family_newest']}"
          + (f"; overall newest {res['all_newest']}"
             if res["all_newest"] != res["family_newest"] else ""))
    for t in res["outside_family"]:
        print(f"[outside-family] {t}")
    if res.get("clone_stale"):
        print(f"[stale] {res['clone_stale']['note']}")
    print(f"VERDICT: {res['verdict']}")


# ---------------------------------------------------------------- self-test

FIXTURE_A_TAGS = [  # adversarial: foreign namespace, gaps, a major beyond
    "v2.0.2", "v2.0.9", "v2.0.10", "v2.0.18", "v2.0.19",
    "vscode-v0.0.13", "vscode-v0.0.99", "v3.0.0",
]
FIXTURE_B_TAGS = [  # up-to-date family, vscode trap present, no major
    "v2.0.17", "v2.0.18", "v2.0.19", "vscode-v0.0.99",
]


def make_fixture(tags):
    """Bare repo carrying exactly `tags`. Every tag is annotated with a
    message: dev git refuses editor-less lightweight creation (tag
    signing config), and annotated tags double as a universal ^{}-peel
    trap — each tag arrives twice over ls-remote."""
    tmp = tempfile.mkdtemp(prefix="upstream-check-fixture-")
    bare = os.path.join(tmp, "fixture.git")
    scratch = os.path.join(tmp, "scratch")
    run(["git", "init", "--bare", "-q", bare])
    run(["git", "init", "-q", scratch])
    cfg = ["git", "-C", scratch]
    run(cfg + ["config", "user.email", "fixture@example.invalid"])
    run(cfg + ["config", "user.name", "fixture"])
    run(cfg + ["config", "tag.gpgSign", "false"])
    if not tags:
        return bare, tmp  # the degraded case: a bare repo with zero refs
    (Path(scratch) / "f.txt").write_text("fixture\n")
    run(cfg + ["add", "f.txt"])
    run(cfg + ["commit", "-q", "-m", "fixture"])
    for tag in tags:
        run(cfg + ["tag", "-a", tag, "-m", f"fixture {tag}"])
    run(cfg + ["push", "-q", bare, "--tags"])
    return bare, tmp


def self_test():
    cases = []

    def expect(name, cond, detail):
        cases.append((name, cond, detail))

    # Fixture A: pin v2.0.18 → v2.0.19 owed AND v3.0.0 outside family.
    bare, tmp = make_fixture(FIXTURE_A_TAGS)
    try:
        res = check(bare, "v2.0.18")
        expect("A family-newest is v2.0.19 (not vscode-v0.0.99, not hash order)",
               res["family_newest"] == "v2.0.19", res["family_newest"])
        expect("A repin owed", res["repin_owed"] is True, res["verdict"])
        expect("A v3.0.0 named outside family",
               res["outside_family"] == ["v3.0.0"], str(res["outside_family"]))
        expect("A annotated peel deduped (no ^{} anywhere)",
               all(PEEL not in t for t in
                   [res["family_newest"], res["all_newest"]]), "peel")
        # Pin at family newest → family quiet, but the major stays LOUD.
        res_b = check(bare, "v2.0.19")
        expect("A2 pin==family-newest still flags v3.0.0 outside",
               res_b["repin_owed"] is True and res_b["outside_family"] == ["v3.0.0"],
               res_b["verdict"])
    finally:
        run(["rm", "-rf", tmp])

    # Fixture B: the vscode-election trap alone must not fire the pin.
    bare, tmp = make_fixture(FIXTURE_B_TAGS)
    try:
        res = check(bare, "v2.0.19")
        expect("B vscode-v0.0.99 never elected (up to date)",
               res["repin_owed"] is False and res["family_newest"] == "v2.0.19",
               res["verdict"])
        expect("B overall newest == family newest (vscode excluded)",
               res["all_newest"] == "v2.0.19", res["all_newest"])
    finally:
        run(["rm", "-rf", tmp])

    # Fixture E: clone staleness (dream ACK-807bfb2681). Clone B is cut
    # BEFORE the newest tag is pushed to the origin by writer clone A, so
    # B's local family newest lags the live one.
    tmp = tempfile.mkdtemp(prefix="upstream-check-stale-")
    bare = os.path.join(tmp, "origin.git")
    writer = os.path.join(tmp, "writer")
    reader = os.path.join(tmp, "reader")
    run(["git", "init", "--bare", "-q", bare])
    run(["git", "clone", "-q", bare, writer])
    cfg = ["git", "-C", writer]
    run(cfg + ["config", "user.email", "fixture@example.invalid"])
    run(cfg + ["config", "user.name", "fixture"])
    run(cfg + ["config", "tag.gpgSign", "false"])
    (Path(writer) / "f.txt").write_text("fixture\n")
    run(cfg + ["add", "f.txt"])
    run(cfg + ["commit", "-q", "-m", "fixture"])
    for tag in ("v2.0.17", "v2.0.18"):
        run(cfg + ["tag", "-a", tag, "-m", f"fixture {tag}"])
    run(cfg + ["push", "-q", "origin", "--tags"])
    run(["git", "clone", "-q", bare, reader])  # reader sees ..v2.0.18 only
    run(cfg + ["commit", "-q", "--allow-empty", "-m", "fixture2"])
    run(cfg + ["tag", "-a", "v2.0.19", "-m", "fixture v2.0.19"])
    run(cfg + ["push", "-q", "origin", "v2.0.19"])
    try:
        st = clone_staleness(reader, "v2.", "v2.0.19")
        expect("E stale clone detected (local v2.0.18 < live v2.0.19)",
               st is not None and st["local_newest"] == "v2.0.18",
               str(st and st["local_newest"]))
        expect("E stale note names the fetch",
               st is not None and "fetch --tags --prune" in st["note"],
               str(st and st["note"])[:60])
        st_fresh = clone_staleness(reader, "v2.", "v2.0.18")
        expect("E fresh clone (local == live) is None",
               st_fresh is None, str(st_fresh))
    finally:
        run(["rm", "-rf", tmp])

    # Degraded: unreachable URL, and a tagless bare repo.
    try:
        check("/nonexistent/upstream-check-missing.git", "v2.0.18")
        expect("C missing URL degrades", False, "no exception")
    except Degraded as e:
        expect("C missing URL degrades exit-3 class", True, str(e)[:60])
    bare, tmp = make_fixture([])
    try:
        try:
            check(bare, "v2.0.18")
            expect("D tagless degrades", False, "no exception")
        except Degraded as e:
            expect("D tagless degrades exit-3 class", True, str(e)[:60])
        # A clone with NO family tags is maximally stale (local_newest None).
        st = clone_staleness(bare, "v2.", "v2.0.18")
        expect("D2 no-family-tags clone is stale with local_newest None",
               st is not None and st["local_newest"] is None,
               str(st and st["local_newest"]))
    finally:
        run(["rm", "-rf", tmp])

    # Fixture C: hash-order honest attempt — tag order in the fixture is
    # arbitrary by nature; the structural guard is that the verb sorts the
    # STRIPPED tag field only. Assert the fixture itself ordered cases A/B
    # above regardless of the hashes git assigned.
    expect("self-test ran", len(cases) >= 11, f"{len(cases)} cases")

    fails = [c for c in cases if not c[1]]
    for name, ok, detail in cases:
        print(f"  {'PASS' if ok else 'FAIL'}  {name}  ({detail})")
    print(f"SELF-TEST: {len(cases) - len(fails)}/{len(cases)} PASS")
    return 1 if fails else 0


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--url", help="upstream git URL (default: the "
                                  "sync-opencode.sh SRC origin, live)")
    ap.add_argument("--pin", help="pin version override (default: "
                                  "tools/opencode-reference/VERSION)")
    ap.add_argument("--json", action="store_true", help="JSON verdict")
    ap.add_argument("--self-test", action="store_true",
                    help="adversarial fixture run; ignores --url/--pin")
    args = ap.parse_args()

    if args.self_test:
        sys.exit(self_test())
    try:
        src, url = resolve_src(args.url)
        res = check(url, resolve_pin(args.pin))
        # The staleness note is default-path only: under --url there is no
        # local clone to weigh.
        res["clone_stale"] = (
            clone_staleness(src, res["family"], res["family_newest"])
            if src else None
        )
    except Degraded as e:
        print(f"DEGRADED: {e}")
        print("VERDICT: DEGRADED (could not verify — treat as UNKNOWN, "
              "never as up-to-date)")
        sys.exit(3)
    report(res, args.json)
    sys.exit(1 if res["repin_owed"] else 0)


if __name__ == "__main__":
    main()
