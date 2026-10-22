# Agent Note: game runtime kits

Status: implemented

## Problem

`@khorsheed/dsh-game` assumed 2D canvas everywhere: the frame bridge defined the pixel helpers (`dshDraw`, `dshLookSize`), element validation only knew pixel-row looks, the smoke check's blank probe copied the canvas through a 2D context, and the `gamedev` skill told the model "2D only". The next step is a 3D runtime (three.js, parts-recipe looks, a WebGL blank probe) without forking the workbench, and without breaking a single 2D project already on disk. `store.ts` had also grown to 1153 lines with the file helpers mixed into the service.

## Decision

A **runtime kit** owns everything that depends on how a game draws. `src/kits/types.ts` defines `RuntimeKit`:

| Member | What it covers |
|---|---|
| `runtimeFiles()` | Files added to every bundle under `_dsh/`: `_dsh/runtime.js` (the frame runtime), vendored libraries, `_dsh/imports.json` (bare module name → bundle path) |
| `normalizeLook` / `lookHint` | The look formats the kit accepts, and the model-facing reason when one fails |
| `blankProbe` | The in-page expression the smoke check uses to decide the screen is blank |
| `skillSection` | The kit's part of the `gamedev` skill |
| `styles` | The art styles the gate offers |

The existing behavior moved, unchanged, into the `2d-canvas` kit (`src/kits/canvas2d.ts`). `src/kits/index.ts` holds the registry (`KITS`, `DEFAULT_KIT`, `kitOf`, `withKitRuntime`); `src/kits/ids.ts` holds only the id list, so the manifest parser (shared with the browser half) can validate a kit id without importing a kit.

- **Manifest**: `game.json` takes an optional `runtime: { kit, version }`. A manifest without it, or naming an unknown kit, runs on `2d-canvas`; the parser never adds the key, so existing manifests round-trip byte-identical.
- **Bundles**: `store.bundle` / `versionBundle` and the end-of-turn check add the kit's files through `withKitRuntime`. Kit files are never written into version snapshots; a snapshot's own `game.json` picks the kit when it is played back. A project file at the same path wins.
- **Loader** (`src/vfs.ts`): the bridge keeps only the generic globals (`dshParams`, `dshElements`). The loader injects `_dsh/runtime.js` as a blob script right after the bridge and before the game's scripts, and rewrites bare `import` specifiers through `_dsh/imports.json` alongside the existing relative rewrite.
- **Checks**: `BrowserChecker.run` takes `{ blankProbe }` from the project's kit.
- **Store split**: the file helpers (`inside`, `writeAtomic`, `readText`, `readJson`, `walk`, `bundleOf`, `fingerprintOf`) moved to `src/fsutil.ts`.

## Alternatives considered

**A separate 3D package.** It would duplicate the project registry, versions, checks and panel, and every later fix would have to land twice. The workbench is engine-neutral, and the kit is the part that isn't.

**Branching on `if (is3d)` inside the store, checks and skill.** That is cheap for one extra runtime, but the proposal's goal is a general workbench, and each later runtime would add another branch in five places. One interface keeps a new runtime to one file.

**Copying kit files into each version snapshot.** That makes a snapshot fully self-contained, but three.js alone is about 700 KB and versions are kept ten deep. A snapshot pins its kit through its `game.json`, and `version` in `runtime` is there for the day a kit changes incompatibly.

**Keeping `dshDraw` in the bridge.** The bridge is installed twice (in the shell and in the written document) and is shared by every kit. Leaving 2D helpers there would put them in 3D games and keep the bridge kit-aware. The runtime script reaches the game at the same moment, before its own scripts.

## Consequences

- 2D projects behave as before; the only visible difference is an extra `_dsh/runtime.js` entry in a bundle, which the exported single-file HTML also carries.
- The `gamedev` skill still embeds the 2D kit's section statically. When a second kit lands, the kit section has to follow the bound project's kit (a per-kit skill, or `game_read` naming the kit and its section).
- Bare-import mapping is generic: any kit can vendor ES modules without the game knowing their bundle paths.

## Testing

`tests/project.spec.ts` pins runtime parsing (a shipped kit is kept, an unknown kit and a legacy manifest get no `runtime` key, `kitOf` falls back to 2D). `tests/checks.chrome.spec.ts` runs every headless case through `withKitRuntime` with the 2D kit, so the existing `dshDraw` case now proves the runtime injection, and a new case proves a bare import resolves to a vendored `_dsh/` module. `tests/store.spec.ts` expects `_dsh/runtime.js` in both the check run and the play bundle.
