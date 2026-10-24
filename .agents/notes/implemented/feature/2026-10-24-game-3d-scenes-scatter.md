# Agent Note: 3D scenes, instanced scatter and render-free checks

Status: implemented

## Problem

A game agent building a map of several mountains (a world map plus three areas that differ in climate) asked for four things from the 3D kit, and the code review backed each one:

- dsh3d had one world-wide terrain, height function and style. `terrain()` added a second ground instead of replacing the first. Background and fog were fixed at `createWorld`. `onUpdate` callbacks could not be removed. So "switch to the next mountain" meant reaching into the kit's internals and freeing resources by hand.
- Repeated scenery (92 pines) was cloned mesh by mesh, and a hand-instanced forest could not be picked in 「指一下」.
- Inside the checks every `step` rendered a frame, and a test file gets 8 seconds, so a growing game would time out its own tests.
- The skill said almost nothing about `assets/`, so agents believed a project could not carry images or sounds.

The agent also claimed that GLB models could be imported and that multiple scenes were a prerequisite. Both claims were wrong (a gltf look is still a stand-in block, and `world.scene` was always reachable), and both are recorded here so the next proposal does not repeat them.

## Decision

- **Scenes.** `world.enterScene(name, setup, { style })` leaves the current scene first. Every entity, scatter, `onUpdate` callback and terrain registered inside the previous scene is removed and released. The kit's shared cached materials are spared, and things registered outside any scene (the player, the camera follow) stay. The new scene then applies its style overrides — `game.json` `style3d.scenes[name]`, then `opts.style` — for background, ground colors, water, fog and light, and runs `setup`, whose registrations belong to the new scene (they live under a `scene:<name>` group). Shading bands and the ink outline stay game-wide, because every material shares them. A new `terrain()` replaces and frees the old ground in any case. `pick` answers the current `scene` name, and `onUpdate` returns an unsubscribe function.
- **Scene styles are the game's data.** `style3d.scenes` is keyed by the game's own names. The plugin ships no scene names or scene presets. `parseManifest` keeps only colors, fog and light per scene (at most 32 scenes), so a panel rewrite of `game.json` (finalize, auto-confirm, the one-pager) keeps them. Storing them as data, not in code, leaves room for the panel to edit one scene's style later.
- **Scatter.** `world.scatter(idOrLook, countOrPoints, { seed, spread, center, rotate, scale })` builds the look once and turns every mesh into an `InstancedMesh`. Each copy lands on the terrain height with a seeded random facing and size, so a reload looks the same. The ink outline's vertex shader now honors `instanceMatrix`, so copies keep their outline. A hit on a copy resolves to the element with `inst: 'id#n'`. `triangles()` counts every copy. `highlight` skips scatters, because a ring around a whole forest says nothing. A live element rebuild re-instances at the same spots.
- **Render-free checks.** Under `window.__GAMEDEV_TEST__`, `step` advances logic and synchronizes the camera pose and world matrices, but never draws: existing tests that project screen points keep working. `pick` synchronizes the same way. The 3D kit's blank probe calls `dsh3dWorld.render()` once before it reads the canvas, so a game that never draws is still caught.
- **Skill.** It now covers `assets/` (formats, relative paths, no network, the 8 MB file / 48 MB project limits), `TextureLoader` and `CanvasTexture`, the fact that gltf looks show a stand-in for now, scenes, scatter, and the render-free checks. The 150k-triangle figure is labeled as advice, counted per scene.

## Alternatives considered

**`world.swap(group)` (swap one group).** This was the first sketch. The game agent pointed out that terrain, style and `onUpdate` callbacks are world-wide, so swapping a group still leaves the game freeing kit internals by hand. Scenes own all of it.

**Per-scene shading bands and outline width.** These are properties of the shared material cache. Switching them per scene would rebuild every material, the player's included. Colors, fog and light already separate wet green hills from a snow ridge.

**Scene styles passed only from code.** This is freer and needs no schema, but the panel could never show or tune them. The user chose data.

**LOD and chunked terrain.** These are not needed yet; one scene at a time already bounds what is drawn.

## Consequences

- A game that never calls `enterScene` behaves as before, except that a second `terrain()` call now replaces the first instead of stacking on it.
- Scattered copies are static: no per-copy motion, and no per-copy entity state.
- Tests that read pixels must call `world.render()` first; logic tests get faster.
- Loading glTF stays a separate, larger piece of work (a loader plus a panel preview).
