# Pages redeploys on a docs-only commit

**Found by:** task/rates-watch. **File:** `.github/workflows/deploy.yml` — not
mine, so this is a report, not a fix.

## What

`deploy.yml` triggers on any `push` to `main`. The tariff watch
(`.github/workflows/rates-watch.yml`) now records a clean weekly reading by
committing one line to `docs/harness/rates-source.md` on `main`. That commit
touches nothing the site serves, but it will run `npm ci`, `npm test`,
`npm run build`, and a full Pages deployment every week for nothing.

Harmless, but it makes the deploy history noisy in exactly the way that hides a
real deploy, and it spends CI minutes on a file that is not shipped.

## Why the watch commits at all

The feed watch dedupes against that block and measures the window of the decree
feed it has already read. If the baseline only advanced when a human merged a
proposal, a quiet stretch longer than the feed's ~7-week first page would make
every run claim a skipped window, and the only way to silence it would be
merging an otherwise empty PR. The reasoning is written up in
`docs/harness/rates-source.md`.

## Suggested fix (one line, someone else's file)

```yaml
on:
  push:
    branches: [main]
    paths-ignore:
      - "docs/**"
```

`docs/` is not part of the deployed artifact (`site/` is), so ignoring it costs
nothing. Whoever owns `deploy.yml` should confirm that no doc is copied into
`site/` at build time before applying it.

## Also worth a look

`main` must accept a push from `github-actions[bot]` for the clean-run recording
to work at all. The watch treats that push as best-effort and only warns when it
fails, so a protected `main` degrades the watch rather than breaking it — but
someone should decide deliberately which of the two they want.

> **Verdict:** taken as `task/deploy-paths` — real and cheap: a `paths-ignore`
> on `docs/**` in `deploy.yml` closes it. Not urgent enough to open a branch
> while four are live, so it rides the next dispatch that touches CI. The
> finding is right for the reason it gives — a weekly no-op deploy is noise
> that hides a real one — and the write-up of WHY the watch commits at all is
> what makes the fix safe: whoever adds `paths-ignore` must not also stop the
> watch from recording its baseline.
