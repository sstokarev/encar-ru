#!/usr/bin/env python3
"""Refusal matrix for preflight.py. Run: python3 harness/test_preflight.py"""
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent


def make_repo(tmp):
    """A tiny repo with main + docs/tasks, preflight copied in."""
    repo = Path(tmp) / "repo"
    (repo / "docs" / "tasks").mkdir(parents=True)
    (repo / "harness").mkdir()
    shutil.copy(HARNESS / "preflight.py", repo / "harness" / "preflight.py")
    run(repo, "git init -q -b main")
    run(repo, "git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init")
    return repo


def run(cwd, cmd):
    r = subprocess.run(cmd, shell=True, cwd=str(cwd), capture_output=True, text=True)
    return r


def preflight(repo, name):
    return run(repo, "python3 harness/preflight.py check %s" % name)


def write_brief(repo, name, header, body="The gap.\n"):
    (repo / "docs" / "tasks" / (name + ".md")).write_text(
        "+++\n%s\n+++\n\n%s" % (header, body), encoding="utf-8"
    )


VALID = '''branch = "task/x"
worktree = "{wt}"
size = "small"
size_why = "one-file mechanical change"
owns = ["src/a.ts"]
reads = ["docs/harness/pipeline.md"]'''


class Preflight(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.repo = make_repo(self.tmp)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def add_worktree(self, branch="task/x", name="wt-x"):
        wt = Path(self.tmp) / name
        run(self.repo, 'git worktree add -q "%s" -b %s' % (wt, branch))
        return wt

    def test_valid_brief_passes_silently(self):
        wt = self.add_worktree()
        write_brief(self.repo, "x", VALID.format(wt=wt))
        r = preflight(self.repo, "x")
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertEqual(r.stdout, "")

    def test_no_header_refused(self):
        (self.repo / "docs" / "tasks" / "x.md").write_text("just prose\n")
        r = preflight(self.repo, "x")
        self.assertEqual(r.returncode, 1)
        self.assertIn("no header, no dispatch", r.stdout)

    def test_size_without_size_why_refused(self):
        wt = self.add_worktree()
        header = VALID.format(wt=wt).replace('size_why = "one-file mechanical change"\n', "")
        write_brief(self.repo, "x", header)
        r = preflight(self.repo, "x")
        self.assertEqual(r.returncode, 1)
        self.assertIn("size_why", r.stdout)

    def test_owns_collision_with_live_brief_refused(self):
        wt = self.add_worktree()
        write_brief(self.repo, "x", VALID.format(wt=wt))
        wt2 = self.add_worktree(branch="task/y", name="wt-y")
        header2 = VALID.format(wt=wt2).replace("task/x", "task/y")
        write_brief(self.repo, "y", header2)
        r = preflight(self.repo, "y")
        self.assertEqual(r.returncode, 1)
        self.assertIn("collides", r.stdout)
        self.assertIn("src/a.ts", r.stdout)

    def test_worktree_behind_main_refused(self):
        wt = self.add_worktree()
        run(self.repo, "git -c user.email=t@t -c user.name=t commit -q --allow-empty -m advance")
        write_brief(self.repo, "x", VALID.format(wt=wt))
        r = preflight(self.repo, "x")
        self.assertEqual(r.returncode, 1)
        self.assertIn("behind main", r.stdout)

    def test_missing_worktree_before_dispatch_passes(self):
        # Orca creates the worktree at worker-start; pre-dispatch the path
        # cannot exist yet and the gate must still pass.
        write_brief(self.repo, "x", VALID.format(wt=Path(self.tmp) / "nope"))
        r = preflight(self.repo, "x")
        self.assertEqual(r.returncode, 0, r.stdout)

    def test_missing_worktree_with_live_branch_refused(self):
        run(self.repo, "git branch task/x")
        write_brief(self.repo, "x", VALID.format(wt=Path(self.tmp) / "nope"))
        r = preflight(self.repo, "x")
        self.assertEqual(r.returncode, 1)
        self.assertIn("worktree does not exist", r.stdout)

    def test_unknown_field_refused(self):
        wt = self.add_worktree()
        write_brief(self.repo, "x", VALID.format(wt=wt) + '\nrank = "3"')
        r = preflight(self.repo, "x")
        self.assertEqual(r.returncode, 1)
        self.assertIn("unknown field: rank", r.stdout)

    def test_unquoted_array_items_refused_not_swallowed(self):
        wt = self.add_worktree()
        header = VALID.format(wt=wt).replace('owns = ["src/a.ts"]', "owns = [src/a.ts]")
        write_brief(self.repo, "x", header)
        r = preflight(self.repo, "x")
        self.assertEqual(r.returncode, 1)
        self.assertIn("double-quoted", r.stdout)

    def test_empty_array_still_legal(self):
        wt = self.add_worktree()
        header = VALID.format(wt=wt).replace('owns = ["src/a.ts"]', "owns = []")
        write_brief(self.repo, "x", header)
        r = preflight(self.repo, "x")
        self.assertEqual(r.returncode, 0, r.stdout)

    def test_duplicate_key_refused(self):
        wt = self.add_worktree()
        write_brief(self.repo, "x", VALID.format(wt=wt) + '\nowns = ["src/b.ts"]')
        r = preflight(self.repo, "x")
        self.assertEqual(r.returncode, 1)
        self.assertIn("duplicate key: owns", r.stdout)

    def test_empty_accepts_refused(self):
        wt = self.add_worktree()
        write_brief(self.repo, "x", VALID.format(wt=wt) + "\naccepts = []")
        r = preflight(self.repo, "x")
        self.assertEqual(r.returncode, 1)
        self.assertIn("accepts", r.stdout)

    def test_merged_brief_no_longer_blocks_owns(self):
        wt = self.add_worktree()
        write_brief(self.repo, "x", VALID.format(wt=wt))
        run(wt, "git -c user.email=t@t -c user.name=t commit -q --allow-empty -m work")
        run(self.repo, "git -c user.email=t@t -c user.name=t "
            'merge --no-ff -q task/x -m "Merge task/x: done"')
        wt2 = self.add_worktree(branch="task/y", name="wt-y")
        header2 = VALID.format(wt=wt2).replace("task/x", "task/y")
        write_brief(self.repo, "y", header2)
        r = preflight(self.repo, "y")
        self.assertEqual(r.returncode, 0, r.stdout)

    def test_pipeline_doc_budget(self):
        doc = HARNESS.parent / "docs" / "harness" / "pipeline.md"
        if doc.exists():
            lines = len(doc.read_text(encoding="utf-8").splitlines())
            self.assertLess(lines, 100, "pipeline.md is %d lines; the budget is <100" % lines)


if __name__ == "__main__":
    unittest.main(verbosity=1)
