# Proposals

The durable cross-agent channel: one file per finding,
`YYYY-MM-DD-<branch>-<slug>.md`. A worker that sees a bug in someone else's
file, a process gap, or work worth doing REPORTS it here and never fixes it
in place.

A proposal states: what was seen, where (file:line), what it cost or would
cost, and — if obvious — the shape of the fix. Short; the reader has the code.

## Verdicts

The architect answers every proposal with a machine-readable line in the file
itself, the hour it lands:

```
> **Verdict:** taken as `task/<name>` — <why>
> **Verdict:** held — <what would change that>
> **Verdict:** declined — <why>
```

`taken` is only legal when `docs/tasks/<name>.md` exists on disk. `declined`
is a valid closure. A verdict recorded only in prose is invisible.
