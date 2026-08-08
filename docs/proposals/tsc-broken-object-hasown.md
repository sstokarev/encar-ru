# tsc --noEmit is red on main: Object.hasOwn vs lib in tsconfig

Found 2026-08-08 while working task/tks-parity (report, not fix — the file is
outside my owns).

`npx tsc --noEmit` fails on every branch:

```
src/page/render.ts(56,17): error TS2550: Property 'hasOwn' does not exist on
type 'ObjectConstructor'. Do you need to change your target library? Try
changing the 'lib' compiler option to 'es2022' or later.
```

Nobody notices because neither `npm test` (vitest, no type-check) nor `npm
run build` (esbuild, no type-check) runs tsc, and CI runs only those two. So
the repo's only whole-program type gate is silently broken, and any NEW type
error in any file now hides behind this one.

Fix is one line either way: `"lib": ["es2022", "dom"]` in tsconfig.json, or
replace `Object.hasOwn(x, k)` with `Object.prototype.hasOwnProperty.call(x,
k)` in src/page/render.ts. Worth deciding who owns tsconfig.json first —
nothing in docs/tasks claims it. Consider also adding `tsc --noEmit` to CI
next to `npm test` so the gate cannot rot silently again.
