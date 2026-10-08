# Agent Note: canvas-novel three faces (章节 · 设定 · 故事) and the panel kit on canvas

Status: implemented

## Problem

The 长篇小说 canvas stacked a pending strip above the canvas's own 成稿 · 卡板 · 连线 faces, so a writer read the same chapter state in two places, and the board had no idea which cards a chapter actually used: deleting a card some chapter relies on looked the same as deleting a stray idea. On a phone the canvas showed the canvas name twice and four rows before the body, a desktop segmented control, mixed chip styles, `#` refs in titles and a black 「收下」 button (the five mobile complaints in the panel-spec P3 brief).

While taking the 390px screenshots, a deeper defect surfaced: the client build's CSS Modules hashed `@container` names per file. The panel kit's `PanelRoot` declares `dsh-panel` in its own module, so every other module's `@container dsh-panel (max-width: 560px)` compiled to a different hashed name and never matched — the panel spec's whole compact contract was dead, the kit's own components included.

## Decision

- **Three faces, genre-labelled.** A canvas without a genre is labelled 日常创作 (was 不用体裁). A genre with `faces` relabels the canvas tabs (`canvas.board.tab`, keyed `novel:<face>`) as 章节 · 设定 · 故事 and adds its own `view` face (`canvas.board.view` key `novel:story` → the story log with 伏笔 / 人物 / 关系 / 世界 underline tabs). The strip is gone. 章节's badge (`canvas.board.tab.badge`) counts 待对账 chapters plus pending items. The default face is 章节 when chapters exist, else 设定.
- **章节.** A 「继续写」 row (the earliest chapter with pending items, else the last) with an accent-outline button, the queue folded under a warn pill, the TOC with 已对账 / 待对账 / 计划 tags and 全部 / 待处理 / 未审过 chips.
- **设定.** The genre reports scopes through `canvas.board.scopes`: 已进入故事 (a card some reconciled chapter uses, `archiveFirst`) and 灵感 (a story-role card none uses). The scopes (with 全部) and the 网格 / 连线 layout are small segmented controls in the face's own tools row under the face tabs — a level below the faces, apart from the category chips. The 连线 layout is the canvas's own (free lanes and links). The genre's relation ring that used to replace it (`canvas.board.graph`: characters on a ring, relation cards as lines) was retired on 2026-10-08. It drew from the story log, which lists only characters some chapter has reached, so a work still in planning showed 「还没有人物卡」 beside four character cards, and the user wanted the free layout back. Relations stay readable on 故事 → 关系.
- **Chapter reader.** The head speaks the host's sans and the panel type tokens, left-set: a 「第 N 章 · 原稿 · count」 line, the title, then the progress block — four segments 规划 · 写作 · 对账 · 审过 and one line naming the state and its single next step (e.g. say 「对账第 N 章」 in the chat). It is the reader's only statement of the state: 「✓ 审过本章」 under the text appears only when it can be pressed (reconciled, no pending items here, writable) — the old greyed button read as if the chapter were at 审过. The text is the host's sans one step above the panel reading size at 1.95 leading. An own draft without a plan no longer shows an empty plan box. The phase a reconciled chapter is in reads 已对账 everywhere (the reader, the TOC tag and its legend said 已抽取 and 已对账 for the same state), and the TOC and 继续写 titles drop the serif too.
- **Rows reconciled before fingerprints.** Such a row has no `bodyHash` and used to read 待对账 unconditionally — a work reconciled before the fingerprint landed showed every chapter 待对账 although the model had reconciled them. It now keeps its phase while the body's whitespace-free count still equals the `wordCount` that 对账 recorded (the fingerprint's length half); a moved count, or none recorded, still reads 待对账.
- **Delete question.** `canvas.card.deleteNote` lists the chapters that use the card, or says an idea card affects no chapter; an `archiveFirst` card gets 归档 beside 删除. Both the board's dialog and the card page's dialog carry them (the card page reads `crumbs.archiveFirst`).
- **Panel kit (P3).** canvas and canvas-novel adopt `PanelRoot` / `UnderlineTabs` / `ChipRow`; compact rules sit under `@container dsh-panel (max-width: 560px)` — one header row (faces + ⋯), 44px touch rows, accent-outline 收下. The ⋯ (and the read-only hint) ride `UnderlineTabs`' `trailing` seat and the counts its `badge` (spec rule 8): set beside the tablist the ⋯ drew a second divider and sat low. A genre supplies its face's badge through a new keyed seat `canvas.board.tab.badge` (keyed like `canvas.board.tab`; the novel's 章节 count), so the count sits outside the label's underline. Panel text reads `--dsh-panel-text-*` with the host family, never the desktop `--dsw-font-*` shorthands. canvas-novel's book keeps its own `novel-book` inline-size container for layout below the panel width.
- **Global container names.** `build/tsdown.client.ts` passes `cssModules.container: false` to lightningcss, so container names are global like the panel spec assumes. Class names stay hashed.

## Alternatives considered

- **Keep the strip, add the faces beside it.** Rejected: the same chapter state in two places is what the prototype set out to remove.
- **`:global()` per stylesheet or unnamed containers.** lightningcss has no `:global` for container names, and unnamed `@container` queries the nearest container of any name — a plugin's own inner container would capture rules meant for the panel. One build flag fixes every package at once.
- **继续写 drafting into the chat composer.** canvas has no compose seam; 继续写 opens the chapter reader for now.

## Consequences

- Every package's `@container dsh-panel` rule now applies — compact layouts that were silently dead on main (ui-panel-kit components, dsh-reader, local-files, ui-content-preview) start applying on the next build. Reviewers of those packages should re-check their 390px screenshots.
- Package-local container names (`canvas-tab`, `novel-book`, `trajectory-table`, `plugin-inventory`, …) are now global too; queries resolve to the nearest ancestor of that name, so a collision needs two packages to pick the same name and nest.
- Order matters in canvas's `CanvasTab.module.css`: the compact block sits last, because the base rules set `display` on the same selectors.
- Known gaps: the 灵感 scope covers story-role categories only (principles excluded, so 全部 ≠ 已进入故事 + 灵感).
