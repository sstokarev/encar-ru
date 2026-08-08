# Report: task/encar-client

PR: https://github.com/sstokarev/encar-ru/pull/3 (branch task/encar-client, commit f10da91)

## Delivered

`src/encar/` implemented to the fixed contract in `src/encar/types.ts`:

- `parseListingUrl` — fem.encar.com/cars/detail/<id> and
  www.encar.com/dc/dc_cardetailview.do?carid=<id> (param case-insensitive);
  suffix host check rejects foreign lookalike paths.
- `fetchCarData` — GET api.encar.com/v1/readside/vehicle/<id>, 10s abort
  timeout, defensive payload mapping. Price normalized 만원 → KRW. Photo base
  `https://ci.encar.com` verified live (200, image/jpeg on a fixture path);
  photos sorted exterior-first ("001" before option close-ups).
- 14 vitest cases on a live-captured fixture
  (`src/encar/fixtures/vehicle-41344448.json`), no network; compile-time
  assertion that exports satisfy `EncarFetch`/`ParseListingUrl`.

## Findings

- The readside API may answer with a DIFFERENT vehicleId than requested
  (requested 41344448 → payload 41335009; re-listed car keeps its old
  record). The payload's own id is exposed as `CarData.vehicleId`.
- Endpoint confirmed open: 200, `access-control-allow-origin: *`, no auth.

## Verification

`npm test` 299 passed (12 files), `npx tsc --noEmit` clean, `npm run build`
ok, all three harness selftests pass.

Proposals filed: none
