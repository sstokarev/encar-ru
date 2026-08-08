#!/usr/bin/env python3
"""Brief preflight: refuses a malformed brief before dispatch.

Usage: python3 harness/preflight.py check <task-name>

A brief lives at docs/tasks/<task-name>.md and opens with a +++-fenced flat
header of `key = value` lines (strings and string arrays only; no TOML parser
on purpose - the machine python is 3.9).

Exit 0 silent on a valid brief; exit 1 with every refusal printed, one per
line. A refusal is a refusal, never a warning.
"""
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

REQUIRED = ["branch", "worktree", "size", "size_why", "owns", "reads"]
OPTIONAL = ["accepts", "after"]
SIZES = {"small", "normal", "deep"}


def parse_header(text):
    """Return (dict, errors) from the +++-fenced flat header."""
    m = re.match(r"\s*\+\+\+\n(.*?)\n\+\+\+", text, re.DOTALL)
    if not m:
        return None, ["no +++ header - no header, no dispatch"]
    fields, errors = {}, []
    for line in m.group(1).splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        kv = re.match(r"([a-z_]+)\s*=\s*(.+)$", line)
        if not kv:
            errors.append("unparseable header line: %r" % line)
            continue
        key, raw = kv.group(1), kv.group(2).strip()
        if key in fields:
            errors.append("duplicate key: %s (a header states each field once)" % key)
            continue
        if raw.startswith("["):
            items = re.findall(r'"([^"]*)"', raw)
            if not items and re.sub(r"\s", "", raw) != "[]":
                errors.append(
                    'array items in %s must be double-quoted: %s' % (key, raw))
                continue
            fields[key] = items
        else:
            m2 = re.match(r'"(.*)"$', raw)
            if not m2:
                errors.append("value for %s must be quoted or a [\"...\"] array" % key)
                continue
            fields[key] = m2.group(1)
    return fields, errors


def git(args, cwd=REPO):
    r = subprocess.run(["git"] + args, cwd=str(cwd), capture_output=True, text=True)
    return r.returncode, r.stdout.strip()


def merged_tasks():
    """Task names whose merge landed on main (our subject or GitHub's default)."""
    rc, out = git(["log", "main", "--merges", "--pretty=%s"])
    if rc != 0:
        return set()
    names = set()
    for subject in out.splitlines():
        m = re.match(r"Merge task/([\w-]+)", subject) or re.match(
            r"Merge pull request #\d+ from .*/task/([\w-]+)$", subject)
        if m:
            names.add(m.group(1))
    return names


def live_briefs(exclude):
    """Other briefs whose branch exists and has not landed (live tasks)."""
    out = []
    merged = merged_tasks()
    tasks_dir = REPO / "docs" / "tasks"
    for p in sorted(tasks_dir.glob("*.md")):
        if p.stem in (exclude, "README") or p.stem in merged:
            continue
        fields, errs = parse_header(p.read_text(encoding="utf-8"))
        if not fields:
            continue
        rc, _ = git(["rev-parse", "--verify", "--quiet", fields.get("branch", "")])
        if rc == 0:
            out.append((p.stem, fields))
    return out


def check(name):
    errors = []
    brief = REPO / "docs" / "tasks" / (name + ".md")
    if not brief.exists():
        return ["no brief at docs/tasks/%s.md" % name]

    fields, errors = parse_header(brief.read_text(encoding="utf-8"))
    if fields is None:
        return errors

    for key in REQUIRED:
        if key not in fields:
            errors.append("missing required field: %s" % key)
    for key in fields:
        if key not in REQUIRED + OPTIONAL:
            errors.append("unknown field: %s" % key)

    if fields.get("size") and fields["size"] not in SIZES:
        errors.append("size must be one of %s" % sorted(SIZES))
    if fields.get("size") and not fields.get("size_why"):
        errors.append("size without size_why is ignored - state both or neither")

    wt = fields.get("worktree")
    if wt:
        wt_path = Path(wt).expanduser()
        if not wt_path.is_absolute():
            wt_path = REPO / wt_path  # never the invoker's cwd
        if not wt_path.is_dir():
            # Orca creates the worktree at worker-start, after this gate: a
            # missing directory is normal pre-dispatch. Once the task branch
            # exists the task is live and a missing path is a stale brief.
            rc, _ = git(["rev-parse", "--verify", "--quiet",
                         fields.get("branch", "")])
            if rc == 0:
                errors.append(
                    "branch %s is live but worktree does not exist: %s"
                    % (fields.get("branch"), wt))
        else:
            rc, head = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd=wt_path)
            if rc != 0:
                errors.append("cannot read HEAD in worktree %s" % wt)
            elif fields.get("branch") and head != fields["branch"]:
                errors.append("worktree is on %r, brief says %r" % (head, fields["branch"]))
            rc, behind = git(["rev-list", "--count", "HEAD..main"], cwd=wt_path)
            if rc == 0 and behind.isdigit() and int(behind) > 0:
                errors.append("worktree is %s commits behind main - merge main first" % behind)

    owns = set(fields.get("owns") or [])
    for other, of in live_briefs(exclude=name):
        overlap = owns & set(of.get("owns") or [])
        if overlap:
            errors.append("owns collides with live brief %r on: %s" % (other, sorted(overlap)))

    accepts = fields.get("accepts")
    if accepts is not None and (
        not isinstance(accepts, list) or not accepts or not all(a for a in accepts)
    ):
        errors.append("accepts must be a non-empty string array when present")

    return errors


def main(argv):
    if len(argv) != 3 or argv[1] != "check":
        print(__doc__.strip())
        return 2
    errors = check(argv[2])
    for e in errors:
        print("REFUSED: %s" % e)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
