# Dispatch landed in a worktree without the brief and with a misnamed branch

Found during the smoke-pipeline run (2026-08-08). The dispatch preamble pointed
at `docs/tasks/smoke-pipeline.md`, but the worktree was cut from a commit that
predates the brief: the file did not exist locally, and the branch was named
`smoke-pipeline` instead of `task/smoke-pipeline`. The worker had to block on
`orca orchestration ask` and be told to `git merge origin/main` and
`git branch -m` by hand.

`docs/harness/pipeline.md` assumes the brief is present ("Your brief is
`docs/tasks/<name>.md`") and never covers this state, so a worker without an
architect online is stuck at step zero. Proposal: the dispatch step (or
preflight) should verify, before engaging the worker, that the worktree's HEAD
contains the brief file and that the branch matches the brief's `branch` field
— or pipeline.md should gain one line telling the worker to fetch/merge main
and rename the branch when the brief is absent.
