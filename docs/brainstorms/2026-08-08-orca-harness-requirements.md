---
date: 2026-08-08
topic: orca-harness
---

# Project-Agnostic Orca Orchestration Harness — Requirements

## Summary

A project-agnostic development harness for the Orca editor, built and proven in encar-ru first: an `/architect` skill (runs the queue, board, briefs, dispatch, acceptance, merges), an `/auditor` skill (commissioned read-only pass), a short worker pipeline doc, and two thin cross-platform scripts (brief preflight, git-derived board). All delivery and lifecycle run on native Orca orchestration; the rf-bot homemade delivery layer does not carry over.

---

## Problem Frame

rf-bot proved the working model — one architect instance managing a queue of worker sessions in worktrees, the operator giving product tasks and accepting product scenarios — but its harness is welded to the game domain and Windows, and its homemade delivery layer (create terminal → send text → press enter as separate steps) produces the operator's three recurring failures: prompts left unsubmitted in a pane, worker completions going unseen, and messages torn mid-injection so only fragments arrive. rf-bot's own audits additionally measured ceremony taxes: a 905-line mandatory read path per worker, review width decided by the plugin instead of the brief, and fixed architect overhead regardless of task size. To run the model on other projects, the flow must be separated from the game specifics and rebuilt on Orca's native path.

---

## Key Decisions

