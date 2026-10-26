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
