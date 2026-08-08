+++
branch = "task/smoke-pipeline"
worktree = "/Users/stokarev/orca/workspaces/encar-ru/smoke-pipeline"
size = "small"
size_why = "one new one-paragraph file, no code touched"
owns = ["docs/harness/smoke-2026-08-08.md"]
reads = ["docs/harness/pipeline.md"]
after = []
+++

The harness (preflight, board, native Orca dispatch) merged on 2026-08-08 but
the full pipeline — brief → preflight → dispatch → claim → work → PR →
worker_done — has never run end-to-end. This task is that run.

Create `docs/harness/smoke-2026-08-08.md`: one short paragraph stating that
the pipeline smoke ran, on which date, and on which branch. Nothing else —
the file's content is not the point; the pipeline steps you follow to land
it are.

Follow `docs/harness/pipeline.md` exactly as written, including the claim
commit first and `worker_done` last. If any step in that file is impossible
or ambiguous as written, that is a finding: file it as a proposal in
`docs/proposals/` instead of improvising around it.
