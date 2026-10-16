# Agent Note: Library — the practice station's acceptance tab is removed; 章节考 is the quiz

Status: implemented

## Problem

The practice station's 章节考 tab rendered an acceptance sheet — the rubric lines with per-line verdict marks, the machine-checked ref links, the history — plus a 「提交验收 → 带进会话」 button that primed the conversation input with a pre-filled acceptance form. The learner-facing review: the gate tab is where the exam questions live (章节考就是考题); a form that pastes a rubric into the chat box is a scaffolding of the coach's own judging flow, not a learner surface — the evidence and the judging both happen in the conversation anyway. The sheet duplicated that flow as UI.

## Decision

The acceptance sheet is gone from the client: no `acceptance` tab on a practice station (`LibraryNodeTab` drops the member), no AcceptanceTab component, no submit prime (`prime.accept`), and the sheet-only locale keys (`accept.title/station/passRule/hint/machine/submit/submitHint/history`) and CSS (`acceptList/acceptItem/acceptMark/acceptText`) are removed. A practice station's page keeps 导读 / 我的记录 / 讲义.

The data model is untouched: practice stations still carry acceptance lines (ids and machine-checked refs included — [the rubric note](../feature/2026-10-16-library-rubric-ref-lines.md) stays in force on the service side), the coach still judges them with `library_assess` in conversation, and the assess cascade still completes the station at the pass ratio. What changed is only that the rubric no longer has a learner-facing form: the coach quotes the lines when asking for evidence, and the draft card still advertises the line count (`accept.meta`) before adoption.

## Alternatives considered

- **Keep the sheet read-only (drop only the submit button)**: rejected — the sheet without its submit gesture is a scoreboard for a flow that runs in the conversation; that is the half-measure whose remnant UI this removal exists to avoid. If rubric visibility before acceptance turns out to matter, the lines belong in 导读 as plain text, not in a gate tab.
- **Auto-pass practice stations without the sheet**: rejected — acceptance is a judgment the coach makes on shown evidence; removing the UI never moved that judgment into the client.

## Consequences

- The 章节考 tab exists exactly where there are exam questions: quiz stations. One name, one content.
- Practice acceptance is conversation-only: the learner loses the per-line pass/fail scoreboard and the history list; both remain computable from `library_read · roadmap` / the attempts ledger if a future surface wants them.
- Cross-links: supersedes the gate-tab half of [the station-notes-and-gate note](../feature/2026-10-15-library-station-notes-and-gate.md)'s decision C; narrows the UI claim in [the rubric-ref-lines note](../feature/2026-10-16-library-rubric-ref-lines.md) (its service-side machine checking is unchanged).

## Testing

`pnpm --filter @khorsheed/dsh-library build && test` green (131/131 — no test referenced the removed surface); `pnpm check:panels --package packages/library` clean. No new tests: the removal deletes a view, and the acceptance flow it fronted is covered by the existing `service.spec.ts` practice-acceptance suite.
