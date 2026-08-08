# Proposal: shared quote-rendering helpers for widget + calc page

Found during task/calc-page code review (maintainability, 2 x P2). Fix touches
`src/ui/`, which calc-page does not own — reported, not fixed.

Two blocks are now duplicated between `src/ui/breakdown.ts` (widget) and
`src/page/render.ts` (calc page):

1. The total line's precision branching ("расчёт по запросу" vs
   `formatRub(total, precision)`) exists in three places: breakdown, page
   render, and page tg-link (draft wording). A `totalLine(allIn)` helper in
   `src/ui/badge.ts` would make the on-request rule single-sourced.
2. The provenance notes block (embedded-config marker, preliminary-rate,
   rejected-rate, rate-date, commissionNote) is duplicated string-for-string
   and condition-for-condition. A data-builder `provenanceNotes(loaded,
   rates): string[]` consumed by both renderers would keep the wording from
   drifting.

Low urgency: wording drift is the only failure mode. Best done as a small
follow-up task that owns `src/ui/` and both consumers.

> **Verdict:** held — deduping the page renderer against the widget renderer is
> only worth it if the widget survives. The operator is deciding the overlay's
> fate (keep / redirect to the page / retire) now that the page is the pitch;
> merging the two renderers first would either be thrown away or make the
> retirement harder. Revisit the hour that decision lands — wording drift
> between two live renderers is the cost of waiting, and it is small.
