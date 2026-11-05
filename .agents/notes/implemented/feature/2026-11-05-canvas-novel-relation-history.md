# Agent Note: Relationships replay by chapter around a person, with the graph as an auxiliary view

Status: implemented

## Problem

The relationship face was a fixed ring whose every edge label was always visible. It became unreadable as cards accumulated, offered no drag, zoom or person filter, and let the outer page scroll take the graph away. Its chapter slider merely hid later cards; it did not reconstruct the pair's type, stage or rift at that chapter, so “history” showed the current card rather than the past.

## Decision

- `relationAt` replays the full journal through the selected chapter. Type starts from the first type change's `fromType`, stage events replace stage and level, and points since the last stage event form progress within that stage. The latest step supplies a plain trend: started, warmer, colder, repairing or type changed. Scores are never compared across relationship types.
- The chapter slider drives graph, list and the selected pair's detail together. The detail lists every journal step through that chapter with its evidence and a stage-local progress bar.
- Picking a person creates a one-degree ego view: adjacent edges stay prominent and the list shows only that person's relationships. The person can be cleared. Picking an edge or row opens the pair's full history.
- Nodes drag, the graph pans and zooms, and reset restores the ring. Positions are stored per work in browser localStorage, not in story data. Labels appear on hover or selection.
- More than 12 people defaults to the list. The graph remains available as an auxiliary view. On wide layouts the graph stays visible while the list scrolls independently; narrow layouts use one column.
- Card headers use the same action menu here as elsewhere in the novel.

## Alternatives considered

- **Keep filtering by the card's `since` field.** Rejected: it cannot answer what type or stage the pair had at an earlier chapter. The journal, not the current card, is the historical source.
- **Encode intimacy by edge thickness or a global score.** Rejected: ladders and points have different meanings per type and reset after stage events. Only stage-local progress is shown, and only in detail.
- **Persist graph positions in the canvas.** Rejected: layout is a viewing preference, not canon. Browser-local persistence avoids cross-user writes and session permission requirements.
- **Optimize only the large graph.** Rejected: a crowded graph is not an acceptable default. The list is the primary readable view past 12 people.

## Consequences

- Historical reads no longer leak later type changes or stage changes into the selected chapter.
- Direct relationships remain usable without a graph, while small graphs gain spatial organization without a server-side data format change.
- Tests replay type, stage, rift and progress, filter around a person, drive the slider and detail, and verify crowded books open on the list. The full novel suite passes 40 files and 291 tests.
