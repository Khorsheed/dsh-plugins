# Agent Note: The community agent presets ship as one declarative bundle (host 0.1.7-rc.1)

Status: implemented

## Problem

Host 0.1.7-rc.1 replaced the directory agent preset (`$DSH_HOME/.agent-presets/<id>/`
holding `preset.yml` + `agent.cordis.yml`) with a declaration row: one
`@deepseek-ai/dsh-agent-preset` entry per preset, carried by an ordinary bundle
patch, with the composition nested under `config.plugins`. The repo's three
community presets — dev (live in the 3080 home), dsh-eval and dsh-writing (the
web-eval / web profile packs) — existed only as 0.1.5 directories, and the 0.1.5
copies of the official composition had drifted from rc.1 (`workflow-worker-thread`
is now `workflow-ptc`, `tool-ralph` is disabled upstream, a disabled
`tool-plugin-manager` row exists). A bundle of preset declarations also fits none
of the conventions `check-plugin-independence` enforced: it self-mounts but has no
runtime row of its own (the identity triangle), and its nested composition
legitimately reuses profile-root row ids (`persona`, `tool-subagent-kimi`,
`canvas-agent`, …) that the tree-wide duplicate-id scan would flag.

## Decision

The three presets ship as **one new package, `packages/presets`
(`@khorsheed/dsh-presets`, 0.1.0)**, whose `cordis.patch.yml` is a single
`- insert:` list of three `@deepseek-ai/dsh-agent-preset` rows:

1. **dev (开发模式, order 10)** — the official part is rc.1's
   `standard.patch.yml` plugins block **adopted verbatim** (rebased, not carried
   forward: the 0.1.5 copy's drift is upstream's current truth), then the live dev
   file's community section appended verbatim: the three
   `@khorsheed/dsh-local-agent-tool-subagent` rows (kimi-cli / codex-local /
   claude-local configs), `worktrees-tool`, `room-tool`, `typesafe-tool`, and the
   Chinese section comments.
2. **dsh-eval (评测模式, order 0)** — `profiles/web-eval/presets/eval` migrated row
   by row (shell-less, workflow-less read-and-delegate composition plus the
   `datasets-tool`/`eval-tool` companion rows with their `tools:` tiers). Every
   official package name was checked against the rc.1 roster: **zero renames**.
3. **dsh-writing (写作模式)** — `profiles/web/presets/dsh-writing` migrated row by
   row (it keeps its own decisions: `tool-ralph` stays enabled, no
   `tool-plugin-manager` row, the `canvas/agent` row). The **only** rename in the
   whole migration: `workflow-worker-thread` → `workflow-ptc` (id and name), config
   `provider: spawn` unchanged.

Display fields (`name`/`description`/`order`) come from each legacy `preset.yml`,
Chinese text kept. Every `name:` value in the patch is quoted — including the
display names and `cordis:group`, the one deliberate deviation from the source
files (repo rule: `@` is YAML-reserved; YAML-identical either way).

The checker gains a manifest-declared sanction rather than an exception list:

- **`dsh.bundle.kind: 'preset-declarations'`** (closed `BUNDLE_KINDS` vocabulary,
  the `dsh.composition.component` precedent) replaces the identity triangle's
  own-row rule with a mechanically pinned preset-row convention: every top-level
  row must be named `@deepseek-ai/dsh-agent-preset` with a `preset-<id>` loader id.
- **Row-id uniqueness, patch row ownership, and own-row identity now read only a
  patch's TOP-LEVEL rows** (direct `- insert:` items plus bare top-level
  overrides), via the new dependency-free `parseTopLevelPatchRows`. Content nested
  under a row's `config` composes in that row's own scope, not the profile root —
  the duplicate-id boot failure the scan exists to prevent cannot cross that
  boundary, so the change weakens no true positive (verified: the pre-change tree
  has no nested ids at all, and the scan reports the same zero findings on it).
- The package names the community tool rows it references in `dsh.references`
  (data, never dependency edges — same deployment-layer resolution as the legacy
  directory presets) and builds a minimal `lib/` from a `PRESET_IDS` constant
  (pack-dist requires `lib/`); a spec pins patch ↔ constant ↔ manifest together
  with the migration facts above.

The legacy directories (`profiles/*/presets/`, `sync-presets.sh`) are deliberately
NOT retired in this change; that cutover is a later step.

## Alternatives considered

- **Carry the 0.1.5 dev composition forward verbatim.** Rejected for the official
  part: the copy had drifted from rc.1's `standard.patch.yml`, and a preset that
  pins yesterday's upstream defaults (an enabled `tool-ralph`, the renamed-away
  `workflow-worker-thread`) fails activation or silently diverges from the
  standard line it claims to extend. The community rows, by contrast, are ours and
  moved verbatim.
- **Add `presets` to `NO_OWN_PATCH` with a `dsh.composition.component`.** The two
  mechanisms contradict self-mounting by construction (a component declares who
  mounts the package; this package mounts itself), and the bundle must self-mount
  so `dsh plugin add` works. A bundle-side `kind` vocabulary mirrors the existing
  sanction without inverting its meaning.
- **Keep the naive any-depth scans and suppress the findings.** That is a bypass,
  not a sanction: the scans would still be wrong for every future preset bundle,
  and the scoped-composition semantics (nested ids cannot collide at the profile
  root) would stay unexpressed.
- **One bundle per preset.** Three near-identical packages for one roster of
  community modes buys nothing; the presets share provenance, host floor, and
  release cadence, so they version together. Splitting later costs only new
  packages pointing at the same row shape.

## Consequences

- `dsh plugin add @khorsheed/dsh-presets` on a 0.1.7-rc.1 host mounts all three
  presets into the session mode roster; a preset naming a community tool row whose
  package is absent stays on the roster with its diagnostic (official mechanism)
  and the other two are unaffected. On 0.1.5 the row type does not exist —
  documented as unavailable (not degraded) in the README Compatibility section and
  `dsh.compat` (`minHost: 0.1.7-rc.1`).
- The checker's top-level-row semantics are now the contract every future
  declarative bundle gets: preset ids live in a per-preset namespace, and only
  profile-root rows participate in id-uniqueness and ownership. The spec suite
  covers the parser, the kind vocabulary, and the nested-id non-collision case.
- `pnpm-workspace.yaml` gained `@deepseek-ai/dsh-agent-preset@0.1.7-rc.1` in
  `minimumReleaseAgeExclude` (installer-registered when the optional peer
  resolved); the peer range is `^0.1.7-rc.1` because the package first ships in
  that line — the repo's usual `^0.1.0-rc.6` floor matches nothing published.
- `docs/packages.md` was regenerated; it also corrects the pre-existing canvas
  version drift on this branch (0.4.6 → 0.4.3) that had left `test:scripts` red
  before this change.
- Follow-up, not done here: retire `sync-presets.sh` and the `profiles/*/presets/`
  directories once the 3080/web-eval installs cut over to the bundle, and delete
  the legacy `~/.dsh-official/.agent-presets/dev` directory after the prod
  instance adopts the row.
