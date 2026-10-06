# Agent Note: card page and story-log detail tidy — empty fields as chips, source in the meta line, a character's 在故事里

Status: implemented

Follows [the story log](2026-10-06-canvas-novel-story-log.md). The user flagged two screens on the 3195 trial work: a character's card page (戴娜) and the story log's narrow character detail. A side-by-side prototype was approved before implementation.

## Problem

On the card page:

- Nine unfilled fields rendered as nine rows of 「—」.
- The name appeared twice: as the page title and again as the first field.
- The 「先写正文…」 empty-body notice showed on typed cards that never need a body.
- The source chapter sat in its own attachment box below the body.
- The novel section's 此刻 showed three 「未定」 rows. Its values had no font set, so they rendered at the page's 16px, larger than the field table's 13px.

On the story log's narrow detail:

- The crumb was 「故事日志 / 人物 / c2」. The kicker repeated 「人物 · c2」, and `c2` is an internal ref that means nothing to the writer.
- Every appearance step led with the same word 「出场」.
- The 计划 note took its own line, and the hollow mark was centred against the whole block rather than the first line.

## Decision

**Canvas shell (`@khorsheed/dsh-canvas`, applies to every typed card of every genre)**

- **`FieldList`**
  - Lists only filled fields.
  - Unfilled fields collapse into one 「还没写」 line of dashed chips. Clicking a chip opens the field form focused on that field (`FieldForm` `focus`).
  - With `titled` (the detail page passes it whenever crumbs name the card), a filled title field is omitted.
- **Detail read face**
  - A typed card with an empty body and no drawings renders no body area and no notice.
  - The source moves into the meta line as 「出自 {name} ↗」 (link, file opener, or plain text). The attachment box and its CSS and locale keys (`detail.attachment`, `detail.openFile`) are gone.
- **Genre page block** (`CanvasTab`): drops its duplicate heading, since the crumb already names the page.

**Novel (`@khorsheed/dsh-canvas-novel`)**

- **The `card` Remote** returns a character's `appearances`. It reuses `storyLog`'s read rather than forking the cast/pov/journal/source-chapter logic, so 出场 agrees with the story log by construction.
- **Card section: a character gets one 「在故事里」 block**
  - **此刻**: one line when nothing is worked out yet. When something is, only the parts that are set are listed.
  - **出场**: a strip of chapter numbers with the story log's filled/hollow dots. A planned chapter carries 「计划 · role」.
  - **关系**: the relation lines, or one line saying there are none yet.
  - **「在故事日志中看 ›」**: opens the log on this card (`openPage(STORY_LOG_PAGE, …, card.id)`).
  - Section values use the field table's 13px. `card.state.unset` and `card.relationsHelp` are removed.
- **Story log**
  - **Deep link**: `param` = card id opens that row's tab with the row picked, and with the detail face up front when the page is narrow.
  - **Narrow detail**: the crumb is a single 「‹ {tab}」. The kicker is hidden there and shows a ref only on 伏笔, where `#12` is a real handle.
  - **Character steps** are wordless: they lead with the chapter's experience or the plan's line, or quietly say 「在场，这一章没整理出经历」.
  - **计划** becomes an inline tag before the first line on every tab. Marks align to the first line (20px rows). `.logPlanned` is removed.
  - **Width**: the narrow detail is capped at 640px.
  - **Links**: a character detail gains 「读第 N 章」 for their first written chapter.

## Alternatives considered

- **Hide empty fields entirely.** Rejected: the empties are the prompt for what to write next, and a chip that jumps into the form is shorter than 编辑字段 plus a hunt.
- **Compute appearances separately in `card()`.** Rejected: a second copy of the logic would drift from the story log's.

## Consequences

- **Overlap with the canvas owner's P3 (responsive layout).** The shell changes here are content-only (what the field list, the body and the meta line show); they leave layout, breakpoints and the detail frame alone. Whoever lands second rebases onto the other; the conflict surface is `CanvasDetailView.tsx` and `fields.tsx`.
- **The `card` Remote is heavier for characters.** It now does a full story-log read. Card pages open one at a time, so this is acceptable. Revisit if a list view starts calling it per row.
- **Tests**:
  - canvas `fields.client.spec` gained three tests (chips and `onFill`, nothing filled, form focus); `detail.client.spec` follows the source move.
  - canvas-novel `client.spec` gained three (the 在故事里 block, partial 此刻, the deep link with 读第 N 章).
- **Verification**: 3195, light and dark, at 1440px and 760px: 戴娜's card page, the chip-to-form focus, the 此刻 edit form, a foreshadow card, and the story log's wide and narrow detail.
