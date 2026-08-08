# Project config: encar-ru

The per-project half the harness skills read. The skills themselves are
project-agnostic; everything encar-specific lives here.

## The product

Overlay widget for encar.com: injects all-in RUB prices next to KRW prices for
a car importer's clients. No backend — static files on GitHub Pages, two
delivery paths (Chrome extension, iOS bookmarklet), remote `config.json`.

## What a product scenario means here (`accepts`)

The operator watches the overlay work in a browser against a live encar.com
page, running the build from the worker's worktree (`npm run build`, load the
unpacked extension or paste the bookmarklet). A test run, a console line, or a
screenshot diff is NOT a product scenario — those are the worker's own checks.

## Resources and ceilings

No contended shared resources: no game clients, no shared memory, no test
accounts. Parallelism is bounded only by the architect's own acceptance
bandwidth (3–5 live branches).

## Traps that already cost time

- MV3 forbids remotely hosted code: the core is BUNDLED into the extension. A
  core fix reaches extension users only when the version bumps and they
  reinstall/update — a fix that must reach everyone now also needs the Pages
  side (`site/`) considered.
- `extension/manifest.json` version must equal `VERSION` in `src/main.ts` —
  the build fails otherwise. Bump both.
- The bookmarklet does not survive page navigation (encar swaps between `www`
  and `fem` hosts): one tap per page is by design, not a bug to fix.

## Verification commands

`npm test` (vitest, fixture-based DOM tests) and `npm run build` must both be
green before any PR. Harness selftests: `python3 harness/test_preflight.py`,
`test_boundary.py`, `test_board.py`.
