+++
branch = "task/rates-watch"
worktree = "/Users/stokarev/orca/workspaces/encar-ru/rates-watch"
size = "normal"
size_why = "a scheduled job plus a source map; the parsing shape and the change-detection rule are the worker's"
owns = ["scripts/check-rates.mjs", ".github/workflows/rates-watch.yml", "docs/harness/rates-source.md", "test/check-rates.test.ts"]
reads = ["src/calc/customs.ts", "src/config.default.ts", "site/config.json", "docs/harness/pipeline.md"]
after = []
+++

The operator's words: «каждый год ткс будет менять утильсбор с 1 января —
нужно забирать актуальный всегда оттуда». Today the tariff numbers live in
config with an `asOf` date and nobody watches them; the 01.12.2025 change
(ПП №1713) landed by hand.

Measured 2026-08-08, do not re-derive: `GET https://www.tks.ru/auto/calc/`
returns 200, **cp1251**, ~108 KB, and sends `access-control-allow-origin: *`.
The page carries the rate prose and decree citations (ПП №1291 от 26.12.2013
and its amendments; a banner «по новым ставкам, действующим с 23 августа, и с
учётом утилизационного сбора, введенного с 1 сентября» — undated, so treat
tks text as a SIGNAL, never as a dated fact). The calculator's RESULT is
Google-reCAPTCHA-gated: you can read tks's published rates, you cannot make
tks compute for you.

Shape it as detect-and-propose, not live-pull: a scheduled job (weekly, not
annually — 01.12.2025 proves changes miss the 1 January story) that fetches
the source, extracts the numbers our config actually uses, compares with
config, and on a difference opens a PR with the diff and the quoted source
text. A human accepts. Reason: a silent auto-update makes the page quote a
wrong price to a paying client, and a client-side parse of tks prose breaks
in front of that client instead of in CI.

Do NOT edit site/config.json or src/config.default.ts — a parallel task owns
them; your PR proposes the change, it does not land it. Consider the primary
source (publication.pravo.gov.ru / the decree text) alongside tks: tks is the
operator's reference, the decree is the authority, and disagreement between
them is itself worth reporting.
