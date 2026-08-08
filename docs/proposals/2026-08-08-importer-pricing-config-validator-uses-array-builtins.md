# The config validator is the one money path still trusting `Array.prototype`

**Seen:** `src/config.ts:243` — `costItems.every(isCostItem)` — and
`isBracketArray`'s `value.every(...)` at `src/config.ts:131`.

`src/calc/customs.ts` documents a MEASURED failure (2026-08-02) on
www.encar.com: the host page ships an ES5 bundle that REPLACES built-ins, and
its `Array.prototype.reduce` ignored the callback and returned the array
itself. `[1,2,3].reduce((s,x)=>s+x,0)` yielded `[1,2,3]`. Every quote on the
desktop listing degraded to «по запросу» — the honest marker for a dishonest
reason. Both `customs.ts` and the new `pricing.ts` are hardened: plain `for-of`
everywhere on the money path, no prototype methods.

`src/config.ts` is not. It runs in the same page, on the same replaced
prototypes, and it decides whether the remote config is used at all.

**What it would cost:** if the host's `every` is as broken as its `reduce` was,
`isValidConfig` returns a truthy array instead of a boolean and the shapes stop
being checked — or returns falsy and every client silently drops to embedded
tariffs. Neither is visible. This is a narrower blast radius than the `reduce`
case (that one hit every quote; this one hits config loading), which is why I
did not widen my diff into it — I only converted the `filter` calls I was
adding into a `for-of` helper rather than adding two more.

**Shape of the fix:** replace `every`/`filter` in `src/config.ts` with the same
`for-of` discipline the calculator uses, and add a test that stubs a hostile
`Array.prototype.every` the way the existing host-polyfill test in
`test/scan.test.ts` does for `Array.from`. Perhaps twenty lines.

Worth noting the fix is cheap and the evidence for the risk is measured, not
theoretical — this is the last unhardened layer of the same class of bug.

> **Verdict:**