- **Native-first delivery.** Every dispatch, message, and completion goes through native Orca orchestration (agent-first worker start, ack-based waiting, inbox reads). No homemade terminal choreography. Orca's own skill guides are the authority on the coordination layer; where harness docs and the guides disagree, the guides win.
- **Build in encar-ru, extract the template later.** The harness is developed inside its first consumer. A copyable template is carved out when a second project needs it; agnosticism is enforced now by keeping project specifics in a config the skills read (see R3).
- **Light core ceremony.** Briefs, board, acceptance, and a worker doc under 100 lines. No dense ranks with renumbering; audits on demand. Gates are added per project by the rule: the same mistake twice → a gate, never a resolution to be careful (rf-bot's "an LLM has no discipline" order survives as this rule).
- **Product questions and acceptance happen in the worker's pane.** The architect is a single point of control, not the single point of contact — relaying questions through it measured 4m08s per question in rf-bot.
- **Claim commit stays.** An empty `claim:` commit by the worker is the only proof a prompt was read; delivery claims by tooling are not trusted.

---

## Actors

- A1. **Operator** (Sergei) — gives product tasks, owns product priorities, answers brainstorm questions in the worker's pane, watches product scenarios at the worktree before a PR. Never handles merges, conflicts, or repo structure.
- A2. **Architect** — one Claude instance per project session. Owns the queue, board, briefs, worktrees, dispatch, technical priorities, acceptance-of-record, merge and retire, proposal verdicts. Does not do the work; does not run brainstorms in its own session.
- A3. **Worker** — one Claude session per task, in its own worktree. Runs the compound-engineering loop, asks the operator product questions via the picker in its own pane, asks the architect only for resources.
- A4. **Auditor** — a separate session commissioned by the operator. Reads everything, changes nothing, files findings as proposals.

---

## Key Flows

- F1. **Task lifecycle.** Operator states a product task → architect writes a brief (~15 lines, machine-checkable header) → preflight lint passes → architect creates worktree and dispatches via native Orca → worker's claim commit confirms delivery → for product tasks, worker runs the brainstorm with the operator in its own pane → plan → work → review → for tasks with a product scenario, operator watches it at the worktree and accepts → PR → `worker_done` → architect merges `--no-ff`, retires the worktree, sorts filed proposals.
- F2. **Messaging.** The architect keeps one ack-based wait loop as its only ears; completions surface even when the architect is mid-conversation. Content longer than a couple of lines travels as a file in the worker's worktree plus a one-line pointer; the inbox, not the pane text, is the source of any message body.
- F3. **Audit.** Operator commissions with a scope → auditor reads code and records independently → findings exit as proposals → architect answers each with a verdict; declined is a valid closure.

---

## Requirements

**Roles and skills**

- R1. An `/architect` skill defines the architect's seat: session-start ritual, queue and board upkeep, brief writing, dispatch, acceptance, merge, retire, proposal sorting. Content is project-agnostic and in English.
- R2. An `/auditor` skill defines the commissioned read-only pass: one commission per audit, findings exit only as proposals, verdicts belong to the architect.
- R3. Project specifics — what a product scenario means here, shared resources and their ceilings, domain traps — live in a per-project config document the skills read; the skills themselves contain no project references.

**Delivery and lifecycle (native Orca)**

- R4. Dispatch uses Orca's agent-first native path; the harness contains no create-terminal-then-type-then-enter choreography.
- R5. The architect has exactly one listening mechanism: the native wait with explicit acknowledgment, armed once per session. A worker completion must reach the architect even if it arrives while the architect is busy.
- R6. Message bodies are read from the inbox; pane text is treated as a doorbell only. Long content travels as a file in the worker's worktree plus a one-line pointer.
- R7. A dispatch is considered delivered only when the worker's claim commit exists.

**Board and ceremony**

- R8. The board derives from git (what landed) and Orca (who is live); nothing on it is hand-written. The operator can open it as a file or page.
- R9. A brief is ~15 lines with a slim machine-checkable header; a preflight lint refuses malformed briefs before dispatch.
- R10. The worker's mandatory read path (pipeline doc plus brief) stays under 100 lines.
- R11. The harness ships with a minimal gate set (preflight lint, claim check, main-checkout write protection); further gates are added only when a mistake repeats.

**Acceptance**

- R12. A task with a product scenario is accepted by the operator watching that scenario at the worktree before the PR; his word is final. A task without one merges on the architect's review and never reaches the operator.
- R13. Workers ask the operator product questions in their own pane with the multiple-choice picker, one at a time; the ask channel to the architect is for resources only.

---

## Acceptance Examples

- AE1. **Covers R4, R7.** Architect dispatches a task; the worker session starts and its claim commit appears with no manual enter-pressing or pane babysitting.
- AE2. **Covers R5.** A worker finishes while the operator and architect are mid-discussion; the completion surfaces on the architect's next wait cycle, nothing is lost or replayed forever.
- AE3. **Covers R6.** Architect sends a worker a multi-paragraph follow-up; the worker reads the complete text from a file, no torn fragments.
- AE4. **Covers R12.** On an encar-ru product task, the operator watches the overlay work in a browser served from the worker's worktree, says it works, and only then a PR opens.

---

## Scope Boundaries

- No rf-bot retrofit — moving rf-bot onto this harness is separate later work.
- No wholesale port of rf-bot's `dispatch.py` / `gates.py` / `board.py`; conventions carry over, code is rewritten thin.
- No plugin packaging or version distribution; template extraction waits for a second consumer project.
- No dense rank system with renumbering; no multi-machine orchestration.

---

## Dependencies / Assumptions

- Orca runtime with orchestration enabled on the dev machine; the compound-engineering plugin available to workers.
- **Assumption to verify first:** Orca's native agent-first dispatch reliably delivers and submits the prompt. A spike proves it before the harness is built on it; if it fails, the fallback is a claim-commit wait with a single documented repair path — not a return to homemade choreography.

---

## Outstanding Questions

**Deferred to Planning**

- Exact brief header field set (which rf-bot fields survive the slimming).
- Board rendering: plain terminal output vs generated HTML page, and what regenerates it.
- Monitor form: persistent background watcher vs re-armed wait loop.
- How the skills locate and read the per-project config document.

---

## Sources / Research

- rf-bot harness map: `.claude/skills/architect/SKILL.md`, `.claude/skills/audit/SKILL.md`, `docs/orchestration.md`, `docs/pipeline.md`, `harness/dispatch.py`, `harness/board.py` in the rf-bot repo — the working model and its measured traps.
- rf-bot audit records (`docs/audit/2026-08-05.md`, `2026-08-06.md`) and round-2 reviews — the ceremony-tax and instruments-lying findings this harness corrects.
- Orca built-in guides: `orca skills get orchestration`, `orca skills get orca-cli` — the native capability surface (Run→Task→Dispatch, ack-based waiting, worktree-level board cards, no native ranks/acceptance).
