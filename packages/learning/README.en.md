# @khorsheed/dsh-learning

English | [中文](README.md)

The learning mode in one install: the `dsh-learning` agent preset plus the library — project-organized deep reading (book ingestion, roadmaps, knowledge cards, graded quizzes) with a close-reading coach. One 「学习模式」 card in the inventory; a session switched to learning mode gets the library tools and the coach persona automatically.

## What the mode is

Learning mode is the close-reading coach persona (reading WITH the learner, not for them) plus the library's model face: `library_read`, one write tool per noun, and the `library_assess` grading tool; web tools verify editions and source links, long sessions compact, the skill face is whitelisted, and the shell is guarded. Switch a session to 「学习模式」 in the mode selector and they are there; no other session sees any of them.

## Members

| member package | row id | contents |
| --- | --- | --- |
| `@khorsheed/dsh-library` | `library` | the library: project-organized deep reading — book ingestion, roadmaps, a vocab book and graded quizzes (the service core and the learning sidebar) |
| `@khorsheed/dsh-canvas` | `canvas`, `canvas-agent` (granted by this bundle's preset) | the inspiration canvas: put what you read into your own words as cards and drafts (added 2026-10-19) |
| `@khorsheed/dsh-reader` | `reader`, `reader-tool` (granted by this bundle's preset) | the reader: feeds and articles, notes, discussing them, and 「让Agent考考我」 (added 2026-10-19) |
| `@khorsheed/dsh-transcribe` | `transcribe` | local transcription: the reader's caption-less videos and podcasts transcribed on this machine (added 2026-10-20) |

The library's model face (the tools, the coach guidance section, the library skill) is not a profile-root row: it is the library package's `./tool` composition entry, granted per session by the `library-tool` grant inside this bundle's preset row. The canvas's `./agent` and the reader's `./tool` are granted the same way (`canvas-agent`, `reader-tool`), and both right-Sidebar tabs self-hide on those rows — they appear only in learning- and writing-mode sessions.

## Install

Paste the package name `@khorsheed/dsh-learning` into the host's add-plugin dialog (or pick it from the marketplace index), confirm, and restart the instance — this one install brings the member along as a dependency, and the bundle's own patch mounts both the mode preset and the member row. Then switch a session to 「学习模式」 in the mode selector.

The CLI equivalent:

```sh
dsh plugin --profile web add @khorsheed/dsh-learning
```

```sh
dsh plugin --profile web remove @khorsheed/dsh-learning
```

Removing the bundle removes the member along with the mode preset; to keep the member and disable a single row, use the row-level switches on the bundle detail page.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.7-rc.1`): ✅ full — pure composition; the floor is the member's own (minHost `0.1.7-rc.1`, library's floor; the preset-row mechanism is the same line). Member behavior details live in the member's own Compatibility section.
- source line (deepseek-harness master): ✅ full (verifiedHost: 0.2.1-rc.1).

**Version-line map**: `0.1.0` and later require host `0.1.7-rc.1` and up.

## Known Limitations

- **Removal is all-or-nothing** — removing this package removes the member along with it; to disable a single row, use the row-level switches on the bundle detail page.
- **The preset row mirrors @khorsheed/dsh-presets** — the two copies are byte-identical in composition, pinned by the repo's parity spec; once the presets package retires, this file is the canonical copy.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**A mode bundle = a family bundle plus one mode preset row.** The member row in `cordis.patch.yml` comes verbatim from the member's own `cordis.patch.yml`; the closing `preset-dsh-learning` row (an `@deepseek-ai/dsh-agent-preset` declaration) is mirrored verbatim from `@khorsheed/dsh-presets`, with `scripts/preset-mode-parity.spec.ts` pinning the two copies' plugin composition and display fields against drift. The repo-wide check:plugins `dsh.bundle.kind: 'mode'` sanction pins the whole shape mechanically: rows may only come from the allowlist union of member canonical rows plus exactly one `preset-<mode>` row, members must be real self-mounting packages each contributing at least one row, and the mode value is unique across the tree.

**Installing me installs the member and the mode — without double-mounting.** The member is listed in `dependencies` (installation brings it along) and registered in `dsh.references` (the roster, read by pack-time and catalog checks). `dsh plugin add` reconciles only the profile's *direct* dependencies into the bundles layer (`reconcilePlugins`) — installing this bundle applies THIS patch only; the member's own patch stays inert, so no row ever mounts twice. A member installed directly still self-mounts; any overlap is resolved by the row-level switches on the bundle detail page.

**`src/index.ts` exports only constants** (`MODE` / `FAMILY_MEMBERS`) so the package has a buildable `lib/` (a pack-dist requirement).

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/learning`). Issues and contributions welcome there.
