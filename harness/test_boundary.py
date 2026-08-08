#!/usr/bin/env python3
"""Boundary hook matrix. Run: python3 harness/test_boundary.py"""
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HOOK = Path(__file__).resolve().parent.parent / ".claude" / "hooks" / "boundary.py"


def run(cwd, cmd):
    return subprocess.run(cmd, shell=True, cwd=str(cwd), capture_output=True, text=True)


def hook(payload):
    return subprocess.run(
        [sys.executable, str(HOOK)],
        input=json.dumps(payload), capture_output=True, text=True,
    )


class Boundary(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.repo = Path(self.tmp) / "repo"
        self.repo.mkdir()
        run(self.repo, "git init -q -b main")
        run(self.repo, "git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init")
        self.wt = Path(self.tmp) / "wt"
        run(self.repo, 'git worktree add -q "%s" -b task/x' % self.wt)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def payload(self, cwd, target, tool="Edit"):
        return {"tool_name": tool, "cwd": str(cwd), "tool_input": {"file_path": str(target)}}

    def test_worker_writing_into_main_checkout_denied(self):
        r = hook(self.payload(self.wt, self.repo / "src.ts"))
        self.assertEqual(r.returncode, 2, r.stderr)
        self.assertIn("refusing", r.stderr)

    def test_worker_writing_into_own_worktree_allowed(self):
        r = hook(self.payload(self.wt, self.wt / "src.ts"))
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_architect_in_main_checkout_allowed(self):
        r = hook(self.payload(self.repo, self.repo / "src.ts"))
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_non_file_tool_ignored(self):
        r = hook({"tool_name": "Bash", "cwd": str(self.wt), "tool_input": {"command": "ls"}})
        self.assertEqual(r.returncode, 0)

    def test_outside_any_repo_fails_open(self):
        r = hook(self.payload(self.tmp, self.repo / "src.ts"))
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_garbage_stdin_fails_open(self):
        r = subprocess.run([sys.executable, str(HOOK)], input="not json",
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0)


if __name__ == "__main__":
    unittest.main(verbosity=1)
