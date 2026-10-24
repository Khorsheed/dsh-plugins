# @khorsheed/dsh-canvas-novel

English | [中文](README.md)

**Full-length novel (长篇小说)** — the inspiration canvas's novel genre: a hundred chapters in, the Agent still remembers the canon, knows where the last chapter ended, never lets a foreshadow die and never writes a character wrong.

A serialized novel spans dozens of sessions and a hundred chapters, and feeding the model the full text cannot do that. With this genre installed, a work is a canvas whose genre is 长篇小说: characters, world, principles and foreshadows are cards on that canvas, the single source of truth for the settings. First you settle a one-page outline and the volumes with the Agent on the 规划 (planning) face, then go chapter by chapter: register a plan, write, reconcile. Finished chapters land in your workspace, foreshadows, relations and character experiences go into the story log, uncertain changes wait in Pending, and you close each chapter with 「✓ 审过」 (reviewed).

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/canvas-novel-board.png" width="640" alt="The long-novel canvas board: a slim strip on top with the current chapter, the pending count, the story log and the contents door; below, the four card categories — characters, world, principles, foreshadows — with a few new cards carrying the amber ✦ mark">

## Features

- **One work, one canvas** — create a canvas with the 长篇小说 genre and it is seeded with four categories (characters, world, principles, foreshadows), each with ready card fields (a character has name, identity, want, lack, wound, ambition and values).
- **The planning face: a one-page outline plus chapter planning** — the first face, 规划, holds the one page (logline, protagonist, length) and a chapter roadmap that stops at volumes, with only the next chapter or two sketched; an outline the Agent drafts appears as a dashed proposal that takes effect only when you click 「采用」 (adopt), and you can change it any time afterwards.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/canvas-novel-planning.png" width="640" alt="The planning face: whole-book progress on top, the one-page outline, the Agent's outline proposal in a dashed box with 「采用 / 不采用」, then the chapter roadmap by volume and the core suspenses">

- **Settings become cards directly** — settings that come up in conversation are filed by the Agent as live cards with a ✦ new-card mark; fix or archive the wrong ones, and ✓✓ marks them all seen at once; only one character card, or one world card, may carry a given name.
- **Refer by number** — characters are `c3`, world and principles `w5`, foreshadows `#12`; tools, plans and reconciliation can refer to a card by number, card id or character name.
- **Confirm the chapter plan before writing** — each chapter registers a target length, summary, beats, conflict, highlight, foreshadow ops, cast and closing hook; a plan card appears in the conversation, and 「查看并确认计划」 (view and confirm) opens the chapter page to read it in full and clear it for writing.
- **The text lands in your workspace** — each chapter is `<workspace>/<canvas title>/第{n}章.md`, openable by any editor; if it cannot land, the chapter is not registered, so an empty-slot chapter never appears.
- **Reconciliation and Pending** — after a chapter is written it is reconciled, and the five gates (evidence searched in the text, a foreshadow whitelist and so on) all live in the plugin's code; high-confidence changes go straight in, while mid/low-confidence ones and missed plan items wait in Pending for you to accept or discard.
- **Review closes the chapter, always last** — the chapter reader carries a phase lamp (planning → writing → extracted → reviewed), and while the chapter is not reconciled or still has pending items, 「✓ 审过本章」 (review this chapter) is disabled, with a line beside it saying what is missing.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/canvas-novel-chapter.png" width="640" alt="The chapter reader: the phase lamp, the plan block folded to one line, this chapter's pending items, the text, and at the bottom 「✓ 审过本章」 with previous / contents / next">

- **Story log** — chapters run across and four bands run down: where foreshadows were planted, advanced and resolved; how relations rose and fell; each character's appearances and experiences per chapter; edits to world settings; clicking a row shows each field's source and its changes chapter by chapter.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/canvas-novel-story-log.png" width="640" alt="The story log page: chapters across, bands for foreshadows, relations, characters and world, and one foreshadow's details open at the side in the Now and Changes tabs">

