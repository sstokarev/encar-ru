#!/usr/bin/env python3
"""Start a worker, or refuse because that worktree already has a live agent.

Usage:
  python3 harness/spawn.py --task <task_id> --worktree new-top-level --name <n>
  python3 harness/spawn.py --task <task_id> --worktree path:<abs-path>

Measured 2026-08-08, and it cost real damage. A finished round-1 worker sat
idle at its prompt in task/importer-pricing. A `terminal send` nudge DID reach
it, but the pane tail I read back showed only the idle prompt, so I concluded
the nudge had failed and started a SECOND session in the same worktree. Both
agents then edited the same five files at once and left six failing tests. The
operator killed the second one.

Two lessons, both enforced here rather than remembered:

 1. A worktree may hold at most ONE running agent terminal. Before starting,
    this asks Orca what terminals live there and refuses if any is running.
 2. A pane tail is NOT evidence about whether a prompt landed or whether an
    agent is alive: it is a snapshot that lags and truncates. The working tree
    and the commit log are the evidence. That is why this script never reads
    panes.

Exit 0 prints `SPAWN: OK <dispatch_id>`. Any refusal prints the reason and
exits 1.
"""
import json
import subprocess
import sys


def orca(args):
    r = subprocess.run(["orca"] + args, capture_output=True, text=True)
    out = (r.stdout or "").strip()
    try:
        return json.loads(out.lstrip("﻿"))
    except Exception:
        print("SPAWN: REFUSED unparseable-response - %s" % (out[:160] or r.stderr[:160]))
        sys.exit(1)


def live_agents(worktree_path):
    """Running terminals whose worktree is this path."""
    d = orca(["terminal", "list", "--json"])
    live = []
    for t in (d.get("result") or {}).get("terminals") or []:
        wt = str(t.get("worktreeId") or t.get("worktree") or "")
        if not wt.endswith(worktree_path):
            continue
        if str(t.get("status") or "").lower() in ("exited", "closed"):
            continue
        live.append((t.get("handle"), t.get("title")))
    return live


def main(argv):
    task = worktree = name = None
    repo = None
    i = 0
    while i < len(argv):
        k, v = argv[i], (argv[i + 1] if i + 1 < len(argv) else None)
        if v is None:
            print("SPAWN: REFUSED missing-value - %s" % k); sys.exit(1)
        if k == "--task":
            task = v
        elif k == "--worktree":
            worktree = v
        elif k == "--name":
            name = v
        elif k == "--repo":
            repo = v
        else:
            print("SPAWN: REFUSED bad-argument - %s" % k); sys.exit(1)
        i += 2

    if not task or not worktree:
        print("SPAWN: REFUSED need --task and --worktree"); sys.exit(1)

    if worktree.startswith("path:"):
        path = worktree[len("path:"):]
        busy = live_agents(path)
        if busy:
            print("SPAWN: REFUSED worktree-busy - %s already has a live agent "
                  "terminal; nudge it with `orca terminal send`, never start a "
                  "second session in the same tree" % path)
            for handle, title in busy:
                print("SPAWN:   %s  %s" % (handle, title))
            sys.exit(1)

    args = ["orchestration", "worker-start", "--task", task,
            "--worktree", worktree, "--agent", "claude", "--json"]
    if name:
        args += ["--name", name]
    if repo:
        args += ["--repo", repo]

    d = orca(args)
    if not d.get("ok"):
        err = d.get("error") or {}
        print("SPAWN: REFUSED %s - %s" % (err.get("code"), err.get("message")))
        sys.exit(1)
    r = d.get("result") or {}
    print("SPAWN: OK %s (stage %s)" % (r.get("dispatchId"), r.get("stage")))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
