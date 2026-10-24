# @khorsheed/dsh-gamedev-suite

English | [中文](README.md)

The game dev mode in one install: the `dsh-gamedev` agent preset plus the game workbench — build a small 2D web game together with the agent: the conversation decides what the game is, and the right-sidebar 游戏 tab shows the chaptered design doc and plays the latest version that passed the end-of-turn checks. One 「游戏开发模式」 card in the inventory; a session switched to this mode gets the `game_open` / `game_read` / `game_publish` tools and the game skills automatically.

## What the mode is

Game dev mode is the developer-and-design-mentor persona plus the game workbench: open questions get two or three concrete options for you to pick between, the smallest playable version lands early and iterates from how it feels, and at the end of every turn the plugin runs its checks — a failure goes back into the conversation to be fixed in the same turn. Switch a session to 「游戏开发模式」 in the mode selector and they are there; no other session sees any of them.

## Members

| member package | row ids | contents |
| --- | --- | --- |
| `@khorsheed/dsh-game` | `game`, `game-agent` (granted by this bundle's preset) | game development: the gameStore service, the right-sidebar 游戏 design workbench (tunable params, look editor, chaptered design doc, versions and rollback), and the end-of-turn checks |

The game tools and skills (the game's `./agent` entry) are not mounted at the profile root by this pack; they are granted per session by the `game-agent` grant inside this bundle's preset row. Installed alone, the member's own patch mounts that entry enabled for every session, and under host 0.2.x a session of this mode sees the scoped copy shadow the global row — no double registration, no boot failure (pinned by the host's scoped.spec.ts).

## Install

Paste the package name `@khorsheed/dsh-gamedev-suite` into the host's add-plugin dialog (or pick it from the marketplace index), confirm, and restart the instance — this one install brings the member along as a dependency, and the bundle's own patch mounts both the mode preset and the member rows. Then switch a session to 「游戏开发模式」 in the mode selector.

The CLI equivalent:

```sh
dsh plugin --profile web add @khorsheed/dsh-gamedev-suite
```

```sh
dsh plugin --profile web remove @khorsheed/dsh-gamedev-suite
```

Removing the bundle removes the member along with the mode preset; to keep the member and disable a single row, use the row-level switches on the bundle detail page.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.2.0-rc.1`): ✅ full — pure composition; the floor is the member's own (minHost `0.2.0-rc.1`, game's floor). Member behavior details live in the member's own Compatibility section.
- source line (deepseek-harness master): ✅ full (verifiedHost: 0.2.1-rc.1).

**Version-line map**: `0.1.0` and later require host `0.2.0-rc.1` and up.

## Known Limitations

- **Removal is all-or-nothing** — removing this package removes the member along with it; to disable a single row, use the row-level switches on the bundle detail page.
- **The preset row mirrors @khorsheed/dsh-presets** — the two copies are byte-identical in composition, pinned by the repo's parity spec; once the presets package retires, this file is the canonical copy.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**A mode bundle = a family bundle plus one mode preset row.** The member rows in `cordis.patch.yml` come verbatim from the member's own `cordis.patch.yml` (the `game-agent` companion composition row stays out of the patch — it lives only in the preset composition below); the closing `preset-dsh-gamedev` row (an `@deepseek-ai/dsh-agent-preset` declaration) is mirrored verbatim from `@khorsheed/dsh-presets`, with `scripts/preset-mode-parity.spec.ts` pinning the two copies' plugin composition and display fields against drift. The repo-wide check:plugins `dsh.bundle.kind: 'mode'` sanction pins the whole shape mechanically: rows may only come from the allowlist union of member canonical rows minus the companion composition rows plus exactly one `preset-<mode>` row, every subtracted companion row must be granted by this bundle's preset composition, members must be real self-mounting packages each contributing at least one row, and the mode value is unique across the tree.

**Installing me installs the member and the mode — without double-mounting.** The member is listed in `dependencies` (installation brings it along) and registered in `dsh.references` (the roster, read by pack-time and catalog checks). `dsh plugin add` reconciles only the profile's *direct* dependencies into the bundles layer (`reconcilePlugins`) — installing this bundle applies THIS patch only; the member's own patch stays inert, so no row ever mounts twice. A member installed directly still self-mounts; any overlap is resolved by the row-level switches on the bundle detail page.

**`src/index.ts` exports only constants** (`MODE` / `FAMILY_MEMBERS`) so the package has a buildable `lib/` (a pack-dist requirement).

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/gamedev`). Issues and contributions welcome there.
