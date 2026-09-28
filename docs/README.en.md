# docs index

English | [中文](README.md)

This directory is the repository's documentation layer, in four groups:

## Collaboration docs (how people work on this repo)

| Doc | Contents |
| --- | --- |
| [development.md](development.md) | The collaboration model: worktree development, the three paths (worktree → main → 3080, host tracking, npm waves), conflict rules |
| [ops.md](ops.md) | Deployment and operations: the three environments (link / tarball / npm), the self-serve `deploy:3080` flow, the ankh-guard restart gate, the stuck-deploy runbook |
| [publishing.md](publishing.md) | npm publishing best practices: staged publishing, the first-publish device flow for new package names, the failure-modes table |
| [plugin-visibility.md](plugin-visibility.md) | The plugin visibility convention: session-bound surfaces hide with the preset grant; cross-session surfaces are decided at the install layer |
| [tool-origin-guide.md](tool-origin-guide.md) | The model-tool origin tagging guide (`setToolOrigin`) |
| [host-migration-playbook.md](host-migration-playbook.md) | The host-version migration playbook (adapting across host lines) |

## Protocols and registries

| Doc | Contents |
| --- | --- |
| [dataset-authoring-protocol.md](dataset-authoring-protocol.md) | The dataset authoring protocol (the eval line's dataset/condition/plan formats) |
| [upstream-seam-registry.md](upstream-seam-registry.md) | The upstream seam registry: every host seam the plugins depend on, numbered for host-API audits |

## Machine-generated (do not hand-edit)

| Doc | Generator |
| --- | --- |
| [packages.md](packages.md) | `pnpm map:packages` — the authoritative package map (counts, shapes, profile membership) |
| [release-status.md](release-status.md) | `pnpm release:status` — per-package npm/repo versions and the host-compatibility matrix |

## Local workspace (not published)

The product roadmap (roadmap.md), design proposals (proposals/), acceptance records (acceptance/), and upstream-facing drafts (upstream-proposals/) are the maintainers' local design process — kept on disk, out of the public tree.

## Assets

| Dir | Contents |
| --- | --- |
| [screenshots/](screenshots/) | The screenshot pool referenced by docs (tracked via git add -f) |
