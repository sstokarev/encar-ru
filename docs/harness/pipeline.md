# Worker pipeline

You are one Claude session on one task, in your own git worktree. Your brief is
`docs/tasks/<name>.md`. Project specifics live in `docs/harness/project.md`.
This file is your whole mandatory read path; it says only what no gate enforces.

## First action, always

```
git commit --allow-empty -m "claim: task/<name>"
```

The claim is the only proof the dispatch reached you. No claim, no task.

Two self-heals before reading further, no ask needed: if your brief is absent,
`git fetch origin && git merge origin/main` (your worktree may predate it);
if your branch is not `task/<name>`, `git branch -m task/<name>`.

## The cycle, sized by the brief's `size`

| size   | cycle |
|--------|-------|
| small  | work → commit → PR |
| normal | /compound-engineering:ce-plan → ce-work → ce-code-review → PR |
| deep   | ce-brainstorm (with the operator) → ce-plan → ce-work → ce-code-review → ce-compound → PR |

A `deep` brief means the outcome is not settled: run the brainstorm **in this
pane, with the operator**, using the multiple-choice picker, one question at a
time. Options show what he will SEE, not the name of an approach. Never send
product questions to the architect.

## Talking

- **To the operator** (product): in this pane, picker, one at a time.
- **To the architect** (resources — a branch collision, a missing input):
  `orca orchestration ask --question "..." --json`. It blocks until answered.
  If the reply may be long, ask for a file path, not a body: reply bodies are
  truncated near 2,000 chars (measured; the inbox copy is complete — decode
  `inbox --json` as `utf-8-sig`).
- **Findings outside your task** (a bug in someone else's file, a process gap):
  one file in `docs/proposals/` per finding — report, never fix. Your report
  ends with `Proposals filed: <names or "none">`.

## Acceptance and finish

If your brief has `accepts`, the operator must watch that scenario at your
worktree and say it works BEFORE you open a PR. His word is final.

Your report file lives at `docs/reports/<name>.md` — never in `docs/tasks/`,
which the board reads as briefs. Then: push, open the PR, and finish with

```
orca orchestration worker_done --task-id <id> --dispatch-id <id> \
    --outcome succeeded|failed --report-path <file>
```

`worker_done` is your LAST command — the dispatch closes with it. A failure
stated in prose with `--outcome succeeded` is a lie the board will believe.
