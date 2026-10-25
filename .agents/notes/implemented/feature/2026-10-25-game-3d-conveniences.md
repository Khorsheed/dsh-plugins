# Agent Note: 3D conveniences — follow camera, rim light, swaying scatter

Status: implemented

## Problem

With the [doors open](../architecture/2026-10-25-game-plugin-boundary.md), a game could already build a third-person camera, extra lighting and wind itself. The game agent's list still named a follow camera, a rim light and swaying grass as the things a stylized 3D game reaches for first. These belong to the boundary's second layer: conveniences that most games want, that a game may skip, and that must never close a door.

## Decision

- **`world.followCamera({ target, distance, height, yaw, pitch, fov, mouse, sensitivity })`** sets up a perspective camera behind `target` and returns a rig. Its `yaw`, `pitch` and `distance` can change at any time; `rig.look(dx, dy)` takes mouse deltas, and pitch is clamped. The world places the rig's camera in `sync()`, so pick, rings and render all use it. `mouse: true` requests pointer lock on a click and turns the camera with locked mouse movement. A later `setCamera` with a different camera drops the rig.
- **`style3d.rim` (0–2) and `rimColor`** add a view-angle rim term to every toon material (cached, private and glTF toon). It is injected with `onBeforeCompile` under one program key and is left out entirely when the style has no rim. The manifest parser keeps both keys.
- **`scatter(…, { sway: { amplitude, period } })`** gives the copies (and their outline hulls) private material copies whose vertices bend with height on the world clock. Each copy is out of phase with the next, keyed by its instance position. Shadows stay still.
- **Glow stays a recipe, not a feature.** The skill shows bloom through `three/addons` (EffectComposer, RenderPass, UnrealBloomPass, OutputPass) inside `world.onRender`, with emissive `own` materials for the glowing objects. A test runs exactly that recipe, which also shows that the add-on resolver follows EffectComposer's import chain.

## Alternatives considered

**A built-in bloom switch.** Post-processing changes every frame's cost and the screenshots the checks take, and a game that wants bloom usually wants to tune it. With the render hook in place, a tested recipe gives the same result without making every game pay for it.

**Collision for the follow camera** (pulling in when a wall is between the camera and the player). That depends on the game's geometry and walkables. The rig's `distance` is open for a game to shorten.

**Sway through the shadow depth material too.** Doubles the shader work for a detail rarely visible in stylized shadows.

## Consequences

- Existing games are unaffected: every switch is off unless written.
- Rim light lightens the edges of all toon surfaces, so it is a style decision and is described to the agent as one.
- Swaying copies use private materials, so a style change does not reach them until they are built again (a scene switch or a reload).
