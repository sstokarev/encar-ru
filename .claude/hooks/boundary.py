#!/usr/bin/env python3
"""PreToolUse gate: a worker session never writes into the main checkout.

v1 covers file tools only (Write, Edit, NotebookEdit). Bash/git coverage is a
deferred gate - rf-bot's measured lesson is that it needs triple resolution of
`-C` / `--git-dir` / `cd` to be honest, and a half-gate teaches the second
spelling. Add it when the first violation happens.

The anchor is git's common dir, NOT this file's path: every worktree carries
its own copy of this hook, so a __file__ anchor would name the worktree itself
as "main" and allow everything. `git rev-parse --git-common-dir` resolves to
the main checkout's .git from any linked worktree.

Reads the hook payload from stdin (JSON), answers via exit code:
0 = allow, 2 = deny (stderr explains).
"""
import json
import os
import subprocess
import sys
from pathlib import Path


def main_checkout(cwd):
    """The repo's main checkout, resolved from any worktree; None if unknown."""
    r = subprocess.run(
        ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
        cwd=str(cwd), capture_output=True, text=True,
    )
    if r.returncode != 0:
        return None
    common = Path(r.stdout.strip())
    return common.parent if common.name == ".git" else None


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0  # fail-open: a broken payload must not brick the session

    tool = payload.get("tool_name", "")
    if tool not in ("Write", "Edit", "NotebookEdit"):
        return 0

    tool_input = payload.get("tool_input", {})
    target = tool_input.get("file_path") or tool_input.get("notebook_path")
    if not target:
        return 0

    cwd = Path(payload.get("cwd") or os.getcwd()).resolve()
    main_dir = main_checkout(cwd)
    if main_dir is None:
        return 0  # cannot resolve: fail-open, never brick a session

    try:
        cwd.relative_to(main_dir)
        return 0  # session lives in the main checkout: architect/operator
    except ValueError:
        pass

    try:
        Path(target).resolve().relative_to(main_dir)
    except ValueError:
        return 0  # write goes elsewhere (its own worktree): fine

    sys.stderr.write(
        "boundary: refusing %s into the main checkout (%s) from a worker "
        "session (cwd %s). Report the need as a proposal instead.\n"
        % (tool, main_dir, cwd)
    )
    return 2


if __name__ == "__main__":
    sys.exit(main())
