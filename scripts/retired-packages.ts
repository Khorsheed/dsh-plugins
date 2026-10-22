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
    name: '@khorsheed/dsh-room-tool',
    replacement: "@khorsheed/dsh-room's ./tool composition entry (>= 0.2.0; preset row id `room-tool` is unchanged)",
    note: 'folded back into the core package at 0.2.0; the npm name is deprecated',
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
  {
    name: '@khorsheed/dsh-local-agent-tool-subagent',
    replacement: "each provider's own ./tool composition entry (@khorsheed/dsh-local-agent-kimi/tool, -codex/tool, -claude-code/tool; family >= 0.2.0-rc.1), over the family core's ./tool-factory export — the dev-preset row ids (`tool-subagent-kimi` etc.) are unchanged",
    note: 'folded into the provider packages at the family fold (2026-09-30); the npm name is deprecated',
  },
  {
    name: '@khorsheed/dsh-datasets-tool',
    replacement: "@khorsheed/dsh-datasets' ./tool composition entry (>= 0.2.0-rc.1; preset row id `datasets-tool` is unchanged)",
    note: 'folded into the core package at the evaluation-family fold (T88, 2026-10-01); npm deprecation rides the next publish wave',
  },
  {
    name: '@khorsheed/dsh-mission-tool',
    replacement: "@khorsheed/dsh-mission's ./tool composition entry (>= 0.2.0-rc.1; preset row id `mission-tool` is unchanged)",
    note: 'folded into the core package at the evaluation-family fold (T88, 2026-10-01); npm deprecation rides the next publish wave',
  },
  {
    name: '@khorsheed/dsh-eval-tool',
    replacement: "@khorsheed/dsh-eval's ./tool composition entry (>= 0.2.0-rc.1; preset row id `eval-tool` is unchanged)",
    note: 'folded into the core package at the evaluation-family fold (T88, 2026-10-01); npm deprecation rides the next publish wave',
  },
  {
    name: '@khorsheed/dsh-typesafe-tool',
    replacement: "@khorsheed/dsh-typesafe's ./tool composition entry (preset row id `typesafe-tool` is unchanged)",
    note: 'folded at the host-021 wave; the published 0.1.2 npm name deprecates in the same wave',
  },
  {
    name: '@khorsheed/dsh-bundle-writing',
    replacement: "@khorsheed/dsh-presets' 写作模式 (`preset-dsh-writing`), which now mounts `@khorsheed/dsh-canvas-novel/agent`",
    note: 'its 写作 preset folded into 写作模式 (2026-10-06): one writing preset, the novel tools gated by the session binding; never published to npm',
  },
  {
    name: '@khorsheed/dsh-bundle-learning',
    replacement: "@khorsheed/dsh-presets' 学习模式 (`preset-learning` — row id and preset id unchanged)",
    note: 'the single-row preset-declarations bundle folded into the presets package (2026-10-12) so every scene mode ships from one bundle; published as 0.1.0 — npm deprecation rides the next publish wave',
  },
  {
    name: '@khorsheed/dsh-rss-reader',
    replacement: '@khorsheed/dsh-reader (>= 0.3.0)',
    note: 'rewritten and renamed to dsh-reader; never published to npm — cleanup is profile-side only (a stale overrides pin survived until the host-021 wave)',
  },
  {
    name: '@khorsheed/dsh-ui-shortcuts',
    replacement: "the host's built-in rebindable shortcut settings (>= 0.1.7-rc.1 line; no package replacement)",
    note: 'superseded by the built-in shortcut settings the host ships since 0.1.7-rc.2 (retired 2026-10-22); the npm name is deprecated at 0.2.4',
  },
]
