# @khorsheed/dsh-writing

English | [中文](README.md)

The writing mode in one install: the `dsh-writing` agent preset plus the writing family — the inspiration canvas and its full-length-novel genre. One 「写作模式」 card in the inventory; a session switched to writing mode gets the canvas collaboration tools, and a session bound to a 长篇小说 canvas gets the novel tools on top.

## What the mode is

Writing mode is a writer identity with the bilingual style contract (task modes, style rules, voice rules), file read/write and web retrieval, skills, and the per-session canvas tools (`canvas_read` / `canvas_write` / `canvas_propose_type`); when the session is bound to a full-length-novel canvas, the `novel_*` chapter, ledger and review tools appear as well. Switch a session to 「写作模式」 in the mode selector and they are there; no other session sees any of them.

## Members

| member package | row ids | contents |
| --- | --- | --- |
| `@khorsheed/dsh-canvas` | `canvas` | the inspiration canvas: cards, links and agent proposals on a topic canvas (the canvasStore/canvasBoard services and UI) |
| `@khorsheed/dsh-canvas-novel` | `canvas-novel`, `canvas-novel-agent` (granted by this bundle's preset) | the 长篇小说 genre: a story-memory engine for characters, foreshadowing and chapters, the reconciliation gate, and the canvas's pending-review strip and chapter pages |
| `@khorsheed/dsh-reader` | `reader`, `reader-tool` (granted by this bundle's preset) | the reader: feeds and articles, notes and discussing them; notes sync to canvas cards (added 2026-10-19) |
| `@khorsheed/dsh-transcribe` | `transcribe` | local transcription: the reader's caption-less videos and podcasts transcribed on this machine (added 2026-10-20) |
| `@khorsheed/dsh-capture` | `capture` | rendered fetch: renders JS-heavy pages in headless Chrome so the reader can extract them (moved here from the basic bundle 2026-10-20) |

The canvas tool row (canvas `./agent`) is live for EVERY session in the member's own patch — the community default. The mode pack mounts neither agent row at the profile root and carries no disabling override: the grants live only in the preset composition, and under host 0.2.x a writing-mode session sees the scoped copy shadow the global row — no double registration, no boot failure (pinned by the host's scoped.spec.ts).

## Install

Paste the package name `@khorsheed/dsh-writing` into the host's add-plugin dialog (or pick it from the marketplace index), confirm, and restart the instance — this one install brings every member along as dependencies, and the bundle's own patch mounts both the mode preset and the family rows. Then switch a session to 「写作模式」 in the mode selector.

The CLI equivalent:

```sh
dsh plugin --profile web add @khorsheed/dsh-writing
```

```sh
dsh plugin --profile web remove @khorsheed/dsh-writing
```

Removing the bundle removes the whole family including the mode preset; to keep the family and disable a single row, use the row-level switches on the bundle detail page.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.2.0-rc.2`): ✅ full — pure composition; the floor is the members' highest (minHost `0.2.0-rc.2`, canvas-novel's floor; canvas itself floors at `0.1.5-rc.1`). Per-member behavior differences are documented in each member's own Compatibility section.
- source line (deepseek-harness master): ✅ full (verifiedHost: 0.2.1-rc.1).

**Version-line map**: `0.1.0` and later require host `0.2.0-rc.2` and up.

## Known Limitations

- **Removal is all-or-nothing** — removing this package removes every member along with it; there is no "drop one member from the bundle" — disable single rows via the row-level switches on the bundle detail page.
- **The preset row mirrors @khorsheed/dsh-presets** — the two copies are byte-identical in composition, pinned by the repo's parity spec; once the presets package retires, this file is the canonical copy.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**A mode bundle = a family bundle plus one mode preset row.** The member rows in `cordis.patch.yml` come verbatim from the corresponding member's own `cordis.patch.yml` (the two members' `./agent` companion composition rows stay out of the patch — they live only in the preset composition below); the closing `preset-dsh-writing` row (an `@deepseek-ai/dsh-agent-preset` declaration) is mirrored verbatim from `@khorsheed/dsh-presets`, with `scripts/preset-mode-parity.spec.ts` pinning the two copies' plugin composition and display fields against drift. The repo-wide check:plugins `dsh.bundle.kind: 'mode'` sanction pins the whole shape mechanically: rows may only come from the allowlist union of member canonical rows minus the companion composition rows plus exactly one `preset-<mode>` row, every subtracted companion row must be granted by this bundle's preset composition, members must be real self-mounting packages each contributing at least one row, and the mode value is unique across the tree.

**Installing me installs the family and the mode — without double-mounting.** All members are listed in `dependencies` (installation brings them along) and registered in `dsh.references` (the family roster, read by pack-time and catalog checks). `dsh plugin add` reconciles only the profile's *direct* dependencies into the bundles layer (`reconcilePlugins`) — installing this bundle applies THIS patch only; the members' own patches stay inert, so no row ever mounts twice. A member installed directly still self-mounts; any overlap is resolved by the row-level switches on the bundle detail page.

**`src/index.ts` exports only constants** (`MODE` / `FAMILY_MEMBERS`) so the package has a buildable `lib/` (a pack-dist requirement).

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/writing`). Issues and contributions welcome there.
