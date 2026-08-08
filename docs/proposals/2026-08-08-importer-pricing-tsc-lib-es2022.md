# `npx tsc --noEmit` has been red since before this branch

**Seen:** `src/page/render.ts:58` calls `Object.hasOwn`, and `tsconfig.json`'s
`lib` predates ES2022, so a plain typecheck fails:

```
src/page/render.ts(58,17): error TS2550: Property 'hasOwn' does not exist on
type 'ObjectConstructor'. ... Try changing the 'lib' compiler option to 'es2022'
```

Confirmed pre-existing: `git stash -u && npx tsc --noEmit` on the clean merge
base produces the same single error.

**What it costs:** nothing at runtime — `Object.hasOwn` is in every browser the
extension supports, and neither gate touches it. `npm run build` is esbuild,
which strips types without checking them, and `npm test` is vitest, same story.
The cost is that the repo has no working typecheck at all: the ONE error masks
every future one, so a real type error lands silently and the next person to
run `tsc` reads the noise and moves on. I hit exactly that while writing this
branch — three genuine errors of mine were buried under it.

**Shape of the fix:** set `"lib": ["ES2022", "DOM", "DOM.Iterable"]` (or bump
`target`) in `tsconfig.json`, then add `tsc --noEmit` to the verification
commands in `docs/harness/project.md` so it stays green. Small, but it belongs
to whoever owns the build config — not to a pricing branch.

> **Verdict:**
