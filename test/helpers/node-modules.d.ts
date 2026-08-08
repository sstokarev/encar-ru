/**
 * Minimal ambient declarations for the node built-ins used by the test suite.
 * @types/node is intentionally not installed (U1 restricts devDependencies to
 * typescript, esbuild, vitest, jsdom); vitest executes tests without a
 * typecheck, and these shims keep `tsc --noEmit` clean.
 *
 * ADD TO THIS FILE when a test reaches for a new built-in. A test that imports
 * something undeclared here does not fail the test run — vitest never
 * typechecks — it fails `tsc --noEmit` only, which is exactly the gate nobody
 * watches. That is how the file stopped covering its own suite once
 * test/check-rates.test.ts landed using five undeclared fs/os/path functions.
 */

declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function writeFileSync(
    path: string,
    data: string,
    encoding?: "utf8",
  ): void;
  export function mkdirSync(
    path: string,
    options?: { recursive?: boolean },
  ): string | undefined;
  export function mkdtempSync(prefix: string): string;
  export function cpSync(
    source: string,
    destination: string,
    options?: { recursive?: boolean },
  ): void;
}

declare module "node:path" {
  export function resolve(...segments: string[]): string;
  export function join(...segments: string[]): string;
}

declare module "node:os" {
  export function tmpdir(): string;
}
