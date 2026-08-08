# Briefs

One file per task: `docs/tasks/<name>.md`. The name is a short sentence-slug
(`board-shows-landed-work.md`), the branch is `task/<name>`. No header, no
dispatch — `harness/preflight.py check <name>` refuses malformed briefs.

## Header

A `+++`-fenced flat block: `key = "value"` or `key = ["a", "b"]`. Nothing else
(no nesting, no numbers — this is not TOML, and that is deliberate).

```
+++
branch = "task/board-shows-landed-work"
worktree = "/Users/me/orca/workspaces/repo/board-shows-landed-work"
size = "small"
size_why = "one script, refusal matrix already written"
owns = ["harness/board.py"]
reads = ["docs/harness/pipeline.md"]
accepts = ["operator opens board.html and sees the merged task as DONE"]
after = []
+++
```

- `size` ∈ small | normal | deep, and `size_why` is one sentence justifying it.
  One without the other is refused.
- `owns` — files this task may change. A collision with a live brief's `owns`
  is refused at preflight.
- `reads` — read-only inputs, for the reviewer's orientation.
- `accepts` — present ONLY when there is a product scenario the operator can
  watch (see `docs/harness/project.md` for what counts). No `accepts` → the
  task merges on the architect's review and never reaches the operator.
- `after` — task names this one waits for. Optional.

## Body, ~15 lines

The gap in the operator's words where you have them; what is already measured,
written as what it printed (a hedge turns a fact into an experiment the worker
must redo); what exists and must not be rebuilt; the traps that already cost
time. The design — how the thing should work — is the worker's, not the
brief's.
