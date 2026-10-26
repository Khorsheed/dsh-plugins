# Agent Note: Library — the path as a lesson rail; no station is locked

Status: implemented

## Problem

The path drew stations on a three-column zigzag: 84px rows with 110px labels at 12px. Long Chinese titles wrapped into three or four lines and crowded each other, and a station showed only done / current / locked, not whether its 讲义 existed or how its points stood. Stations also locked until the one before was passed. The user wants to go wherever they like, Duolingo-style, with the path showing progress rather than gating it.

## Decision

Decided with the user over `proposals/prototypes/library-slimming.html` §5 (option A) and decision D6:

- **A vertical rail** (`client/views/path.tsx`): one row per station, full title, grouped under the contents' parts. A progress line on top: stations passed and points mastered.
- **Four statuses** (`stationStatus`): passed (green check, best score) / 学习中 (amber ring: quizzed, or a point no longer untested; it counts open misses) / 已备课 (blue ring: 讲义 written) / 未开始 (grey: shows the point count and rows). Each started station shows its points as mastery dots.
- **The next station is recommended, not enforced**: the first level not yet passed gets a halo and a card. 开始学这一站 opens its guide; 接着学这一站 opens the 讲义; 去订正 N 题 appears when misses are open.
- **D6, no locks**: adoption sets every station not yet passed to `current`, and a stored `locked` reads as `current`. Any station can be studied and quizzed, and passing completes it. `unlocked` lists are now empty, and the grading result's next step names the next station by itself.

## Alternatives considered

- **Keeping the zigzag (option B) with bigger discs**: rejected. Titles would fit only for a few stations, and point mastery would not fit at all.
- **Keeping locks but allowing a skip**: rejected by the user. The path should report progress, not gate it.

## Consequences

- `unlockReady` and the lock warning on quizzes now never fire. They are kept for old data paths and can be removed later.
- The old zigzag CSS (`.path*`, `.disc`) is unused.

## Testing

190/190 green. Lock-related assertions were rewritten to D6: adoption leaves every station current, nothing unlocks, and a quiz on a later station carries no lock warning. The rail was checked in the sidebar fixture at 420px in dark and light: parts, passed / studying / todo rows, a side stop, and the next-station card with 去订正.

## Follow-up (2026-10-26): textbook and project pages say each thing once

The user found both pages repetitive (知识型 three times, progress twice, chapters in the station title and under it, a long title in the header and the body) and read the empty progress bar as a divider. Decided over `proposals/prototypes/library-book-page.html`:
- **Titles for display** (`client/titles.ts`): a textbook's trailing parenthesis becomes its subtitle, and a station loses its 「站 N：」 prefix and its trailing chapter note. Stored titles are unchanged.
- **Textbook page**: a hero with a cover, the main title, the subtitle and one line of tags; 知识型 / 材料型 moves into the ⋯ menu, with only a 材料型 tag shown. The rail's head shows the passed and mastered counts above a bar segmented per station (`Segments`, one continuous bar over 40). The next station is a tinted row with its buttons. The contents fold into one line at the bottom (skipped chapters dimmed, source link inside).
- **Project page**: the goal is clamped to two lines with a toggle; the ring shows the percentage with 「过关」 under it (the station counts go in its tooltip, so long paths never overflow the ring); stats are three tiles, 错题 renamed 待订正; each textbook is a card with a cover, main title, origin tag and segmented progress (dashed when it has no path yet); an empty resource section is one line.
