# `tsc --noEmit` is still red — 21 errors, all in `test/check-rates.test.ts`

**Filed by:** `task/importer-pricing` round 2, 2026-08-08. Report, not a fix.

Round 2 took the `tsc-lib-es2022` proposal and I applied it: `lib` is now
`ES2022`, which cleared the `Object.hasOwn` error in `src/page/render.ts` — the
only one in `src/`. I also extended `test/helpers/node-modules.d.ts` with the
five node built-ins `test/check-rates.test.ts` reaches for (`cpSync`,
`mkdirSync`, `mkdtempSync`, `writeFileSync`, `node:os`, `path.join`), which
cleared six more.

**21 errors remain, and the gate is therefore still not usable.** Do not read
"lib bumped" as "typecheck green".

    20  cascading from TS7016: no declaration file for ../scripts/check-rates.mjs
     1  TS2554: Expected 1 arguments, but got 2

All of them live in `test/check-rates.test.ts` (landed with `task/rates-watch`;
`docs/reports/rates-watch.md` exists, so nothing live holds the file now).

**Root cause, single:** the test imports ~30 symbols from
`scripts/check-rates.mjs`, a plain-JS module with no declarations. TypeScript
types the whole import as `any`, and every callback parameter fed from it
(`watch`, `item`, `bracket`, `f`) becomes an implicit any — that is the 20.
Fix the module's typing and 20 of 21 go with it.

**The last one is not a typing nit.** `TS2554: Expected 1 arguments, but got 2`
is a real arity mismatch between the test and the function it calls — exactly
the class of defect a working typecheck is supposed to catch, sitting
undetected because the typecheck has never been green. Worth looking at on its
own merits before it is annotated away.

**Shape of the fix:** either a hand-written `scripts/check-rates.d.ts` (keeps
the U1 constraint that devDependencies stay at typescript/esbuild/vitest/jsdom
— `@types/node` is deliberately absent, see the header of
`test/helpers/node-modules.d.ts`), or `allowJs` plus JSDoc types in the `.mjs`
itself. That is a decision about how this repo types its plain-JS scripts, with
~30 signatures to write; it is not a pricing branch's call, and doing it badly
is worse than not doing it.

Once it is green, `tsc --noEmit` belongs in the verification commands in
`docs/harness/project.md` next to `npm test` and `npm run build` — otherwise it
rots back to red the next time a test imports something undeclared, silently,
because vitest never typechecks.

> **Verdict:**
