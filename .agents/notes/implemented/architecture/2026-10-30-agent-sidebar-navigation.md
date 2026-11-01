# Agent Note: one contract for taking the person to what the model just wrote

Status: implemented

## Problem

The mode plugins (library, game, video, canvas and the novel, room) each had their own way of bringing the person to what the model had just created or written:

- **library** polled `latestActivity` every 5 s and opened the project page, once per session per page load.
- **game** kept a reveal request in host memory, which the browser polled every 6 s.
- **video** only followed inside a room.
- **canvas** used tool rows that opened the canvas only when the row itself saw the call running, by parsing the Chinese answer with regexes.
- **room desk rows** followed using four copies of `shouldFollow`.

Destinations travelled through five private channels:

- module globals (`parkedNav`, `requestPanelProject`);
- one-shot classes (`RevealedProject`);
- direct writes to a panel's store;
- host-side rebinds;
- typed `navigation.params` (room only).

The places they could name were coarse: a project, a canvas, a separate chapter page. The person reported the visible symptom: "I created a chapter, and it did not take me to that chapter, but to the chapter detail page."

In canvas-novel that symptom had four causes:

- A body write or a bare chapter create never opened anything, while its answer told the model "正文在右栏章节页能读" ("the text can be read on the chapter page in the right sidebar").
- A plan opened a separate `novel:chapter` page, not the 章节 (chapters) face, whose reading position was local state and could not be addressed.
- In a room, the desk item carried no chapter number, so its door fell back to `openCanvas`, which keeps wherever the row last stood.
- After paging inside the chapter page, reopening the same parameter did nothing, because `samePlace` returned early.

The user settled the rules on 2026-10-30 (proposal agent-sidebar-navigation, local `proposals/active/`).

## Decision

**Each layer has one way of doing it.** The contract is `docs/agent-nav.md`, and the shared code is the source-plane library `packages/client-ui-agent-nav`, which each plugin's client bundle inlines. The library has no runtime coupling and is listed in `check:plugins` like ui-panel-kit.

- **Address.** A panel's places are typed navigation params (`SidebarRightTabParamsMap`). Every outside way in goes through one `go(params)` per owner.
  - Canvas declares `'canvas': CanvasNavParams` = `{ canvasId, card?, manuscript?, type?, face?, scope?, item?, focus?, heading? }`.
  - `goTo` in `client/index.ts` puts the strip at the most specific field. `go` opens the tab and then calls `goTo`.
  - Every existing door now calls `go`: propose-type, canvas_open row, desk rows, inbox, bind chip, and `canvasNav.go/openFace/openPage`.
  - The tab body also applies `tab.navigation.params` once per navigation revision.
  - `openBoardFace` carries `item`/`focus`. The canvas hands the `manuscripts` ask to the genre's 成稿 seat as `target`.
