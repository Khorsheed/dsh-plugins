# Agent Note: the 3d-artifact skill ships with file-preview and registers at apply

Status: implemented

English | [中文](2026-08-21-3d-artifact-skill-registration.zh.md)

## Problem

Sandbox-runnable 3D HTML (three.js scenes, digital twins) must obey a strict generation-side contract — single-file self-contained, zero runtime network, GLB-inline zero-fetch models — or it fails silently inside the sandboxed preview (`connect-src 'none'` blocks every fetch, including three.js's `data:`-URI buffer loads; verified in M0 of the [file-view-html-rendering proposal](../../../proposals/active/2026-08-21-file-view-html-rendering.md)). The contract only reaches a generating model if it is discoverable at generation time, and the plugin family must ship it so community installs get it with zero official-code changes.

## Decision

The skill ships with `@khorsheed/dsh-file-preview` at `packages/file-preview/skills/3d-artifact/SKILL.md`, is globbed into the package `files` (`skills/**/*.md`), and is registered at apply by the `FilePreviewService` constructor through the optional `skills` service — the same pull-based pattern as ankh-guard's restart-skill registration: `ctx.get('skills')` probe, SKILL.md frontmatter parsed for `name`/`description`, `ctx.effect(() => skills.register({ name, description, content }))`. Missing capability or malformed file degrades to a warning — a discovery aid never takes a boot down; the pack-smoke test (`tests/skill-registration.spec.ts`) owns the file's presence in the tarball and asserts the registered content. The registration carries `provider: 'file-preview'`; because the bundle is content-only (only `SKILL.md`, no sibling scripts/assets) it deliberately omits `resourceBase` — the capability-catalog protocol renders such a skill as a virtual single-`SKILL.md` node, and `resourceBase` is added only when the bundle gains resources beside `SKILL.md`. The absent-capability path logs `skills capability absent — the 3d-artifact skill is not registered` (warn, same diagnostic shape as ankh-guard's restart-skill registration) so a host-API migration that drops or renames the skills service surfaces in boot logs instead of failing silently.

The contract content (hard rules): single-file self-contained (JS/CSS inline, images `data:`); zero runtime network; models MUST be GLB base64 decoded via `atob` → `parse(arrayBuffer)` — never a `.gltf` JSON whose buffer is a `data:` URI (three r152 resolves `data:` URIs through `fetch`, blocked by the CSP); libraries only from whitelisted CDNs (jsdelivr/cdnjs) via an inline importmap; the Tier1 meta CSP embedded in `<head>`; size red lines (GLB ≤ 6 MB raw ≈ 8 MB base64, page ≤ 16 MB).

## Alternatives considered

- **AGENTS.md standing rule / post-generation lint script / `gen_3d_artifact` tool**: deferred by the proposal decision — a skill is the cheapest reliable channel, and contract violations fail visibly (renderer falls back to static/source view) so the lint/tooling has a concrete reintroduction trigger instead of being built speculatively.
- **A separate package for the skill**: rejected — file-preview owns the HTML-preview family, ships in the same install, and the skill is a few KB of guidance, not a feature.

## Consequences

- Community users installing `@khorsheed/dsh-file-preview` get the generation contract for free; zero official-code changes.
- Registration is optional and defensive: exotic compositions without the `skills` capability skip it silently; a missing/malformed SKILL.md warns, never crashes.
- The skill is a pull channel: models only load it when the task matches its description (progressive disclosure), so non-3D tasks pay no context cost.
- The skill content will evolve with M3 of the file-view-html-rendering proposal (3D milestone); the reference implementation is the `02-gltf-inline` demo page pattern.
