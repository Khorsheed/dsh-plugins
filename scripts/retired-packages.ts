/**
 * The retired-package registry: npm names this repo no longer develops, each
 * folded into a replacement. Two consumers:
 *
 * - scripts/check-profile-bundles.ts fails any in-repo composition (profile
 *   dependencies, bundles rosters, preset rows) that still names one;
 * - scripts/deploy-3080.mts warns when the PROD profile still carries one —
 *   the stuck-middle of the 2026-09-28 incident, where the replacement
 *   shipped but the retired name was never cleaned out of the profile (the
 *   reverse skew — preset moved before the package — is what broke the dev
 *   preset that night, and is what the preflight preset audit now gates).
 *
 * A name stays listed forever: the checker's job is to make reintroducing it
 * impossible, and npm never reuses a name.
 * @module scripts/retired-packages
 */
export interface RetiredPackage {
  /** The retired npm name (packages retire whole — never a subpath). */
  readonly name: string
  /** Where the capability lives now. */
  readonly replacement: string
  /** Why it retired, and the npm end-state. */
  readonly note: string
}

export const RETIRED_PACKAGES: readonly RetiredPackage[] = [
  {
    name: '@khorsheed/dsh-worktrees-tool',
    replacement: "@khorsheed/dsh-worktrees' ./tool composition entry (>= 0.3.0; preset row id `worktrees-tool` is unchanged)",
    note: 'folded back into the core package at 0.3.0; the npm name is deprecated',
  },
  {
    name: '@khorsheed/dsh-client-ui-file-preview',
    replacement: '@khorsheed/dsh-file-preview (>= 0.4.0, the single-row host+client package)',
    note: 'merged into the host package at 0.4.0; the npm name is deprecated',
  },
  {
    name: '@khorsheed/dsh-client-ui-content-preview',
    replacement: '@khorsheed/dsh-file-preview (>= 0.4.0) and the worktrees local-files browser',
    note: 'absorbed as the internal content-preview library of those packages; the npm name is deprecated',
  },
]
