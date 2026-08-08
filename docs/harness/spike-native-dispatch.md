# Spike: native Orca dispatch, measured 2026-08-08

One throwaway task (`spike-native-dispatch`) dispatched through Orca's native
path on this machine (Orca 1.4.173). Raw worker report: `spike-worker-report.md`.
Every number below was measured, not assumed.

## Proven

- **AE1 — agent-first dispatch delivers and submits.** `orca orchestration
  task-create` → `worker-start --task <id> --worktree new-top-level --repo
  path:<repo> --name <task> --agent claude` created the worktree itself,
  launched the agent, and the worker's claim commit
  (`claim: task/spike-native-dispatch`, empty) appeared with zero manual pane
  interaction. No unsubmitted prompt, no double prompt.
- **AE2 — completions survive a busy coordinator.** `worker_done` sent while
  the coordinator was not waiting surfaced on the next
  `check --wait --types worker_done`; after `--ack <delivery_id>` the unread
  count is 0 — no eternal replay.
- **Worker accounting.** `worker-stop` fences only (`processAction: none`, the
  terminal keeps running); `worker-release` is what closes the agent terminal
  (`processAction: closed_agent_terminal`). Retire order: stop → release →
  `orca worktree rm --force`.

## Found

- **AE3 — the `ask` return channel silently truncates.** A 2,200-char reply
  came back as a 2,015-char strict prefix in `ask --json`'s `answer` field —
  valid JSON, no truncation marker. The inbox copy (`inbox --json`, decoded
  `utf-8-sig` — the BOM is real) held all 2,200 chars. **Rule: any body that
  can exceed ~2,000 chars is fetched from the inbox by `answerMessageId`,
  never trusted from the `ask` return value.** Same class as rf-bot's torn
  pane injections: the store is lossless, the convenience copy is not.

## Consequences for the harness

1. The architect dispatches with the exact command sequence above; there is no
   `git worktree add` step — Orca creates the worktree.
2. The claim commit stays as the delivery proof (cheap, and it caught nothing
   this run — which is the good outcome).
3. Long content (briefs, letters, payloads) travels as files in the worker's
   worktree; message bodies are read from the inbox. Both halves now rest on a
   measured number (2,015), not on rf-bot folklore.
