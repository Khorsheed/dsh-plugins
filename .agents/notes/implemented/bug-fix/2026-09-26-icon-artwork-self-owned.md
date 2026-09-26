# Agent Note: client bundles inline the rc.1 icon artwork from package-owned generated modules (the icon name lines share zero exports)

Status: implemented

## Problem

The two supported host lines export disjoint icon sets from `@deepseek-ai/dsh-client-ui-primitives`: 0.1.5 names carry pixel suffixes (`IconCheckOutline16`, `IconChevronDownOutline14`; 75 exports), rc.1 names carry weight suffixes (`IconCheckOutlineMedium`; 93 glyphs × Regular/Medium = 186 exports) — no name exists on both lines. Community client bundles externalize ui-primitives as a platform module, so every `Icon*Medium` reference the rc.1 adaptation wave introduced resolves to `undefined` on a 0.1.5 host: React throws #130 (element type is undefined) and the whole slot fails to render — `conversation.session.header.actions` and `conversation.chat.node` were observed dead on the 0.1.5 proof instance. Twenty packages imported forty icon names from the package root.

## Decision

Each of the twenty packages owns a generated, committed `src/client/icons.tsx` exporting the same component names it used to import (`IconCheckOutlineMedium` et al.), produced by `scripts/sync-icon-artwork.mts` from the harness checkout's `packages/client/ui-primitives/src/icons/{index.tsx,shared-artwork.tsx}`. The generator parses the upstream module's uniform shape (weight wrapper → artwork const → shared `IconProps`, stroke consts `ICON_REGULAR_STROKE`/`ICON_MEDIUM_STROKE`, the shared path consts), flattens each used icon into a self-contained SVG component (stroke width inlined as a literal, artwork size default preserved, composite artworks and the shield path const folded in), sorts deterministically, and refuses to overwrite a module without its generated marker — canvas's and message-tools' pre-existing hand-written icon files moved to `icons-local.tsx` for exactly that reason. Call sites change only the specifier (`./icons.tsx` relative, never the package root); non-icon primitives (Button, Modal, FileTypeIcon, …) stay on the externalized root — they carry host theme/context identity and verified-present on 0.1.5. The purity gate needed no change: relative imports never touch its `@deepseek-ai/*` rule.

Icons are pure artwork with zero host runtime state, so a per-bundle copy is behavior-identical on every host line — the dsh-client-store inline precedent. Sizes: every bundle grew between +0.4 KB and +18.5 KB (tree-shaken to the used glyphs).

## Alternatives considered

**Runtime name picking** (import both name spellings, select by detected host line). Rejected at design time: a lookup table of ~40 names × 2 lines in every bundle, a detection heuristic that can be wrong on the next host line, and a React element-type failure mode that becomes silent again the day a name drifts — the inline artifact cannot be wrong at runtime because there is nothing left to resolve.

**Import the official `src/icons/index.tsx` through the `./src/*` export.** Rejected on evidence: the npm artifact ships no `src/` (the export's target files do not exist in the install tree), so the specifier resolves only inside the vitest source plane and fails both tsc and tsdown at build time. Verified by direct resolution test from a package directory.

**A tsdown env alias to the harness checkout plus per-package ambient declarations for tsc.** Rejected: two parallel resolution channels that must never disagree, and the ambient declarations would hand-copy forty symbol signatures that drift from upstream silently — strictly worse than vendoring the artwork, which at least drifts visibly.

## Consequences

Bought: the twenty client bundles are host-line-immune for icons — self-contained artwork, no resolution left to the install tree — and the 0.1.5 boot's React #130 slot crashes are gone (browser-verified on the 0.1.5 proof profile). The generator keeps the copies honest: re-run it after adding an icon import or bumping the harness checkout; `--check` fails on drift. `FileTypeIcon`/`CodeFileIcon` and every other non-icon root symbol we use were verified present in 0.1.5's root exports, so no second front of the same break exists today.

Cost: forty icon components are duplicated per consuming bundle (tree-shaken to the used set; ≤18.5 KB each), the copies track upstream only when someone re-runs the generator, and an upstream `./icons` publish export would retire the whole mechanism — the request is filed at [docs/upstream-proposals/2026-09-26-ui-primitives-icons-export.md](../../../docs/upstream-proposals/2026-09-26-ui-primitives-icons-export.md).

## Testing

`scripts/sync-icon-artwork.spec.ts` pins the parser and renderer on synthetic fixtures (nine cases: local/shared/fill/composite artwork flattening, stroke-const substitution, shared path-const emission, missing-name error, byte-idempotent output) plus a `collectIconUsage` fixture test; the real-run `--check` mode gates drift. All twenty packages' full build+test suites and the repo's script suite stay green.

## Related

- [typert-faced tarballs carry zod as a real dependency](../../implemented/bug-fix/2026-09-25-typert-faces-carry-zod-v4.md) — the sibling "bare import must be pinned by the artifact" fix; this note is the same lesson on the browser plane.
