# Agent Note: 题集 and 实验室 are host global panels, and their Remotes take no session

Status: implemented

## Problem

The dataset registry and the experiments are deployment-level objects, but the only way to see them was a `conversation.view` tab inside a session, and that tab hides in any session whose preset does not grant the family's tool row. To look at the registry, a person first had to open (or find) a session with the right preset. Host 0.2.0 has a mechanism for exactly this kind of content: the left sidebar's global entries (`sidebar.panellist`) select a central panel (`main`), which is how the plugin manager and the scheduled-task list work. Two things stood in the way. Both Remotes took the live agent (a session) as their first parameter on every method. And the T96 「核对并登记」 card reached the review by clicking the tab strip through a DOM anchor.

## Decision

### Two global panels, same views

- `@khorsheed/dsh-datasets` registers the entry `datasets` (order 30, label 题集) and `@khorsheed/dsh-eval` registers `eval-lab` (order 40, label 实验室).
- Each registers a `sidebar.panellist` icon and a `main` panel under the same id. The plugin manager is 0 and schedules are 10, so these sit after them.
- Both registrations go through `slots.inject` on a structural view of the registry, because neither package depends on ui-layout or ui-sidebar. A host that does not declare the slots never fires the inject, so it shows no entry and raises no error.
- The panel component (`global-panel.tsx` in each package) renders the session tab's own view (DatasetsView / LabView) with the same face object. It passes the empty sentinel `''` as `sessionId` and inert tab-strip owner props. No new view was written.
- Visibility follows docs/plugin-visibility.md. The content is cross-session, so there is no runtime switch. The panels register regardless of the current session's preset, and the install layer decides which profile shows them.
- Icons: datasets uses its generated `icons.tsx` (`IconDatabaseOutlineRegular`). eval imports `IconGaugeOutlineRegular` straight from ui-primitives, as its other components already do, since eval is 0.2.0-only.

### Session dependencies removed

- **datasets Remote**: every method dropped the `agent` parameter. None of them read anything session-specific.
  - The client face calls `remote.x(request)`.
  - 「添加题集」 still opens a new 「题集整理」 session, as it did from the tab.
  - The workspace for that session now falls back to the most recently active one when there is no current session (`recentWorkspaceOf`, mirroring ui-workspace's 「新会话」).
- **eval Remote**: every method except `approve` dropped the `agent` parameter.
  - `approve` keeps it because the approving session is the run's parent and its cwd is the run's cwd.
  - Request types gained session fields:
    - the tag-writing requests (retry, exportRun, reexport, finalize, humanFinal, closeRun, archiveRun) extend `EvalCaller { session?: string }`;
    - `EvalExperimentsRequest` gained `session?` (`runs` echoes it);
    - `EvalDraftRequest` gained `originSession?`.
  - `callerTag()` records a person's mark as `tab:<session>`, or as `panel:lab` when there is no session. Only `tool:` is flagged by the report, so the new tag is neutral.
  - For the same reason, `EvalService.humanFinal` and `writeHumanFinal` take `sessionId: string | null`.
- **LabView in the panel** (`sessionId === ''`):
  - The list scope is forced to 全部 and the scope switch is hidden.
  - 「让 Agent 组织」 (新建实验), 「让 agent 处理」 and the send-back's "here" target go through a new face verb, `startSession(title, text)`. It opens a new evaluation-mode session, navigates there, and drafts the text without sending it, with the clipboard as fallback. The send-back's "here" label reads 新会话的输入框.
  - 批准并开始 creates a new session in the background (no navigation) and approves under it. If no session can be made, it answers an error result rather than throwing.
- **eval's new-session doors** (`client/new-session.ts`) probe each host door at call time and degrade when one is missing:
  - `sessions.create`;
  - `workspaces.list` for the recent workspace;
  - `remote.agentPresets` list/select, keeping the default preset when it already names `@khorsheed/dsh-eval/tool` and otherwise taking the first unbroken preset that does;
  - the `sessions.using` rename;
  - `uiWorkspace.openSession`;
  - the composer `setDraft`, retried while the session view mounts.

### The T96 card goes to the global panel; the DOM anchor is retired

The card's open action stores the review request under the panel key `''` and calls `ctx.layout.selectPanel('datasets')`. When there is no `layout` service, or `selectPanel` throws because nobody registered the key, the request moves to the session's own key and the card shows the one-line "open the 题集 tab" notice. The `switchToTab` tab-strip click is deleted. `selectPanel` is a public host verb with a defined failure (a throw), so the fragile anchor has nothing left to cover.

## Alternatives considered

**Global twin methods next to the session ones** (e.g. `runsAll()` beside `runs(agent)`). This would keep the wire compatible, but every read would exist twice. The session parameter was never read by most methods, so a twin would have carried a dead dependency forward. It lost to simply removing the parameter. Both halves ship in one package, so they upgrade together.

**A synthetic session for the panel** (pass some real session id, such as the most recent one). This makes the panel's reads and marks lie about where they came from (`tab:<someone else's session>`), and it fails on a fresh install with no sessions. It was rejected.

**Keeping the DOM anchor as a second fallback after `selectPanel`.** When `selectPanel` fails, the panel is not registered, so the host has no global-panel mechanism. A tab-strip click there would be the same fragile path T96 already flagged. The words-only fallback is honest and stable. It was rejected.

**A separate icons module or a regenerated eval `icons.tsx`.** The icon generator refuses eval because eval already imports ui-primitives icons directly. eval is 0.2.0-only, where `IconGaugeOutlineRegular` exists. A generated copy for one icon would be ceremony. It was rejected.

**Preset-gating the panels like the tabs.** A panel's content is not bound to the current session, so a session-preset criterion is undefined there (the 2026-09-16 canvas self-hide failure). It was rejected per docs/plugin-visibility.md.

## Consequences

- The registry and the experiments are one click from the sidebar, with no session, and the tabs keep working as before.
- The Remote signature change is a wire break between halves from different sides of T97. One package ships both halves, so a normal install never mixes them. Both packages' `dsh.compat.notes` and README Compatibility sections say so.
- Marks written from the panel are tagged `panel:lab`, so the record still says the panel wrote them, but not which tab.
- An approval from the panel creates a session the person did not navigate to. It is titled 「运行 <experiment>」 so it can be found in the session list.
- Only one in-repo profile lists these packages: `profiles/web-eval`, through `@khorsheed/dsh-bundle-eval`. So the entries appear there and nowhere else in this repo.
