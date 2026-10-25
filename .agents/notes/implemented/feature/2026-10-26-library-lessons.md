# Agent Note: Library — one station is one lesson; an authored textbook's 讲义 teach every point

Status: implemented

## Problem

On 3080 (2026-10-25, the 「添加Blender 3D游戏制作项目」 run) the coach authored a textbook and drafted its whole path as ONE station spanning chapters 1–5. That station's 讲义 came out as a glossary — a list of terms, a "第 1 次更新 · 方向修正说明" header, and the internal word "acceptance". The user wants Duolingo-like pacing: small stations ordered simple to hard, 讲义 detailed enough to learn every point from, and 章节考 when the learner feels ready.

## Decision

Decided with the user:

- **Station size is counted in knowledge points, not chapters.** On a textbook the model wrote, "how many chapters" means nothing, because it drew the chapters itself. A quiz station carries 3–5 points (`STATION_MIN_POINTS` / `STATION_MAX_POINTS` in `service/rules.ts`). More than 5 is refused with "split it", fewer than 3 with "merge it". A real book's long chapter splits into several stations on the same rows.
- **An authored textbook teaches one chapter per station.** Its chapters are lessons the coach wrote, so a station covering more than one row of its own authored textbook is refused.
- **An authored textbook's 讲义 are the lesson.** `lessonProblems` refuses a 讲义 missing a `##` section headed by each point's title, or a section under `LESSON_SECTION_MIN` (120) characters, and names the missing or thin points. Each section runs: what it is → why it matters → an example or the steps → a common mistake → one self-check question. A real book's 讲义 are a reading guide and marginalia, so that check does not apply to them.
- **No change logs or internal words in any 讲义.** 第 N 次更新, 修正说明, 更新说明 and acceptance are refused; the sidebar already counts revisions.
- **Pacing in the conversation.** The prompt now says: teach one point at a time, ask one check question, and move on once it lands. On an authored textbook, write the 讲义 when the station opens and teach along them.
- **Not this round:** per-section 「再讲讲这节」 buttons in the sidebar. The user will shape them after trying it.

## Alternatives considered

- **Refusing stations that span more than two chapters.** It only constrains a real book; on an authored one the model can make a chapter as big as it likes.

## Consequences

- Existing paths are not re-validated. The user deletes the Blender project and starts a new one to try the rules.
- `addPoints` (a station's split extended at quiz time) is not capped, so a station can grow past 5 that way.

## Testing

183/183 green. New tests in service.spec: 6 points refused, 1 point refused, a two-row station on an authored textbook refused; a glossary-shaped 讲义 names its missing points, a one-line section is "too thin", a change-log header is refused, and a full lesson with numbered headings and `###` subsections lands. Older tests padded to 3 points.
