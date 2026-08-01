/**
 * Minimal ambient declarations for the node built-ins used by the test suite.
 * @types/node is intentionally not installed (U1 restricts devDependencies to
 * typescript, esbuild, vitest, jsdom); vitest executes tests without a
 * typecheck, and these shims keep `tsc --noEmit` clean.
 */

declare module "node:fs" {
  export function readFileSync(
    path: string,
    encoding: "utf8",
  ): string;
}

declare module "node:path" {
  export function resolve(...segments: string[]): string;
}
