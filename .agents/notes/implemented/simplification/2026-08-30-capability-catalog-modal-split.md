# Agent Note: capability-catalog client modal split into focused modules

Status: implemented

English | [中文](2026-08-30-capability-catalog-modal-split.zh.md)

This note records the behavior-preserving split of the single-monolith client file in `@khorsheed/dsh-capability-catalog` (the 工具与技能 settings tab) into focused modules, after consulting a code-reviewer (Codex) whose refinements shaped the final structure.

## Problem

`packages/capability-catalog/src/client/CapabilityCatalogCard.tsx` reached ~1808 lines with ~15 components. Two inner blocks were reused but copy-pasted across modals: the metadata row (`meta`/`metaItem`/`metaKey`/`metaVal`) in the tool-detail and skill-detail modals, and the credential config block (`credRow`/`credLabel`/badge/`inputWrap`/password + save state) in the skill and MCP-manage modals. Outer chrome was already centralized in a shared `ModalShell`.

## Decision

Split the file into focused `client/*.tsx` modules, extracting the shared pieces first, keeping ONE shared `CapabilityCatalogCard.module.css`:

- `CapabilityCatalogCard.tsx` — section/state shell (owns tab/segment/filter state + the Remote wiring; renders grids + modals).
- `ModalShell.tsx`, `SchemaView.tsx` (SchemaView/Tree/Node + helpers), moved verbatim.
- `MetadataRow.tsx` — presentational `MetadataRow({ items: {label, value}[] })`, no tool/skill knowledge baked in.
- `CredentialField.tsx` — a PRESENTATIONAL per-row credential component. Each modal (skill vs MCP manage) keeps its own `credValues`/`credState`/`saveCred` local; the field is deliberately narrow because the three call sites differ in save-state semantics (skill treats `state==='ok'` as configured and hides Save; MCP uses `decl.configured` and clears the value after a save without flipping the badge; the Add-MCP rows are pre-install inputs with no save state). A state-owning `CredentialConfig` would silently normalize those differences.
- `SkillCards.tsx` (SkillPreviewCard + DeleteSkillConfirm), `ToolCards.tsx` (ToolCard + ToolCards), `McpCards.tsx` (McpCard), `ToolDetailModal.tsx`, `SkillDetailModal.tsx`, `AddSkillModal.tsx`, `McpServerManageModal.tsx` (McpToolRow stays local), `AddMcpDialog.tsx`, `BundleFileTree.tsx` (BundleFileGlyph stays local).
- `mcp-model.ts` — shared MCP grouping/config transforms (`McpGroup`, `buildMcpGroups`, and genuinely-shared MCP helpers); tiny helpers stay beside their sole consumer.

## Alternatives considered

- **One state-owning `CredentialConfig` for all credential sites.** Rejected: skill / MCP-manage / Add-MCP credential save-state semantics differ; normalizing them would change observable behavior.
- **Split the single CSS module into per-file CSS modules.** Rejected for this pass: at ~1750 lines it should eventually follow component ownership, but doing so now turns a "relocation only" review into a large selector-movement diff. CSS Modules dedupe, so one shared module is safe here.
- **Keep the monolith and only extract the two duplicated blocks in place.** Rejected: the file would still be ~1600 lines and the modals would remain hard to navigate; the agreed goal was per-concern files.

## Consequences

- Pure structural change: no markup, class, state-ownership, logic, or locale-key change. Bundle size drifted slightly (331 → 327 kB) purely from module boundaries/tree-shaking.
- The new `client/*.tsx` files were added to the package's explicit `tsconfig.client.json` `files` list (the package uses an explicit list, not a glob).
- No component tests exist; gate is `build` + `test` (68 host-side tests) + `check:plugins`, which pass, plus a manual smoke pass on modal stacking/Escape, credential blur/Enter/Save, source default-collapse, and MCP mutation refresh.