- **Signal.** A write tool ends its answer with one line:

  ```
  ⟦dsh-nav⟧{"id","kind","params","label"}
  ```

  - A tool result is content blocks only, so this line is the one channel that reaches the browser. A custom session event type would break any history it lands in once its registering package is uninstalled.
  - Host halves are not bundled, so each package writes the line through a small inline `src/nav-line.ts`. A test pins that copy to the library's `readDestinations`.
  - The destination is the thing just written:
    - `canvas_write` names the one card or manuscript its before/after diff shows, else the board face, and nothing for an archive;
    - `canvas_open` names the canvas;
    - `canvas_propose_type` names the type page;
    - `novel_write` names a chapter as `{ face: 'manuscripts', item: N, focus: 'plan' | 'body' }` (plan, bare create or text), and an outline as `{ face: 'lead' }`;
    - `novel_extract` names `{ face: 'board', scope: 'recent' }`.
  - Answers no longer claim the sidebar opened. They say where the thing is ("在画布「章节」页签的第 N 章（会话里有卡片直达）", "in the canvas 章节 tab, chapter N (a card in the conversation goes there)").
  - A call that carries the room desk mark writes no line (canvas checks `deskOf`; canvas-novel's `told()` strips it). The desk row stays the one thing that moves the sidebar in a room.
- **Presentation.** `startNavFollower` subscribes to the on-screen session's event window and runs one rule, `decideFollow`. The on-screen session is `sidebarRight.mounted`; the window is `sessions.binding(id).eventSource`.
  - The host publishes live events as `append`, and opening, reconnecting and paging back as `replace`/`prepend`. So the follower acts only on an appended `tool/result` whose `tool/call` it also saw appended.
  - The checks, in order:
    - already handled → skip;
    - replay → skip;
    - not on screen → badge;
    - a room member's write → badge;
    - window narrower than 820 px → badge;
    - a panel touched within 20 s (`interactionHandlers` on the panel root) → badge;
    - the sidebar already moved in this Turn → badge;
    - otherwise follow.
  - What must be shared across the inlined copies (handled ids, the Turn that moved, last interaction) lives in one `globalThis` registry.
  - Every decision logs `[nav] dest=… kind=… decision=… reason=… session=…`.
  - In canvas, follow means `go`, and badge means `addCanvas` (the strip dot).
  - Conversation cards only offer doors: `OpenCanvasRow`, `PlanCard`, `OutlineCard`, `BodyCard`, `ExtractCard`, the Turn tail. Their own `sawRunning` auto-open is gone. The row model strips the line from what it shows.
- **library, game and video-studio (P2) adopt the same contract.**
  - **library**: `'library'` params reach every route (project, book, station tab, lesson, quiz, cards, today) through one `go()`; the pane applies them once per revision. Tools name the project, the book (a textbook, or a roadmap waiting for 采用), the lesson (讲义), the quiz, and the station's 页 tab. `library_cards` deliberately names nothing: it often records a weak point mid-reading, and the existing 「已记下 · 撤销」 toast is its door. The 5 s `latestActivity` reveal and `RevealedProject` are gone. The station's user-initiated waits for 讲义 and quizzes stay: right after the click the follower only badges (busy), and the wait lands on the same place.
  - **game**: `'game'` params `{ projectId?, view, elementId?, chapterId?, version? }` behind `go()`; turn-card doors and the desk row call it. `game_publish` lost `show`: its destination comes from the version diff (`changedBy`), and `game_open` lands on 试玩. The reveal controller, `liveVersion.show` and the host-side show requests are gone. A running game calls `markInteraction()` every 5 s, so the follower treats the panel as busy.
  - **video-studio**: `VideoNavParams` `{ projectId, tab?, groupId?, jobId? }` behind `go()`. Tools name the project (create/open, now followed outside rooms too), 素材 (import), the proposal group in 文稿 (scrolled to and flashed), and 导出 (render). `requestPanelProject` is gone.
- **Room desk rows and reader (P3).**
  - The follower takes an `events` mapper: an owner turns its own appended session events (`room/desk-opened`, `room/desk-wrote`) into destinations with the act's role (`deskDestinationsOf` in canvas, game, video-studio, library), judged by the same `decideFollow`. A coordinator's live open follows; a member's only badges (canvas: the strip dot); a coordinator's canvas write needs nothing. The four copies of `shouldFollow` and its 20 s window are gone, and rows only offer the door.
  - The canvas 「写了…」 door lands through `deskWritePlace`: the chapter written, the one card or manuscript, or every card touched under a temporary 「本轮改动」 board chip (`CanvasNavParams.cards`). The novel's desk items carry the chapter number; older events read it from the title.
  - reader: `'reader'` params `{ entryId, tab? }`; `reader_note` names the 笔记 tab and `reader_translate` the text; a keyed tool row for both offers 查看 →; no follower (decision 4).
- **Only the unified mechanism remains (11-01).** One conversation card shell, `registerDestinationCards` (a row under each write tool and a Turn-tail summary, the door always the answer's destination, a mode filling only the `Body`; `turnTail: false` where a mode's own Turn summary already names every change — the game's turn card, itself a body in the shell). A write signal: the follower notifies a kind's listeners of every live destination (`subscribeWrites`, `notifyWritten` for a panel's own gestures), so panels re-read at once instead of polling; a visible-only 30 s fallback stays; only background-job progress still polls, and only while a job runs. Deleted with it: canvas's `OpenCanvasRow` / `ProposeTypeRow` and their prose parsers, the novel's `WriteToolRow` / turn fold / answer parser / 10 s plan poll / retired chapter and plan pages, the reader's own card, the library's station waits (a panel hand-off now calls `releaseInteraction()`) and host `latestActivity` / `noteSessionWrite`, the game turn card's own frame and its 6 s / 8 s polls (a room member's publish / propose now writes `room/desk-wrote`), and video's fixed 3 / 8 / 15 s polls.
- **The shell is fixed; plugins hand data (11-02).** The user's model: a plugin calls the shell to show a card and simply stops calling when a flow goes away, so no plugin card UI can outlive its flow. A destination may carry `card: { status, awaiting, door }`; `updateCards(kind, match, data)` hands what came of a state the person changed in the panel, and a newer live write of the same place with card data updates that place's earlier cards. The status shows only for a write that arrived live on this page (the user chose that a replayed card keeps only its label and plain door, over showing a stale status or a timestamp). A mode's own Turn summary is data too (`registerTurnSummary`, a `load` returning rows). The novel's card bodies, the game's turn card UI and every package's desk-row styling are gone; richness (plan text, before/after looks, proposal detail) lives only in the panel the door opens. `check:plugins` pins that a package seats cards only for tools it defines and that a package writing destination lines seats cards.
- **The chapter has one place.** The 章节 face's `ChapterBook` takes `target` and opens its reader on chapter N, focused on the plan when asked.
  - It answers each ask once per page: a module map is keyed by canvas, because the face remounts on every face switch while the canvas keeps its last ask.
  - In-panel chapter links (story log, plan view) call `navigate.openManuscripts(item)`.
  - The `novel:chapter` page stays registered only to forward a strip row saved on it.

## Alternatives considered

**A separate `open_panel` / `game_show` tool the model calls.** Game tried this. It gave two sources that both moved the panel, and the model forgot to call it (note 2026-10-27-game-autonav). The tool that wrote the thing knows exactly where it is.

**Keep polling and only share the helper.** Polling state lives in host memory: it is lost on restart, cannot be replayed, and cannot be seen afterwards, which is exactly why "it didn't jump" was hard to locate. The live/replay distinction already sits in the event window.

**Follow from the tool row that saw the call run.** The host folds finished rows into 「已调用工具」 and may render only settled rows, so the jump silently does not happen. The event window does not depend on rendering.

**A registered session event per destination.** It is clean on the wire, but every history carrying it fails to load once the registering package is uninstalled (memory: session event types must be registered).

**Keep the separate chapter page and only fix its number.** It leaves two places for one chapter, and the user chose the 章节 face (decision 2).

**Let every write tool take a model-chosen `show`.** The user decided against it (decision 3): the destination is derived from what changed. Game's `show` is to be removed when game adopts the contract.

**Only document the convention; no shared code.** The follow rule already drifted across four copies. Rules that are subtle (replay, busy, narrow, turn-once) are written and tested once.

**Put it in ui-panel-kit.** The panel kit is visual only. Behaviour gets its own library, tests and rollback.

## Consequences

- One `[nav]` line per decision. "It didn't open" is now located by checking, in order: the answer's last line, then the console line, then the decision and reason, then whether the panel applied the params.
- The model reads one short JSON tail per write (~60 tokens). An uninstalled follower reads nothing, and old histories without the line keep their doors (the row models still parse the answer text).
- A destination can be followed only while the person watches the call land in the on-screen session. Writes from a backgrounded tab, or a reconnect mid-turn, leave the card and a dot, by design.
- Removed: canvas rows' auto-open, and the novel cards' auto-open of the separate chapter page and of 规划 (the planning face). The cards and the Turn tail keep their doors.
- The rule's mechanics are pinned by `packages/client-ui-agent-nav/tests`. The line format is pinned by `packages/canvas/tests/nav-line.spec.ts` and `packages/canvas-novel/tests/nav-line.spec.ts`. The landing places are pinned by `packages/canvas/tests/tools.spec.ts` ("where a canvas write landed") and `packages/canvas-novel/tests/tools.spec.ts`.
- The busy signal is page-wide: a running game also holds back canvas or library follows. Game and video show no badge; their conversation cards are the way back to a destination that was not followed.
- Every package in scope has migrated (P1–P3 in docs/agent-nav.md). A room desk row now follows only when its event is appended live, so a row that arrives while the room session is off screen and is then opened is history, by design.
