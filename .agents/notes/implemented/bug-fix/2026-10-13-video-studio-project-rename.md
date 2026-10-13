# Agent Note: Projects stuck as 未命名工程 — empty names silently accepted, and the panel had no rename path at all

Status: implemented

## Problem

Creating a project from the 剪辑 panel could silently produce a project named 未命名工程 that could never be renamed. Three defects stacked:

1. The NewProject form submitted with an empty name (`service.ts` then fell back to 未命名工程). The name field's placeholder was a concrete-looking suggestion (`#23 · 这期聊了什么`) that read as prefilled content, so pressing 创建 — or pressing Enter inside the 新节目 name field, which implicitly submits the surrounding form — created an unnamed project.
2. `VideoStudioService.renameProject` existed but was orphaned: no `@Remote` verb, no pane contract entry, no UI — so a wrongly named project was permanent.
3. The misleading placeholder made (1) undetectable until after creation.

## Decision

- The 创建 button is disabled until the name is non-empty (`disabled={busy || !name.trim()}`). Disabling the form's submit button also blocks implicit Enter submission from the 新节目 field, so that path can no longer create an unnamed project either.
- `renameProject` is exposed end to end: `RenameProjectRequest` (types.ts), `@Remote('renameProject')` (remote.ts, origin `'user'` so the rename is logged as a PanelEvent), a pane contract + face entry, and a name row at the top of 设置 → 这期 (a `DraftInput`, mirroring the show-name row in 节目 settings). Empty input keeps the old name (the service's existing `name.trim() || p.name`).
- The name placeholder now reads 例：… / e.g. … so it no longer masquerades as filled content.

## Alternatives considered

- **Auto-naming from the show** (读书会 #N when the name is empty): invents episode numbering the user never asked for and still hides the empty-name mistake; a required field is more honest for a name that doubles as the export filename.
- **Editable header title** (click the PanelHeader title to rename): the kit's `PanelHeader` renders a plain `<strong>`; adding an editing mode there is a kit-wide change for one panel. The settings row reuses the existing DraftInput pattern and sits next to the show-name row users already know.
- **Leaving creation permissive and relying on rename alone**: rename fixes the aftermath, not the surprise; requiring the name prevents the whole class.

## Consequences

- Empty-named projects can no longer be created from the panel (the service's 未命名工程 fallback remains for the tool face).
- Every project can now be renamed from 设置 → 这期; the rename is logged as a PanelEvent the model sees on its next read.
- `deleteProject` is likewise host-only (Remote verb exists, no pane contract/UI) — left as is; it was not part of this incident.

## Testing

`pnpm --filter @khorsheed/dsh-video-studio build && pnpm --filter @khorsheed/dsh-video-studio test` green (build regenerates the typert Remote types the client face consumes).