- **Relation cards** — each pair of characters has one relation card (romance, family, friendship, mentor, rivals, allies, other, four levels each); each chapter scores the pair on stage from the text, a full tally marks it 可升 (ready), and it rises only when the event actually happens in the text — see the [relation evaluation criteria](docs/relation-criteria.en.md).
- **Foreshadows and clues** — set the volume a foreshadow reveals in, reconciliation records the clues laid so far, and the planning face paces it by volume: before its volume it may be hinted but not revealed; ★ marks a main line, and a foreshadow asleep too long turns red in the story log.
- **The manuscript is the book** — the canvas's 成稿 (manuscript) face becomes a table of contents plus a reader: a whole-book progress spine with one tick per chapter colored by phase, 「从这里继续」 (continue from here), and chapters folded in groups of ten.
- **Pick up across sessions** — the canvas chip in the session header, or the Agent's `novel_bind`, binds a session to a work; once bound, the Agent reads a token-budgeted brief (about 2k for writing) and never gets every earlier chapter injected.

## Install

The full-length novel arrives with the **writing mode** pack (the canvas comes with it); installing the mode pack (together with the basic experience) is the recommended path:

```sh
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-writing-suite
```

With the mode pack, the novel tools are granted per session by the writing mode's preset: only sessions switched to the writing mode have them, and other sessions see none of them. Then create a canvas with the 长篇小说 genre to begin.

Advanced — standalone install (install the canvas with it):

```sh
dsh plugin --profile web add @khorsheed/dsh-canvas @khorsheed/dsh-canvas-novel
```

This package needs the canvas (`@khorsheed/dsh-canvas`) installed alongside it. Without the canvas there are no works: every engine verb answers `missing`, and nothing throws.

The patch mounts two rows:

| Row | Contents | As shipped |
|---|---|---|
| `canvas-novel` | The core: genre plus engine | Available everywhere |
| `canvas-novel-agent` | The four tools, the pointer and the skill | Available everywhere (aligned with canvas) |

