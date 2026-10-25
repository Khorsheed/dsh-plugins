# Agent Note: walkable models and groundAt

Status: implemented

## Problem

dsh3d took the ground height only from the terrain's height function. A 3D village has stairs, platforms, bridges and roofs, and a character could not stand on any of them. A game could raycast its own meshes, so this was a convenience, not a wall (see the [boundary note](../architecture/2026-10-25-game-plugin-boundary.md)). But nearly every 3D game with buildings needs it, and the right ray is easy to get wrong: a ray cast from far above lands on the roof instead of the floor.

## Decision

- `world.walkable(object, on = true)` and `world.add(object, { walkable: true })` count a model as ground. Its world matrix is updated when it is marked. Inside a scene it is forgotten when the scene is left.
- `world.groundAt(x, z, fromY = Infinity)` casts straight down from `fromY` against the walkables and the terrain mesh (outline hulls ignore rays). It returns the highest hit at or below `fromY`, and falls back to the height function. A character passes its feet plus a step height, so it climbs a step but is never pulled up onto the roof above it. Without `fromY`, the topmost surface counts, which a game uses to detect a wall.
- The skill documents the walking pattern and states that this covers standing only, not collisions or slope limits.

## Alternatives considered

**Make every entity walkable by default.** Characters and props would become ground under each other. Marking walkables is explicit and cheap.

**A collision and physics layer** (walls, slopes, capsules). That is the job of a physics library, which a game can import. The plugin should not pretend to be one.

**Derive height from bounding boxes.** Cheaper, but wrong for stairs modeled as one mesh, ramps and roofs. The ray follows the real surface.

## Consequences

- A moving platform's matrix is current as of the last step or render, so a rider is at most one frame behind it.
- Each `groundAt` call casts one ray against every walkable. A village with hundreds of walkables should group them per scene, which scenes already do.
