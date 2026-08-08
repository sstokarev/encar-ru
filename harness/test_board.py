#!/usr/bin/env python3
"""Board derivation matrix. Run: python3 harness/test_board.py"""
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent


def run(cwd, cmd):
    return subprocess.run(cmd, shell=True, cwd=str(cwd), capture_output=True, text=True)


def make_repo(tmp):
    repo = Path(tmp) / "repo"
    (repo / "docs" / "tasks").mkdir(parents=True)
    (repo / "docs" / "harness").mkdir(parents=True)
    (repo / "harness").mkdir()
    for f in ("preflight.py", "board.py"):
        shutil.copy(HARNESS / f, repo / "harness" / f)
    run(repo, "git init -q -b main")
    run(repo, "git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init")
    return repo


def brief(repo, name, branch=None):
    (repo / "docs" / "tasks" / (name + ".md")).write_text(
        '+++\nbranch = "%s"\nworktree = "x"\nsize = "small"\nsize_why = "t"\n'
        'owns = []\nreads = []\n+++\ngap\n' % (branch or "task/" + name),
        encoding="utf-8",
    )


def board(repo):
    return run(repo, "python3 harness/board.py")


GITC = "git -c user.email=t@t -c user.name=t"


class Board(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.repo = make_repo(self.tmp)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def line(self, out, name):
        return next((l for l in out.splitlines() if l.startswith(name + " ")), "")

    def test_no_branch_is_queued(self):
        brief(self.repo, "alpha")
        r = board(self.repo)
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertIn("QUEUED", self.line(r.stdout, "alpha"))

    def test_branch_ahead_is_in_progress(self):
        brief(self.repo, "alpha")
        run(self.repo, "git branch task/alpha")
        run(self.repo, "git checkout -q task/alpha")
        run(self.repo, GITC + " commit -q --allow-empty -m work")
        run(self.repo, "git checkout -q main")
        r = board(self.repo)
        self.assertIn("IN PROGRESS", self.line(r.stdout, "alpha"))
        self.assertIn("+1", self.line(r.stdout, "alpha"))

    def test_clean_zero_ahead_branch_is_not_started(self):
        brief(self.repo, "alpha")
        run(self.repo, "git branch task/alpha")
        r = board(self.repo)
        self.assertIn("NOT STARTED", self.line(r.stdout, "alpha"))

    def test_proper_merge_is_done(self):
        brief(self.repo, "alpha")
        run(self.repo, "git checkout -q -b task/alpha")
        run(self.repo, GITC + " commit -q --allow-empty -m work")
        run(self.repo, "git checkout -q main")
        run(self.repo, GITC + ' merge --no-ff task/alpha -m "Merge task/alpha: work"')
        r = board(self.repo)
        self.assertIn("DONE", self.line(r.stdout, "alpha"))

    def test_fast_forward_is_anomaly_not_not_started(self):
        brief(self.repo, "alpha")
        run(self.repo, "git checkout -q -b task/alpha")
        run(self.repo, GITC + ' commit -q --allow-empty -m "claim: task/alpha"')
        run(self.repo, GITC + " commit -q --allow-empty -m work")
        run(self.repo, "git checkout -q main")
        run(self.repo, "git merge -q --ff-only task/alpha")
        r = board(self.repo)
        self.assertIn("ANOMALY", self.line(r.stdout, "alpha"))

    def test_github_default_pr_merge_subject_is_done(self):
        brief(self.repo, "alpha")
        run(self.repo, "git checkout -q -b task/alpha")
        run(self.repo, GITC + " commit -q --allow-empty -m work")
        run(self.repo, "git checkout -q main")
        run(self.repo, GITC + ' merge --no-ff task/alpha '
            '-m "Merge pull request #7 from sstokarev/task/alpha"')
        r = board(self.repo)
        self.assertIn("DONE", self.line(r.stdout, "alpha"))

    def test_dirty_worktree_is_in_progress(self):
        wt = Path(self.tmp) / "wt-alpha"
        run(self.repo, 'git worktree add -q "%s" -b task/alpha' % wt)
        (wt / "junk.txt").write_text("dirt")
        (self.repo / "docs" / "tasks" / "alpha.md").write_text(
            '+++\nbranch = "task/alpha"\nworktree = "%s"\nsize = "small"\n'
            'size_why = "t"\nowns = []\nreads = []\n+++\ngap\n' % wt,
            encoding="utf-8",
        )
        r = board(self.repo)
        self.assertIn("IN PROGRESS", self.line(r.stdout, "alpha"))
        self.assertIn("dirty", self.line(r.stdout, "alpha"))

    def test_not_a_repo_exits_nonzero_and_says_where(self):
        bare = Path(self.tmp) / "bare"
        (bare / "docs" / "tasks").mkdir(parents=True)
        (bare / "harness").mkdir()
        for f in ("preflight.py", "board.py"):
            shutil.copy(HARNESS / f, bare / "harness" / f)
        r = run(bare, "python3 harness/board.py")
        self.assertEqual(r.returncode, 2)
        self.assertIn("CANNOT LOOK", r.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=1)
