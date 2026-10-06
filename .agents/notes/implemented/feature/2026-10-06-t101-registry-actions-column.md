# Agent Note: datasets — one row per one-set repository, and an 「操作」 column

Status: implemented

## Problem

The 题集 tab grouped every registration under its own heading row, even when the repository held a single set. A one-set repository therefore took two rows: a heading with the repository name, then a row with the same name again as the set id (often a third time as the set's display name, differing only in case). The actions were also awkward to find. 「交给 Agent 修改」, 「编辑登记」 and 「删除」 sat on the heading row with no column header, so a one-set repository's actions lived one row above its data. On a narrow pane the table pushed past its column, since the version date wrapped mid-token and nothing could give way.

## Decision

### One row for a one-set repository

`RegistryList` (`packages/datasets/src/client/RegistryList.tsx`) renders a registration as a single row (`SingleSetRow`) when three things hold: it has a latest version, it has no problem, and it holds exactly one set. The name cell shows the repository name as the open button, with the set's ref as its tooltip. The set id appears under it in secondary type only when it differs from the repository name.

A registration with several sets, no sets, or a problem keeps the heading row plus one row per set. The heading cell spans the data columns except 「最新版本」, which gets an empty cell of its own (see the narrow layout below).

### Quiet names are never repeats

`quietNames(named, set)` decides which secondary names show under a name. The set id shows when it differs from the name already shown. The display name shows only when it is not a case-insensitive match (`sameName`) for either the id or the shown name. So `ALPHA` under `alpha` is dropped, while `Beta tasks` under `beta` stays. Set rows in multi-set repositories use the same rule.

### The 「操作」 column

A rightmost column headed 「操作」 (`registry.colActions`) holds a registration's actions:

- On a one-set row, the actions sit on that row.
- On a multi-set repository, they sit on the heading row, and set rows leave the cell empty.

The cell holds 「交给 Agent 修改」 as an outline text button, plus a ⋯ trigger (`src/client/more-menu.tsx`, a copy of the canvas `more-menu.tsx` shape over the host `Menu`). The trigger's accessible name is 「<id> 的更多操作」. The menu has two rows:

- 「编辑登记」, which goes to the existing `onEdit`;
- 「删除」, a `danger` row that goes to the existing `onRemove`, so the T99 delete dialog is unchanged.

「用在哪些实验」 stays a data column. The T99 hover pencil on the layers cell, the banners and the delete confirmation are untouched. The broken-registration hint (`registry.problemFix`) now points at 「操作」's ⋯, because the inline 「编辑登记」 / 「删除」 buttons it named no longer exist.

### Narrow widths

- **≤ 720px (container width):** 「最新版本」 is hidden. This is why the heading row gives that column its own empty cell rather than folding it into the heading's `colSpan`. A hidden cell inside a span would leave the heading row one column wider than the set rows, and that pushed the actions off the table's edge in a first attempt.
- **≤ 560px:** the existing fold turns rows into wrapped blocks. The actions take a line of their own, and an empty set-row actions cell disappears. On the heading row, the actions stay on the heading's line under one shared rule. The cell is `flex: none` there, because the wide table's `width: 1%` would otherwise become its flex basis and squeeze the buttons out.
- **All widths:** the version date no longer wraps mid-token.

### Icon artwork

The ⋯ glyph, `IconEllipsisOutlineMedium`, is inlined into `src/client/icons.tsx` like the package's other icons. The full `scripts/sync-icon-artwork.mts` run currently fails against the pinned 0.1.7-rc.1 harness, because canvas needs `IconCheckDoubleOutlineMedium`, which that harness lacks. To avoid changing the generated header, only the datasets module was rendered, against the same harness.

## Alternatives considered

**Three visible buttons (交给 Agent 修改 / 编辑登记 / 删除).** These were compared on a live instance at 1440, 700 and 420 px:

- At 1440 all three fit, but the column becomes about twice as wide and takes width from 「用在哪些实验」.
- At 700 the actions cell takes about 40 % of the table.
- At 420 the repository heading wraps (`harness-` / `bench`).
- 删除 sits permanently one click away on every row, next to an edit button of the same weight.

The ⋯ menu keeps the one action people reach for (handing the repository to the agent) visible. Both rarer actions sit one extra click away, with 删除 shown in the danger colour. The cost is discoverability: 编辑登记 is no longer visible at a glance. The broken-registration hint now names the ⋯ to compensate.

**Everything behind ⋯.** Rejected because 「交给 Agent 修改」 is the tab's primary path for changing a set (T90), and the brief keeps it as a text button.

**Keeping the heading row for one-set repositories and only adding the column.** Rejected because the heading/data split is exactly what made a one-set repository read as two things.

**Hiding the actions column at narrow widths.** Rejected: the brief requires the actions to stay reachable. 「最新版本」 is the column that gives way, since the version is still one click away on the detail page.

## Consequences

- A one-set repository is one row. The registry reads as one line per thing the user registered, and the name is never shown twice.
- Every registration's actions live in one labelled column, so 删除 is never a stray button on a heading. Finding 编辑登记 now takes a click on ⋯.
- Below 720px the table loses 「最新版本」. Below 560px it folds as before, with the actions on their own line, and nothing overflows horizontally at 700 or 420.
- `more-menu.tsx` is a hand-kept copy of the canvas one: plugins do not import siblings.
- The icon generator's canvas/0.1.7 drift is still outstanding. Fixing it belongs to the canvas owner or to the next harness-baseline move, not to this change.

## Testing

`packages/datasets/tests/DatasetsView.client.spec.tsx`, describe 「one row per one-set repository, every action in 「操作」 (T101)」:

- single-set merge;
- a recased display name not repeated;
- multi-set grouping: header count, the heading's span plus its own 「最新版本」 cell, and empty set-row action cells;
- ⋯ rows mapping one-to-one onto `onEdit`, `onRemove` and `onAskAgent`;
- a broken registration keeping its ⋯.

Existing tests now reach edit and delete through the ⋯ menu. The live screenshots (1440 / 700 / 420, light / dark, menu open, and the three-button comparison) were reviewed by eye and handed to the coordinator with the T101 report. They are not committed.
