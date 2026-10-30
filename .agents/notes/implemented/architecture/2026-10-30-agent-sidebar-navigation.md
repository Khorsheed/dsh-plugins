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
- **Not yet migrated.** These packages still use their own channels until they adopt the contract (P2/P3 in docs/agent-nav.md):
  - library: the `latestActivity` reveal, the project-level landing;
  - game: the `liveVersion.show` poll, `show`;
  - video-studio: `requestPanelProject`;
  - the room desk rows: four `shouldFollow` copies, and novel desk items without chapter numbers;
  - reader: cards only.
