# Agent Note: Library — 讲义 as their own page, written when the learner starts a station

Status: implemented

## Problem

讲义 sat in a 讲义 tab on the station page: a 380px column of continuous markdown with no contents, no sense of which point you were on, and no way on to the quiz. Nothing in the sidebar started a station, so the coach decided by itself when to write 讲义 and when to teach (10-26: before the learner had adopted the path). The 讲义 text was also stored inline in the roadmap JSON, so every path read carried every lesson.

## Decision

Decided with the user over `proposals/prototypes/library-lesson-page.html` (option B: a page inside the library, not a separate sidebar tab):

- **The station page loses its 讲义 tab** (导读 / 我的记录 / 章节考 remain). A lesson card at the top of 导读 has three states. With no 讲义: 「开始学这一站」, which primes the conversation with the station and its points and leaves room for the learner's own line; it never sends. While waiting: 「教练正在备课…」, re-reading every 4s, with an offer to ask again after 10 minutes. With 讲义: the points with their mastery dots and 「打开讲义」, which opens the page directly without involving the coach.
- **The 讲义 page** is a pushed library route (`lesson`). It splits the markdown at `##` headings, one section per point. The contents are a chip row on narrow panes and a left column at ≥720px container width; each entry carries its point's mastery dot. It ends with 「觉得掌握了？」 → 去章节考 / 问教练. 问教练 primes 「我看了「…」的讲义，想问：」. The old whole-rewrite button (请教练补讲) is gone.
- **The page opens itself** once 讲义 newer than the 开始 click land (the waiting key lives in the pane store).
- **The coach waits**: the prompt and the `library_notes` result say to announce the 讲义 in one line and let the learner read and ask (batch 1). A question that exposes a gap in the 讲义 gets that section fixed.
- **Storage**: the text lives in `notes/<resource>/<node>.md`; the roadmap node keeps `{ updatedAt, revisions }`, and readRoadmap fills the text back in, so every reader is unchanged. A rewrite keeps the replaced version as `<node>.<n>.md`. A legacy node with inline text still reads and moves to the file on the next write. Removing a textbook removes its notes directory.

## Alternatives considered

- **A separate sidebar tab for the lesson** (the first mock): rejected by the user. 讲义 would live in two places and tabs would pile up; host full screen already applies to the whole library tab.
- **Teaching right after writing the 讲义**: rejected by the user. The learner reads first, then asks.

## Consequences

- Old routes with `tab: 'notes'` fall back to 导读.
- Old revisions are kept on disk only; there is no "previous version" view yet.
- The coach still needs the learner to send the primed line. The card says so, and after 10 minutes the button comes back.

## Testing

190/190 green. New service tests: 讲义 in their file, the path without the text, a rewrite archiving revision 1, textbook removal cleaning the directory; a legacy inline note reads and migrates on the next write, keeping its revision. Screens checked in the sidebar fixture (dark): the guide card with and without 讲义, and the lesson page at 420px (chip contents) and 900px (left contents).

## Follow-up (2026-10-26, same day): every 讲义 is the lesson, every station is a quiz

The first live run after these batches showed three problems:
- **讲义 as a reading list.** On a picked textbook (the Blender manual) the coach wrote 「读书指引」 — read these manual pages, watch for this — and the learner had to keep switching between the sidebar and the manual. The user wants lessons like their own `lessons/` series: the core question, 「你将学到」, warm-up questions, one full section per point with an example and a 思考题, then 小结. `lessonProblems` now applies to every textbook, and outside material (manual pages, videos, the learner's own book pages) goes only in a final `## 参考`. The `library_notes` description and both 开始学这一站 drafts say so.
- **Acceptance-only stations.** Batch 1 inferred a hands-on station from acceptance lines, so the coach's 「学完能做到」 lines turned two stations into rubric sheets with no points; the learner could not tell what to submit. Now, unless the gate is explicitly given, a station is a quiz station and its acceptance lines join its goals. `library_roadmap` refuses a quiz station without points, naming it. The service stays lenient for old data and direct calls.
- **「推荐下一站」** sat alone in an empty box. The next station now carries a small 下一站 tag by its title (the tooltip explains it is the first station not yet passed, and any station can come first), with its buttons directly below.
