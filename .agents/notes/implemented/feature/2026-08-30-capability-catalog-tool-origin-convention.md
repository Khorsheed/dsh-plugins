# Agent Note: capability-catalog tool-origin convention + guidance UI and skill source tags

Status: implemented

English | [中文](2026-08-30-capability-catalog-tool-origin-convention.zh.md)

This note records the community tool-origin tagging convention, its catalog-side attribution, the tools-tab guidance UI, and the skill source-tag fix, shipped in `@khorsheed/dsh-capability-catalog`.

## Problem

`ToolSchema` carries no source/owner field, so `attributeToolChannel` inferred a tool's channel (`mcp__` prefix / official whitelist / apply-time baseline diff), and community plugin tools (`subagent_kimi`, `subagent_dsh`, …) fell into 内置. Prior fragile attempts (composition scanning for `@khorsheed/*` rows, a `subagent_*` naming heuristic) were reverted: they were brittle and useless to the wider community. The wanted a general mechanism that lets community authors classify their own tools.

## Decision

**A register-time origin convention, read back via `ctx.tools.get()`.** All model-visible tools pass through `ctx.tools.register(definition)`, the registry keeps the definition by reference, and the system-prompt assembly projects tools to `{ name, description, parameters }` (so a side tag must be read via `get()`, not from the assembly).

- `tool-origin.ts`: `TOOL_ORIGIN = Symbol.for('dsh.tool.origin')`, `setToolOrigin(def, origin)`, `toolOrigin(def)`, `ToolOrigin { channel: 'plugin'|'builtin'|'mcp'; owner? }`. Re-exported from the package main so plugins can `import { setToolOrigin }`; plugins may also write `def[Symbol.for('dsh.tool.origin')]` directly (zero new dependency).
- Attribution: `index.ts` builds `toolOriginsMap(scope)` by reading each visible tool via `ctx.tools.get(name)` + `toolOrigin(def)`; threads it through `catalogSnapshot`/`projectTools`/`attributeToolChannel`, which honors an author-declared `channel` (exact) before the whitelist/baseline fallback. Untagged tools degrade to the existing heuristics.
- Guidance UI: a quiet, left-aligned 「为什么我的插件工具不在这里？」 link beside the tools segment bar opens a modal explaining the cause, showing the guideline doc path (`docs/tool-origin-guide.md`) and copying a complete ready-to-send instruction (referencing that doc) for the user's agent.
- Skill source tags + segment filter: the skill card labels by the real `source` (bundled→内置, runtime→插件, project-*/custom/user-* → project/custom/user), the delete button is driven by `DELETABLE_SOURCES` (no longer reusing the 内置 tag), and the skills tab gained a shared `SegmentBar` (全部/内置/插件/其他 — other = project/user/custom) mirroring the tools segment filter (one shared `SegmentBar` component, one `.segBar`/`.segBtn` style).

## Alternatives considered

- **Composition scanning (`@khorsheed/*` rows) + `subagent_*` heuristic.** Reverted as brittle/community-useless; replaced by the register-time tag.
- **Inline copyable code in the guidance modal.** Rejected: pasting code without context is error-prone; the modal points the agent at a doc to read instead.
- **Reuse the 内置 tag for the skill non-deletable semantic.** Rejected (already conflated); delete visibility now uses `DELETABLE_SOURCES`, and the tag uses `source`.

## Consequences

- Tagging is optional/incremental and additive; untagged tools keep the heuristic fallback (never break).
- Shared tool modules (e.g. `dsh-local-agent-tool-subagent`) must derive `owner` from their own config, not hardcode a package (README + AGENTS.md).
- Catalog-only change; `tool-origin.ts` added to `tsconfig.host.json`. Build + 71 host-side tests + `check:plugins` green; the ready-to-ship `GEN_TYPERT_ONLY`-scoped build avoids a concurrent `packages/datasets` typert stack-depth error (see that change for the convention tag).
- Convention is codified in `AGENTS.md` (Tool origin tagging) and `docs/upstream-seam-registry.md` S12.
