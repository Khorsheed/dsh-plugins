# Agent Note: one writing preset — bundle-writing folded into 写作模式, novel tools gated by the canvas binding

Status: implemented

Follows [the card-page tidy](2026-10-06-canvas-card-page-tidy.md).

## Problem

Trying the novel genre on prod 3080, the user saw new cards land as proposals ("ghost cards"). Their session ran `@khorsheed/dsh-presets`' 写作模式 (`preset-dsh-writing`), which mounts only `canvas/agent`: the model wrote cards with `canvas_write`, which proposes. The novel tools that land cards live (`novel_write`) were only in `@khorsheed/dsh-bundle-writing`'s 写作 preset. Deploying that bundle left two writing presets side by side, and the user asked for one, with the novel tools decided by whether the canvas is a 长篇小说.

## Decision

- **One preset.** `preset-dsh-writing` mounts `@khorsheed/dsh-canvas-novel/agent` next to `canvas-agent`. The description and persona say a session bound to a 长篇小说 canvas also gets `novel_*`, writes cards through `novel_write`, and lands them kept.
- **The gate is the binding, not the preset.** canvas-novel's `./agent` already grants `novel_read/write/extract` only to a session bound to a novel canvas. An unbound 写作模式 session sees the canvas tools only, so folding costs non-novel writing nothing.
- **A genre can own card writes.** `CanvasGenreDefinition.agentCardTool` (novel: `novel_write`). On that genre's canvases `canvas_write op=card` refuses and names the tool, so a canvas-native proposal can no longer become a ghost the novel ledger never reads. The canvas skill and the novel pointer line say the same.
- **bundle-writing retired.** It was never published, so the package is deleted outright and registered in `scripts/retired-packages.ts`; `deploy:3080` warns while prod still carries it. canvas-novel's patch comments and READMEs name 写作模式 as the recommended grant; presets declares canvas-novel in `dsh.references` (the row names it as data).

## Alternatives considered

- **Keep both presets, renamed.** Rejected by the user: novel writing needs the canvas tools anyway, so a second preset is only a duplicate menu entry.
- **Make `canvas_write op=card` land live on novel canvases.** Rejected: the novel ledger (story log, relations, chapter extraction) is fed by `novel_write`; routing to it keeps one write path.

## Consequences

- The 53 proposal cards already on the user's prod canvas stay proposals; accepting them is a separate question (a bulk 全部收下 was offered).
- Prod must drop `@khorsheed/dsh-bundle-writing` from its profile, or the old 写作 preset keeps mounting canvas-novel/agent alongside.
- Tests: canvas `tools.spec` (refusal on a novel canvas), canvas-novel `agent.spec` / `patch.spec`, presets `presets.spec` (the new row).
