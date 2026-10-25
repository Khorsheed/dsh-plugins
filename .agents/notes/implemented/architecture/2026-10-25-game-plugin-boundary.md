# Agent Note: where the game plugin ends and a game begins; the 3D kit's open doors

Status: implemented

## Problem

The 3D game in progress (a stylized-low-poly game aiming at the level of 《A Short Hike》) asked for glTF models with skeletal animation, a follow camera, walkable platforms, shadows and glow. Answering it, the plugin maintainer first proposed deferring glow as too heavy. The user named the risk in that: a plugin that declines a feature as "too heavy" while the game cannot build it alone caps every game made with it. A review of the 3D kit found exactly such walls. A game could already reach `three` and `world.scene/camera/renderer`, but:

- the bare-import map knew only `three` and `dsh3d`, so three's own add-ons (GLTFLoader, EffectComposer) could not be imported normally;
- the camera was re-placed at the fixed 45° offset on every frame, and pick used that camera;
- the lights were private;
- drawing was a fixed `renderer.render`, with no place for post-processing;
- the checks failed a game that took longer than 4 s to get ready;
- the play frame refused pointer lock, and tests had no way to simulate a mouse drag;
- toon and flat materials were shared per color, so one object could not glow or change color alone.

## Decision

**The boundary.** The plugin works in three layers:

1. **What a game cannot touch, the plugin must do**: the sandbox, module loading, the checks, and everything the panel understands (look previews, elements, picking, scenes, versions).
2. **Conveniences most games want** (recipes, scatter, scenes, a future `groundAt`) are the plugin's to offer and a game's to skip.
3. **What few games need** (bloom, special cameras, physics) the plugin may decline, but it must leave a door so a game can build it alone.

A wall that only the plugin can open is a plugin bug and is fixed first. The gamedev skill tells the agent to say so plainly when it hits one, and to log it in `design/plugin-requests.md` instead of quietly degrading the game.

**The doors opened (all additive, defaults unchanged).** The runtime is not versioned per project: every 3D game, old versions included, runs the current dsh3d, so nothing here changes what an existing game does.

- **Add-ons.** The import map maps the prefix `three/addons/` to `_dsh/addons/`; the loader resolves prefix keys the import-map way. A bundle carries only the add-on files the project's scripts import, plus what those import in turn, read from the pinned three's `examples/jsm` (capped at 6 MB).
- **Camera.** `world.setCamera(cam)` makes the game's own camera (e.g. a perspective follow camera the game places each frame) the one used for rendering, pick and highlight; `setCamera(null)` restores the built-in camera. `world.camera` is a getter, and a perspective camera's aspect follows resizes.
- **Lights and shadows.** `world.lights.{ hemi, sun }` are exposed. `style3d.shadows: true` turns on a PCF-soft sun shadow whose box follows the target; meshes added with `world.add` and `scatter` cast and receive shadows (outline hulls do not), and the terrain receives them. The manifest parser keeps `shadows`.
- **Render hook.** `world.onRender(fn)` replaces the plain draw with `fn({ renderer, scene, camera })` and returns a function that hands drawing back.
- **Own materials.** `toon(color, { own: true, … })` and `flat(…, { own: true })` return private copies that keep the style's shading bands.
- **Loading.** While `dshGame.loading` is true, the checks wait up to 20 s for `ready` (4 s otherwise), and the failure message names the flag.
- **Mouse.** The play frame allows pointer lock (a click requests it, Esc releases it). `dshGame.look(dx, dy)` is an optional hook, and tests get `drag(dx, dy, frames)` to call it.

## Alternatives considered

**Defer glow and the follow camera as "plugin features".** This was the first proposal. Without the render hook and camera override, a game could not build either one, so deferring them would have capped every game.

**Ship the whole add-on tree under `_dsh/addons/`.** Every load would carry megabytes of unused code. Resolving the add-ons a project actually imports keeps the cost per game.

**Version the runtime per project now** (v1 and v2 side by side). Not needed while every change is additive. It becomes necessary at the first default that has to change.

**Build everything requested (bloom, follow mode, glTF looks) as plugin features right away.** Too slow, and it would make the plugin the bottleneck. With the doors open, the game agent can build glow and its camera itself today. Plugin conveniences (P2 walkable, P3 switches, P1 follow mode) and the glTF look path (static, then animated) follow in the order the game agent proposed.

## Consequences

- A game can now import GLTFLoader and place `.glb` models directly. The panel cannot preview or tune them as elements until the glTF look path lands.
- A game that takes over the camera or drawing owns that part. The workbench still picks and rings through whatever camera is current.
- The shadow box is fixed at 48 world units around the target. A game that needs more tunes `world.lights.sun.shadow.camera`.
- The loader accepts prefix keys for any kit's import map.
