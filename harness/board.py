#!/usr/bin/env python3
"""The board: who is queued, in progress, landed - derived, never hand-written.

Usage: python3 harness/board.py [--html]

Sources of truth:
- docs/tasks/*.md briefs (the queue)
- git branches / worktrees (work in progress)
- `git log main --merges`, subjects starting `Merge task/<name>` (what landed)
- `orca worktree ps` when reachable (who is LIVE - shown as decoration only)

States per brief: QUEUED (no branch) -> NOT STARTED (branch, zero ahead,
clean) -> IN PROGRESS (ahead > 0 or dirty) -> DONE (merge subject on main).
A fast-forwarded branch (zero ahead, unmerged, commits reachable from main)
prints as ANOMALY: merge it with --no-ff or repair the merge commit.

Cannot-look conditions exit 2 and say where this script looked.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from preflight import parse_header  # noqa: E402


def git(args, cwd=REPO):
    r = subprocess.run(["git"] + args, cwd=str(cwd), capture_output=True, text=True)
    return r.returncode, r.stdout.strip()


def merged_tasks():
    rc, out = git(["log", "main", "--merges", "--pretty=%s"])
    if rc != 0:
        die("cannot read git log of main in %s" % REPO)
    names = set()
    for subject in out.splitlines():
        m = re.match(r"Merge task/([\w-]+)", subject) or re.match(
            r"Merge pull request #\d+ from .*/task/([\w-]+)$", subject)
        if m:
            names.add(m.group(1))
    return names


def branch_state(name, fields, merged):
    branch = fields.get("branch", "task/" + name)
    if name in merged:
        return "DONE", ""
    rc, _ = git(["rev-parse", "--verify", "--quiet", branch])
    if rc != 0:
        return "QUEUED", ""
    rc, ahead = git(["rev-list", "--count", "main.." + branch])
    ahead = int(ahead) if rc == 0 and ahead.isdigit() else 0
    dirty = False
    wt = fields.get("worktree")
    if wt:
        wt_path = Path(wt).expanduser()
        if not wt_path.is_absolute():
            wt_path = REPO / wt_path  # never the invoker's cwd
        if wt_path.is_dir():
            rc, status = git(["status", "--porcelain"], cwd=wt_path)
            dirty = rc == 0 and bool(status)
    if ahead > 0 or dirty:
        return "IN PROGRESS", "+%d%s" % (ahead, " dirty" if dirty else "")
    # A branch with zero unique commits is either fresh (NOT STARTED) or was
    # fast-forwarded into main (ANOMALY - the board cannot see ff merges). The
    # mandatory claim commit is the distinguisher: worked branches always have
    # one, fresh branches never do.
    rc, claim = git(["log", branch, "--pretty=%s", "--fixed-strings",
                     "--grep", "claim: task/" + name, "-n", "1"])
    rc2, _ = git(["merge-base", "--is-ancestor", branch, "main"])
    if rc == 0 and claim and rc2 == 0 and name not in merged:
        return "ANOMALY", "worked branch reachable from main without a Merge task/%s subject (fast-forward?)" % name
    return "NOT STARTED", ""


def live_worktrees():
    try:
        r = subprocess.run(["orca", "worktree", "ps", "--json"],
                           capture_output=True, text=True, timeout=10)
        if r.returncode != 0:
            return {}
        data = json.loads(r.stdout.encode().decode("utf-8-sig"))
        rows = data.get("result", {}).get("worktrees", []) or []
        return {Path(w.get("path", "")).name: w.get("agentState", "?") for w in rows}
    except Exception:
        return {}


def die(msg):
    print("BOARD CANNOT LOOK: %s" % msg)
    sys.exit(2)


def collect():
    tasks_dir = REPO / "docs" / "tasks"
    if not tasks_dir.is_dir():
        die("no docs/tasks/ in %s" % REPO)
    merged = merged_tasks()
    live = live_worktrees()
    rows = []
    for p in sorted(tasks_dir.glob("*.md")):
        if p.stem == "README":
            continue
        fields, _ = parse_header(p.read_text(encoding="utf-8"))
        if fields is None:
            rows.append((p.stem, "NO HEADER", "not dispatchable", ""))
            continue
        state, note = branch_state(p.stem, fields, merged)
        rows.append((p.stem, state, note, live.get(p.stem, "")))
    return rows


ORDER = ["IN PROGRESS", "ANOMALY", "NO HEADER", "NOT STARTED", "QUEUED", "DONE"]


def render_text(rows):
    rows = sorted(rows, key=lambda r: ORDER.index(r[1]))
    width = max([len(r[0]) for r in rows] + [4])
    lines = []
    for name, state, note, agent in rows:
        extra = " ".join(x for x in (note, ("agent:" + agent) if agent else "") if x)
        lines.append("%-*s  %-12s %s" % (width, name, state, extra))
    return "\n".join(lines) if lines else "board: no briefs in docs/tasks/"


def render_html(rows):
    color = {"DONE": "#3fb950", "IN PROGRESS": "#d29922", "QUEUED": "#8b949e",
             "NOT STARTED": "#8b949e", "ANOMALY": "#f85149", "NO HEADER": "#f85149"}
    trs = "\n".join(
        '<tr><td>%s</td><td style="color:%s;font-weight:600">%s</td><td>%s</td><td>%s</td></tr>'
        % (n, color.get(s, "#000"), s, note, agent)
        for n, s, note, agent in sorted(rows, key=lambda r: ORDER.index(r[1]))
    )
    return ("<!doctype html><meta charset=utf-8><title>board</title>"
            "<style>body{font:14px ui-monospace,monospace;background:#0d1117;color:#c9d1d9;"
            "padding:2em}table{border-collapse:collapse}td{padding:.3em 1.2em .3em 0}</style>"
            "<h3>%s</h3><table>%s</table>" % (REPO.name, trs))


def main(argv):
    rows = collect()
    print(render_text(rows))
    if "--html" in argv:
        out = REPO / "docs" / "harness" / "board.html"
        out.write_text(render_html(rows), encoding="utf-8")
        print("\nwrote %s" % out)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
