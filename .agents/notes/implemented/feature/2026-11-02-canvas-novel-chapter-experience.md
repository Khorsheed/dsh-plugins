# Agent Note: Chapter guidance follows manuscript order and overview uses summary panels

Status: implemented

## Problem

The chapter face could show a later chapter's plan while an earlier chapter still had no prose, and it always advertised the next chapter as a task. A plan action needed an unambiguous chapter-and-plan destination. Action buttons used separate custom styles, the only new-chapter row was easy to miss, and the codex overview presented outline, people, relations, foreshadows and world settings as a long sequence of similar rows with weak boundaries.

## Decision

- 接下来 is ordered as alignment changes, chapters awaiting reconciliation, items awaiting the person, then the earliest unfinished chapter. The latest-chapter candidate appears only after every existing chapter is reconciled. The next chapter's planning and pin requests use the chapter computed from the manuscript list, not the timeline's cached chapter number.
- Opening a chapter carries the chapter number and whether the person asked for its plan or its editor. The current chapter's plan action therefore opens exactly that chapter with its plan expanded; it never substitutes the latest chapter.
- Volume progress counts reconciled chapters rather than counting plan-only registrations as written chapters.
- All step actions use the host Button at one size. Only the first actionable step is primary; the others use outline, with ghost for cancellation. The bottom clearly names 新建第 N 章 and offers both 自己写 and 让 Agent 规划. The own-manuscript path still asks for a title before writing; the Agent path sends the existing planning request without registering an empty chapter, and remains available even while the candidate is hidden from 接下来.
- 总览 keeps the one-page outline as the main full-width document. People, world settings, relations and foreshadows have separate summary panels with headings, counts, borders, padding and a route to their full view. Relations and foreshadows no longer live inside the people's footer. Wide panels use two columns; narrower panels use one. Writing principles remain a separate following region.

## Alternatives considered

- **Keep using `currentChapter()` for next actions.** Rejected: that helper chooses a pending item or the last chapter for continuation, not the earliest unfinished task. Using it for 接下来 skips manuscript order.
- **Always show the next chapter candidate.** Rejected: planning a later chapter is an optional action, not a prerequisite. It remains in the new-chapter row rather than competing with unfinished prose.
- **Only adjust button colors.** Rejected: size, radius, typography and emphasis need one host component and one rule, not another local palette.
- **Hide creation until all chapters are reconciled.** Rejected: users may intentionally plan or write ahead. The bottom action stays visible even when it is not promoted into 接下来.
- **Put every record in its own card, or make the overview a second complete list for every datatype.** Rejected: the useful pattern is a main document with linked summary panels, similar to Notion database summaries and Linear project overviews. The overview summarizes and routes; it does not reproduce every full list.

## Consequences

- Earlier unfinished chapters regain priority over later plans without making later plans inaccessible. Users can still write or plan ahead explicitly from the bottom row.
- The overview has clearer category boundaries and less mixed content, at the cost of some vertical space on narrow panels. Its summary panels show a few entries rather than all details.
- No chapter, outline, card, reconciliation or import data format changes. The changes are in client presentation and destination intent.

## Validation

- A fixture with chapter 2 awaiting reconciliation and chapters 5 and 6 holding only plans now shows chapter 5, hides chapter 7 from 接下来, reports the reconciled count, and opens chapter 5's plan. A fully reconciled fixture plans the actual next chapter number.
- Tests cover primary/outline variants, both creation paths, and independent relation and foreshadow summary panels with their destinations.
- The complete novel test suite passes 29 files and 246 tests after these changes.
