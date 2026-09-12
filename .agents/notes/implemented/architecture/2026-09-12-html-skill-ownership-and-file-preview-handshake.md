# Agent Note: HTML skills belong to inline-html-render and file-preview UI requires a host handshake

Status: implemented

English | [中文](2026-09-12-html-skill-ownership-and-file-preview-handshake.zh.md)

## Problem

The read-only `@khorsheed/dsh-file-preview` host registered the model-facing `3d-artifact` authoring policy even though generating HTML is outside its filesystem/session-preview responsibility. Separately, mounting the client Remote descriptor did not prove that a host handler existed: a client-only composition still advertised a Produced tab, turn card, and history renderer that could only fail or appear empty.

## Decision

`3d-artifact` ships at `packages/inline-html-render/skills/3d-artifact/SKILL.md`. The inline HTML owner reads it alongside `inline-html-card` after `ctx.inject(['skills'])` becomes ready, and registers both runtime skills with `provider: 'inline-html-render'`. The read-only file-preview host no longer reads, ships, or registers authoring guidance. This note supersedes the ownership decision in the historical [3d-artifact registration note](../feature/2026-08-21-3d-artifact-skill-registration.md); that note remains unchanged as the record of the original decision.

The host Remote exposes a zero-session `capabilities()` method returning `{ protocolVersion: 1 }`. The browser companion mounts its descriptor, calls that method, and installs no locale, tab type/body, turn row, mention wrapper, or history renderer unless the response succeeds with protocol version 1. `installFilePreviewSurfaces(ctx, remote)` owns installation and disposal after the probe so tests can drive the boundary directly. Host-only, client-only, and paired compositions are pinned separately.

## Alternatives considered

- **Keep the skill in file-preview because that package renders saved HTML**: rejected because rendering and read-only filesystem access do not own model authoring policy; installing a read service must not silently widen model behavior.
- **Publish a third skill-only package**: rejected because inline-html-render already owns HTML authoring and already has the delayed runtime-skill registration lifecycle.
- **Treat a successful `$mount` as host availability**: rejected because it mounts a client descriptor, not the server handler, and was the source of the asymmetric-install defect.
- **Keep visible unavailable cards or an empty tab**: rejected because supported host absence is represented by absence of every dependent UI surface and needs no new error locale.

## Consequences

- Installing inline-html-render now exposes both HTML authoring skills under one provider; installing file-preview alone exposes no authoring skill.
- The paired Remote gains a versioned zero-session verb, so future incompatible client protocols can remain absent instead of partially installing.
- Client startup waits for one handshake before registering surfaces. A missing, failing, or incompatible host leaves no UI trace, while the mounted descriptor is still disposed with the client fiber.
- Tarball coverage moves with the skill directory, and tests verify both catalog registration and the three supported installation shapes.
