# Agent Note: Family bundle meta packages and the `dsh.bundle.kind: 'family'` checker sanction (wave 1)

Status: implemented

## Problem

The repo ships 30+ self-mounting plugin packages; installed bare into the host
0.1.7-rc.1 plugin inventory they render as a screen of loose cards, while the
official shape aggregates a family into ONE bundle card carrying many loader
rows (with row-level switches on the bundle detail page). The family-bundles
proposal ([2026-09-24-family-bundles-and-collections](../../../proposals/active/2026-09-24-family-bundles-and-collections.md),
v3 ratified) organizes packages into thin **family bundle meta packages** — a
patch that re-mounts the members' canonical rows plus npm dependencies on the
members — but two repo-level rules forbade exactly that shape:

- `check-plugin-independence`'s patch-row-ownership rule: no package's patch
  may mount another SELF-MOUNTING package's row (the freeze of the local-agent
  double-mount incident), and its loader-row-id ledger counts the same row id
  from two patches as a boot-fatal duplicate;
- the identity triangle expects every self-mounting package to mount its own
  runtime row, which a pure-composition bundle deliberately never has.

Without a sanction the only way to ship the shape would have been bypassing the
checker — the exact move the checker exists to make impossible.

## Decision

Wave 1 (shape validation) ships the sanction plus two sample bundles.

**The sanction** (`scripts/check-plugin-independence.ts`): `BUNDLE_KINDS` gains
`'family'`, declared in the bundle manifest as
`dsh.bundle: { patch, kind: 'family', members: [...] }`. The closed-vocabulary
precedent is `preset-declarations` (same day, `packages/presets`): the manifest
metadata decides, never an inference. For a family bundle the checker pins:

- the patch's top-level rows come ONLY from the exact allowlist = the union of
  the declared members' own canonical patch rows (same id, same name when
  named; a bare override's id must likewise come from a member's patch — a
  provider's canonical row naming the family's deps-only tool package rides
  along this way);
- every member is a real, self-mounting repo package, is listed in
  `dependencies` (installing the bundle brings the family along), and is
  registered in `dsh.references` (the roster is DATA pack-time and catalog
  checks read — the edge/reference exclusivity rule exempts declared members);
- every member contributes at least one row, so the manifest roster and the
  patch cannot drift apart;
- the bundle itself registers nothing: no `dsh.client` browser half, and src
  must not carry an apply entry, an `inject` declaration, or any
  service/tool/slot/command registration (`FAMILY_REGISTRATION_RE`).

The two cross-package exemptions this opens are scoped to that same canonical
allowlist: the loader-row-id ledger skips family-bundle patches entirely (the
rows ARE the members' rows — `dsh plugin add` reconciles only the profile's
direct dependencies, so installing the bundle never applies the members' own
patches alongside it), and patch-row-ownership exempts a family-bundle row only
when it matches a member's canonical row verbatim. Edges onto declared members
are sanctioned by the manifest; deps-only family libraries a bundle also
installs keep explicit `ALLOWED_EDGES` entries.

**The two sample bundles** (`@khorsheed/dsh-bundle-<name>`, both 0.1.0, the
`dsh-presets` thin-meta shape: stub `src/index.ts` constants for a buildable
`lib/`, tsc+tsdown, `locale/en.json`+`zh.json` card metadata, bilingual README
with Compatibility, `dsh.compat`/`dsh.references`/`files`/`exports`):

- `packages/bundle-local-agent`「本地多Agent」— members: the local-agent core
  plus the kimi / codex / claude-code / dsh providers (the two override rows
  disabling the official same-named tool rows are carried verbatim from the
  codex / claude-code patches). `local-agent-tool-subagent` and
  `local-agent-dsh-headless` are card-less deps-only libraries: they enter
  `dependencies` (and `ALLOWED_EDGES`) but no patch rows beyond what the
  members' canonical rows already name.
- `packages/bundle-conversation-toolbox`「会话工具箱」— members: message-tools,
  message-timeline, session-title-edit, quote, inline-html-render,
  context-guard, taskpilot (one canonical row each).

Each carries a spec pinning patch ↔ `FAMILY_MEMBERS` constant ↔ manifest
(membership, verbatim-row reuse, quoting, dependency and reference
registration), reading the members' own patches as the source of truth.
`dsh.compat.minHost` is each family's highest member floor (`0.1.5-rc.1` for
both).

## Alternatives considered

- **ALLOWED_EDGES-style central allowlist for bundle rows.** Rejected: the
  allowlist would duplicate what each member's own patch already says and drift
  silently. Deriving "may mount" from the members' canonical rows keeps one
  source of truth — a member renames its row and the bundle either follows
  verbatim or fails the checker.
- **Members as `dsh.references` only (no dependency edges).** Rejected: the
  install contract is "installing me installs the family" — only an npm
  dependency makes the member's module resolve in the installing profile. The
  reference registration rides alongside as data (roster for pack-time checks
  and the wave-3 catalog); the exclusivity rule's member exemption records that
  deliberate both-ness.
- **Bundle patches re-expressing rows (own ids, trimmed configs).** Rejected by
  the verbatim rule: a family bundle re-mounts, it never invents. Row identity
  is stable across moves (the proposal's "挪窝不换 id"), so sessions and
  settings referencing a row id survive a package's migration into a bundle.
- **One uber-check skipping family bundles wholesale.** Rejected: the exemptions
  are exactly as wide as the shape requires (canonical-row matching), and the
  strict half (members real/self-mounting/declared/covered, no own surface)
  keeps the kind from becoming a laundering path for foreign rows.

## Consequences

- `dsh plugin add @khorsheed/dsh-bundle-local-agent` (or
  `-bundle-conversation-toolbox`) on a profile mounts the whole family as one
  bundle card; members installed directly keep self-mounting, and overlap is
  resolved by the official row-level switches. Neither bundle is installed into
  any repo profile, deployed, or published in this change — that is wave 2's
  profile swap and npm wave.
- The checker's spec suite covers the positive shape (including a provider row
  naming a deps-only family library) and every strict-half failure mode; the
  real tree scans clean (43 packages, 0 findings).
- `docs/packages.md` was regenerated (the two bundles appear as self-mounting
  `bundle` form rows; they are in no profile).
- Wave-1 acceptance on the 3093 instance (card grouping, row switches) is
  deliberately NOT part of this change and remains open in the proposal.
