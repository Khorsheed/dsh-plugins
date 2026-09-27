# Agent Note: the eval lab opens its reference material in the host's right sidebar (T86)

Status: implemented

## Problem

Walking through T84, the user found the lab tab crowded. Every page folded its secondary material inline: plan.json, the author note, the passing checks, the receipts, a record's attachments, the validity audit, the export provenance, and each answer file. The main line of a page was hard to follow between the folds. The user asked for two things. The main information stays in the lab tab. Secondary material moves to a sidebar, preferably the host's own right sidebar, because that costs less to maintain. The design is `profiles/web-eval/docs/t85-lab-sidebar.md`, and the coordinator settled its §六 questions in the T86 brief.

## Decision

- **One pane, two containers.** `InspectPane` (`packages/eval/src/client/InspectPane.tsx`) draws a typed `InspectTarget` stack (`inspect-target.ts`) and owns the header: back, title, source line and close. The page table is extensible, so lab pages register their own pages with `registerInspectPage` instead of the pane importing them. The same pane is drawn either in the host's right sidebar or in the page's own Sheet.
- **Host sidebar by default.** The `eval-inspect` page tab type (id `@khorsheed/dsh-eval:inspect`) registers inside a deferred `ctx.inject(['sidebarRight','sidebarRightTabs'])`, gated by the lab tab's preset criterion. Its body is the `sidebar.right.pane.tab` seat and its chip title follows the top page. `openInspect` answers false when the sidebar is absent or when `openTab` throws, and the lab then opens its Sheet.
- **Our own memory for 0.1.7 reloads.** 0.1.7 persists the sidebar layout per session but not a tab's params. The body therefore saves `{tabId, revision, applied, stack, recent}` under `dsh-eval.inspect.<sessionId>` and redraws the stack when a restored tab arrives without params. `applied` is the key of the last target it applied, because after a reload the host restarts revision numbers, so a revision can repeat.
- **Page entries.** Each lab page now shows a one-line conclusion followed by 「查看」 instead of a fold:
  - design: plan.json, the author note, the checks, the receipts;
  - runs: a record's receipts and attachments;
  - report: the validity audit and the export provenance;
  - answers: each folded answer file.
  The grading page gains a 「题目材料」 entry at the right end of the queue head.
- **What stays in the tab.** The side-by-side answer view stays in the tab, as does the record timeline and 「怎么读这张表」. The run log, the efficiency detail and the finalize raw output stay folded until the user's walkthrough.

## Alternatives considered

- **Page Sheet only.** It works on every host, but the user asked for the host sidebar, and a Sheet cannot be resized, docked or kept per session. It stays as the fallback.
- **Hard-depend on `@deepseek-ai/dsh-client-ui-sidebar-right`.** A profile without it would then fail to load the lab. We read the host's tab info through a structural `TabInfoLike` and inject the services optionally instead.
- **Ask upstream to persist params now.** The user deferred this until the eval line actually runs on 0.1.7. The local memory covers the gap, and the proposal is recorded as a follow-up in the design doc's §七.
- **Collapse the left session sidebar while the right one is open.** Rejected in §六: it changes the host layout. The lab tab takes its narrow layout instead.

## Consequences

- **Commits.** Branch `feat/t86-lab-sidebar` has `0aeab97e`, `488cf894`, `756554b3` and `1f124a75`. The eval package passes 69 files and 1192 tests on the frozen baseline.
- **0.1.5 acceptance.** Temp instance on 3183, shot at 1440 and 400. All 14 scenes pass except the 400-wide 「返回」 scene: the host draws the sidebar full-screen over the tab at that width, so the stack only grows from drill-downs inside the sidebar. The browser console showed no errors.
- **0.1.7 acceptance is blocked on T82.** The frozen 0.1.7-rc.1 CLI boots, but every session carries the pack's `eval` preset. 0.1.7 rejects it with `Unknown agent preset: eval`, so the experiment list fails to load. We stopped there as the brief requires. The 0.1.7 screenshots and the reload-restore check are owed after T82.
- **The no-sidebar profile cannot boot on either host line.** On 0.1.5, disabling `ui-sidebar-right` leaves the official `dsh-client-ui-chat` and three community packages (file-preview, taskpilot, local-files) waiting for `sidebarRight`. eval is not among the waiters. The 0.1.7 ui-chat depends on `sidebarRight` in the same way. The Sheet fallback is therefore verified only by unit tests (`tests/apply.client.spec.ts`).
- **Visibility doc.** `docs/plugin-visibility.md` now records the 0.1.7 registry fields (`multiple`, `keepMounted`) and the per-session layout persistence that leaves params behind.