Installing alone gives every session the agent surface: `novel_bind`, the pointer and the `novel` skill are open to all sessions, while `novel_read` / `novel_write` / `novel_extract` still appear only for a session bound to a 长篇小说 canvas. The writing mode pack scopes it per mode instead: its 写作模式 (`preset-dsh-writing`) grants the same entry (`@khorsheed/dsh-canvas-novel/agent`) in its own scope, next to the canvas tools (`@khorsheed/dsh-canvas/agent`); the mode pack's patch does not mount the same-named root row, and under host 0.2.x that mode's sessions see the scoped copy shadow the global row (pinned by the host's scoped.spec.ts) — both live at once no longer fails the boot. A preset of your own works the same way: add a line `name: "@khorsheed/dsh-canvas-novel/agent"` to that preset's `agent.cordis.yml`. To keep the novel tools exclusive to writing mode, disable the `canvas-novel-agent` root row in the profile as well — a scoping choice, not a crash-avoidance requirement.

## Quick start

1. Create a canvas with the 长篇小说 genre and mount a workspace on it (tick one under 「工作区」 in the canvas ⋯ menu; a canvas the agent makes with canvas_open takes the session's workspace, and a work without one takes it when its first chapter is written). Talk about the work in a writing session and the model binds it with `novel_bind`; you can also bind by hand with the canvas chip in the session header.
2. Settle the outline. Talk through the logline, core conflict, protagonist, ending and length (how many volumes, about how many chapters, characters per chapter) with the model; it drafts the one page and the volumes with `novel_write(what=outline)`, and you click 「采用」 on the 规划 face. The volumes stop at volume level: about how many chapters each, what it achieves, where it lands; a chapter gets detailed as you near it. The protagonist is a character card, with name, identity, goal, ambition and values on the card.
3. Talk through the settings. The model files them as live cards with a ✦ new-card mark on the canvas; glance over them, fix or archive (✗) the wrong ones, then click ✓✓ to mark them all seen.
4. Plan. `novel_write(what=chapter, plan=…)` registers the plan: target length (defaults to the one page's per-chapter length; the number of beats is estimated from it), summary, beats (a few steps with time labels, marked as turn or landing), conflict, highlight, foreshadow ops (advance / hint / plant / resolve, each saying what it moves), cast (with the POV) and the closing hook. A plan card appears in the conversation; 「查看并确认计划」 opens the chapter page to read it in full, and 「✓ 确认计划」 clears it for writing. To change it, just say so in the conversation.
   - The manuscript lands in the canvas workspace through the session's fence.
   - If it cannot land, the registration is refused, so an empty-slot chapter never appears.
5. Reconcile once the chapter is written: run `novel_extract(prepare)`, delegate to a subagent, then run `novel_extract(import)`.
   - Handle the pending items, then close the chapter with 「✓ 审过」.
   - The phase lamp runs: planning → writing → extracted → reviewed.

## Compatibility

| Host line | Verdict |
|---|---|
| npm release 0.2.0-rc.2 | ✅ Development baseline (verifiedHost): the full build and test run on this line |
| deepseek-harness master | ✅ Verified (verifiedHost: 0.2.1-rc.1) — host-021 wave: full build+test green against the 0.2.1-rc.1 tree; no other surface changes. Function prompt sections, the ctx.fs version guard and per-scope tool registration are long-term seams |

The machine-readable label is `dsh.compat` in package.json (minHost `0.2.0-rc.2`):

- State writes go through the ctx.fs fence, re-rooted at the plugin's own state directory; a read-only deployment still refuses them.
- Chapter manuscripts land in the canvas workspace under the session's sandbox mode.
- A headless profile has no browser, and the agent row works as usual.
- The conversation plan card sits on the host's `tool.call.toolview` slot; without that slot `novel_write` keeps the generic tool row. Opening the chapter page relies on the canvas's `canvasNav` service; with a canvas version that lacks it, the card shows no door.

## Known Limitations

- **Needs the canvas alongside** — without the canvas (`@khorsheed/dsh-canvas`) there are no works: every engine verb answers `missing`, and nothing throws.
- **A read-only canvas can only be read** — a canvas not opened from a session cannot answer pending items or close a chapter.
- **Old data is not migrated** — this package replaces the retired `@khorsheed/dsh-story-bible`; data under the old `$DSH_HOME/state/story/` is **not migrated**.
- **The main agent delegates the reconciliation judging** — handing the judging to a host-native subagent is the main agent's call; the plugin itself delegates nothing.
- **The plan card relies on a host slot and a canvas service** — without the `tool.call.toolview` slot `novel_write` keeps the generic tool row; with a canvas version that lacks the `canvasNav` service, the card shows no door.

## How it works

<details>
<summary>Internals (click to expand)</summary>

### Genre and engine

**A work is a canvas whose genre is 长篇小说**. The cards on that canvas are the single source of truth for the settings, organized in four categories: 人物 (characters), 世界 (world), 原则 (principles) and 伏笔 (foreshadows). This package registers the genre with the canvas and provides the work-memory engine: refs, reconciliation, the ledger and the briefs. Its browser half only adds UI to the canvas's genre seams (the pending strip, the story log page, the chapter reader page) and opens no entry of its own.

### What it provides

- **Genre registration** (joined through deferred injection on `ctx.canvasBoard`; no canvas, no genre):
  - A canvas created as, or switched to, 长篇小说 is seeded with the four categories.
  - Each category carries its card field definitions. For example, a character has name, identity, want, lack, wound, ambition and values; a world card has name, kind and setting; a foreshadow has question, status, planted-at, reveal timing and answer.
- **Engine service `ctx.canvasNovel`**: the engine's own state lives in `$DSH_HOME/state/novel/<canvas id>/`, in five files:

  | File | Contents |
  |---|---|
  | `annotations.json` | The cards' display refs and engine notes: tension, current state, confidence |
  | `experiences.jsonl` | The character experience journal, keyed by character card id |
  | `mentions.jsonl` | The foreshadow mention journal, keyed by foreshadow card id |
  | `chapters.json` | The chapter index and plans |
  | `pending.json` | The pending review queue |
  | `outline.json` | The outline: the one page, the volumes, one-line sketches of the near chapters, the proposal awaiting adoption, the revision log |

  The single source of truth for manuscripts is `<workspace>/<canvas title>/第{n}章.md` in the canvas's mounted workspace.
- **Model tools**, registered by the `./agent` composition entry and origin-tagged:
  - `novel_bind`: lists the long-novel works and binds the calling session to one by title; it sits on the grant scope, so unbound sessions have it too;
  - `novel_read`: the brief in three variants, outline (the outline and the core suspenses), chapters, ledger, pending, chapter;
  - `novel_write`: chapter numbers automatically (with volume to start a new volume), outline proposes outline changes (they take effect once you adopt them on the 规划 face), review handles pending items (accept, discard);
  - cards have no tool of their own: on a novel canvas the canvas's `canvas_read` / `canvas_write` hand the five role categories to this package's genre hooks — `canvas_read` lists the cards with their refs (c3, #12, w5) and the chapters in order as the manuscripts, and reads one card in full with `cardId`; `canvas_write op=card` lands a new card (live, duplicate-checked), patches one by ref with `cardId`, and `op=archive` archives;
  - `novel_extract`: prepare builds the material pack, import files the result through five validation gates.
- **The `novel:pointer` function section** (order 9500): renders one line when the session is bound to a long-novel canvas, and an empty string otherwise, so small talk costs nothing.
- **The `novel` skill**: an on-demand operating manual (including the stage-and-role model: an editor sorting the main line at ideation, a partner executing the plan while drafting, a companion with the smallest next step when blocked) that carries no work content.

### Key design

- **The session binding decides scope**: the canvas chip in the session header binds a session to a canvas.
  - Only sessions bound to a long-novel canvas get the read/write/extract tools; they are granted and revoked on the session's own scope.
  - There are two ways to bind: the model calls `novel_bind` from what the conversation is about (asking the user when it is unclear which work), or the user picks one in the chip. In an unbound session the pointer says only "novel_bind first".
  - Unbinding, or changing the canvas's genre, revokes them at once.
  - In an unbound session those three tools are absent, not denied.
- **The cards are the single source of truth**:
  - Every setting the model creates **lands live**: it enters the brief and the ledger at once and can be named by ref. New cards carry an amber ✦ mark and sit first on the canvas until opened or archived; a small dot on each category chip marks the categories with new cards, and the ✓✓ icon at the right of the chip row marks them all seen (red is kept for pending review). Fix a wrong card in place, or archive it with ✗.
  - Cards are never deleted; an archived card stays on the canvas, hidden.
  - An edit merges fields into the card in place instead of starting a new one; a character or world name holds only one card, and a new card reusing it is refused.
- **Refs**:
  - Characters use `c<n>`.
  - World and principle cards use `w<n>`, and foreshadows use `#<n>`. These three share one number space, so `w19` and `#19` never coexist.
  - A new card takes the max of its space plus one. Tools, plans and reconciliation can name a card by ref, card id, or (for characters) name.
- **Relations move by points**: one relation card per pair, each type (romance, family, friendship, mentor, rivals, allies, other) with four levels. Each chapter the model only scores a present pair −2…+2 from the text; code banks the points, and 3 points mark the pair 可升 (ready). It moves up only when the next level's event really happens in the text, and that goes to review. Rifts, breaks, repairs and type changes bypass points, and likewise need evidence and go to review. The score bands and each type's level-up conditions are in the [relation evaluation criteria](docs/relation-criteria.en.md).
- **Review closes a chapter, always last**:
  - A chapter goes: written → reconciled → pending items handled → the user's 「✓ 审过」 closes it.
  - If the manuscript is not right yet, fix it first; do not reconcile it.
  - All five reconciliation gates live in plugin code:
    1. an evidence search of the manuscript, against fabrication;
    2. the foreshadow whitelist;
    3. new settings, foreshadows and characters land live, marked new;
    4. high confidence imports directly (experiences can be retracted), while medium and low confidence go to the pending queue;
    5. missed plans go to the pending queue on their own.
  - Delegating the grading to the host's native subagent is the main agent's job; the plugin itself never delegates.
- **Briefs have token budgets**: about 2k for write, about 2.5k for plan, and extract scales with the manuscript. No variant injects every previous chapter or every foreshadow.

### UI details

**UI inside the canvas**: card faces, card sections and the session-header binding chip ride the canvas's genre seams; this package's browser half adds:

- **规划 (the first face)**: on top, the newest chapter, its volume and how much of the book is done; below, the one page (the protagonist block reads their character card; the name opens the card), the agent's proposal (a dashed block with 「采用 / 不采用」), a roadmap that stops at volumes (each volume's written chapters, the one or two sketched ahead, 「约 N 章，写到附近再细化」, the landing, the foreshadows it reveals), and the core suspenses: foreshadows set to reveal in a volume, with the clues the text has laid (recorded by reconciliation) and a pacing line. A core suspense is never flagged for chapters asleep: before its volume it may be hinted but not revealed; only a volume nearly done without touching it, or a reveal volume reached with too few touches, earns a soft reminder.
- **A slim strip at the top of the board**: the current chapter (the earliest one with pending items, else the latest; a click opens its chapter page), Pending N, the story log, and 「目录 · 共 N 章 ›」.
- **成稿 is the book**: a long-novel canvas's 成稿 face is a table of contents plus a reader. The contents open with a progress spine for the whole work (one tick per chapter, colored by phase, red where items are pending), 「从这里继续」, all / to-do / not-reviewed filters, and the chapters in folding groups of ten (groups with work in them, and the last one, start open). A chapter opens the reader in place.
- **Chapter reader**: phase lamp, plan block, this chapter's pending items and the text, then 「✓ 审过本章」, a glimpse of the next chapter, and a pager (previous / contents / next) that stays in reach. The plan block is open with 「✓ 确认计划」 while planning; once there is text it folds to one line so the text leads; after extraction that line says how many beats and foreshadow ops the text carried, and each is marked ✓ / ✗ when unfolded (a missed op is also pending and blocks review; a missed beat is only a reminder). While the chapter is not extracted or still has pending items the review button is disabled, and the line beside it says what is missing.
- **Plan card in the conversation**: after `novel_write` registers a chapter plan, the conversation shows the chapter, its summary and the counts of beats, foreshadow ops per kind and cast; while it waits for confirmation the button reads 「查看并确认计划」 and opens that chapter's page. Every other `novel_write` call shows as one line with the answer behind 「详情」. Without the canvas installed the card has no door.
- **Story log**: the door shows the foreshadow active and overdue counts; a click opens the story log page. Chapters run across; four bands run down: foreshadows (where each was planted, advanced and resolved, planned marks hollow; one asleep past the threshold turns red, and ★ marks it as a main line), relations (each pair's stage moves, rifts and repairs, and points per chapter), characters (each chapter's appearances, POV and experiences) and world (edits to setting cards). Open foreshadows show by default; filter to all, sort and zoom, and drag the minimap at the bottom to scrub. Clicking a row opens its details at the side in two tabs: Now gives each field's source (model, adopted, your edit) and chapter, and Changes lists every change chapter by chapter with its evidence from the text.
- **Pending N**: appears only while there is something to review and unfolds in place (accept / discard, or "got it" for a missed plan); the board refreshes after each answer.

A read-only canvas (one not opened from a session) can be read but not acted on: no pending answers, no review.

### The workspace integration seam (server-side consumption)

Mounting this package on an **isolated Context with its own stateRoot** is a supported consumption form: the mounting side starts an independent instance with this package's `apply` + `config.stateRoot` on its own Context — the engine's state is bound per instance (`<stateRoot>/<canvas id>/`), and the read verbs (`readWorkMeta` / `listWorks` / `readEntries` …) need no session. The canvas service is probed per call (`canvasBoardOf`): provide `canvasBoard` on the SAME Context for a zero-code binding; without it there are no works, every verb answers `missing`, and nothing throws.

```ts
import { apply } from '@khorsheed/dsh-canvas-novel'

apply(isolatedCtx, {
  stateRoot: '/path/to/instance-state/novel',
})
```

The mounting side's obligations and the semantics:

- **The mounting Context MUST provide `fs` at construction**: the package injects `['fs']` (eager injection) — cordis never mounts the row in a composition without one, and a direct `new NovelService(ctx)` on a Context without fs fails at construction with a package-named error, not later at the first write.
- **The write verbs' session is optional; the fence never is**: every write verb takes `session: Session | undefined`. With a session the behavior is byte-identical to before (the session resolves the MODE and lends its id; the writable boundary re-roots at the plugin state root). Without one (a server-side caller with no conversation) the DEPLOYMENT DEFAULT mode resolves and no id is lent — a read-only deployment still answers `denied`. A policy home that cannot resolve session-less at all refuses the write coded `denied`, never silently allows. A chapter manuscript still lands in the canvas workspace FIRST (the boundary re-rooted at the work's workspace), and the registration is refused when it cannot land; session-less, the work must bring its own workspace (there is no session cwd to borrow).
- **`bindWork` still requires a session**: what it binds IS the session — a session-less caller has nothing to bind.
- **Terminal dispose + same-root rebuild**: `dispose()` is idempotent and terminal, and fires automatically when the borrowed Context is torn down — afterwards every public verb, reads included, refuses with the coded package-named `NovelDisposedError` (`code: 'disposed'`). A write racing disposal either completed before the write boundary or refuses at it — it never reaches the disk a rebuilt instance now owns. Rebuilding over the same state root is legal: a new service instance on it works as usual (only the old instance is dead).
- **Local behavior unchanged**: with a session passed as before, the semantics are byte-identical.

**The agent-free native-gesture adapter**: the Remote face's (`remote.novel.*`) gesture verbs take the calling `agent` first — the wire's lookup convention — and a server-side caller has none and must not fake one. `createNovelGestureAdapter(core, session?)` (exported from the package root) offers the seven gesture verbs — `decidePending`, `reviewChapter`, `decideOutline`, `confirmPlan`, `editPlan`, `starForeshadow`, `setCurrentState` — as plain function calls, with the Remote's own wire types as requests and receipts. The Remote verbs and the adapter run the SAME shared cores (`src/gestures.ts`), so the two faces answer byte-identically by construction — including `editPlan`'s text-plan parsing (the parsing rules live in `planFromText` alone), the `changed` receipts and the unknown-handle lists. With `session` omitted, the session-less fence above applies; a disposed core refuses every verb with the coded `NovelDisposedError`. The adapter never touches an Agent, the host lookup, or the `agents` service. The eight read verbs (`pending`, `ledger`, `storyLog`, …) are browser-surface shaping over core projections; a server-side caller reads the core it already holds (`readEntries`, `listChapters`, `readOutline`, …) directly, and the adapter does not duplicate them. Note `./src/*` is not a consumption entry — the published package ships only `lib/`; always import from the package root.

```ts
import { apply, createNovelGestureAdapter } from '@khorsheed/dsh-canvas-novel'

apply(isolatedCtx, { stateRoot: '/path/to/instance-state/novel' })
const gestures = createNovelGestureAdapter(isolatedCtx.canvasNovel) // session optional
await gestures.editPlan({ canvasId: work, n: 6, text: '梗概：…\n情节：\n- …' })
```

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/canvas-novel`). Issues and contributions go there.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
