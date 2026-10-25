# Agent Note: glTF model looks (static)

Status: implemented

## Problem

The game agent's next slice is a character modeled in Blender (the user is learning it), then a corner of a village. A `{ kind: 'gltf', src }` look was accepted and validated, but dsh3d only drew a stand-in block. The [boundary note](../architecture/2026-10-25-game-plugin-boundary.md) had already opened `three/addons/` imports, so a game could load a glb in code. A look, though, is what the panel previews and edits, and only the plugin can make the panel understand one. The game agent asked for this first, ahead of walkable meshes and animation.

## Decision

- **Runtime.** `build()` stays synchronous. A gltf look returns the model's frame at once and fills it when the glb arrives; `model.userData.loaded` and an exported `loaded()` resolve when loads finish. By default (`material: 'toon'`), each material becomes the style's toon material over the model's own color, vertex colors, texture, emissive, transparency and alpha test, with the ink outline hull on every non-skinned mesh. `material: 'original'` keeps the glb's materials, and `outline` switches the hull on or off separately. A failed load goes to `console.error`, which the checks report, and falls back to the look's `recipe` or a stand-in block. `world.add` shades a model again once it loads (shadows), and `scatter` instances a glb look after it has loaded.
- **Loading inside the sandbox.** three's loaders build `Request`s from relative URLs, and those have no usable base in the sandbox (`about:srcdoc`, or the checks' `data:` page). So the loader exposes `window.__dshFileUrl(path)` (a project file's blob URL), and dsh3d's GLTFLoader maps every model, `.bin` and texture path through a `LoadingManager` URL modifier. GLTFLoader (with BufferGeometryUtils) rides every 3D bundle, because a panel preview may load a model the live version does not carry yet.
- **Checks.** After `ready`, the checks await `window.__dshPending()` (dsh3d's in-flight loads, up to the 20 s loading window) before the smoke run, each test file and the screenshot. A gltf look whose `src` is not among the build files fails the check, naming the element and the file. `glb` and `gltf` get MIME types.
- **Panel.** Previews (the turntable, card stills, proposal stills) fetch the working copy of the look's file through a new `workingFile` Remote (build files inside the project, 8 MB at most), so a model exported a moment ago shows before any version carries it. The preview entry re-fits once the model loads and takes its still only after that. Switching `src` reloads the frame. The element page shows the file, a toon / own-materials switch and a size field.
- **Skill.** It covers the look format, export advice (Y up, meters, origin at the feet, textures packed in the glb, at most 10k triangles), the CC0 rule (`assets/LICENSES.md`), and the fact that animation is not wired yet.

## Alternatives considered

**An async `build()` (returning a promise).** Every existing call site, `scatter` and the live rebuild assume a model back at once. A frame that fills later keeps them working, and `loaded` covers the cases that need to wait.

**Load with a plain relative `fetch` or `GLTFLoader.load(path)`.** This fails in the checks' data-URL page and is fragile in the srcdoc frame. The file table is what the sandbox already trusts.

**Preview from the live version's bundle only.** The user would have to publish before seeing a freshly exported model, which defeats the point of previewing.

**Outline skinned meshes now.** The hull shader does not follow bones. That comes with animation (next step), together with skinned picking.

## Consequences

- The first frames of a game show models popping in. A game that cares sets `dshGame.loading` and awaits `loaded()` before `ready`.
- Toon mode replaces materials. PBR detail (roughness, metalness, normal maps) is dropped in favor of the style. `original` keeps it.
- A card still caches per live version and look. Re-exporting a glb under the same name refreshes the turntable but not the card until the next version.
- Each 3D bundle carries GLTFLoader and BufferGeometryUtils (about 150 KB unminified).
