# canvas-novel (the canvas's 长篇小说 / long-novel genre)

Turns dsh into a workbench for serialized long-form fiction. One work spans dozens of sessions and a hundred chapters, and the model has to do four things: remember the canon, know where the last chapter ended, never let a foreshadow die, and never write a character wrong. Full-text injection cannot do these; this package can.

**A work is a canvas whose genre is 长篇小说**. The cards on that canvas are the single source of truth for the settings, organized in four categories: 人物 (characters), 世界 (world), 原则 (principles) and 伏笔 (foreshadows). This package registers the genre with the canvas and provides the work-memory engine: refs, reconciliation, the ledger and the briefs. It has no browser half of its own; its whole UI lives inside the canvas.

It replaces the retired `@khorsheed/dsh-story-bible`. Data under the old `$DSH_HOME/state/story/` is **not migrated**.

## What it provides

- **Genre registration** (joined through deferred injection on `ctx.canvasBoard`; no canvas, no genre):
  - A canvas created as, or switched to, 长篇小说 is seeded with the four categories.
  - Each category carries its card field definitions. For example, a character has name, identity, want, lack and wound; a foreshadow has question, status, planted-at and answer.
- **Engine service `ctx.canvasNovel`**: the engine's own state lives in `$DSH_HOME/state/novel/<canvas id>/`, in five files:

  | File | Contents |
  |---|---|
  | `annotations.json` | The cards' display refs and engine notes: tension, current state, confidence, the auto-import mark |
  | `experiences.jsonl` | The character experience journal, keyed by character card id |
  | `mentions.jsonl` | The foreshadow mention journal, keyed by foreshadow card id |
  | `chapters.json` | The chapter index and plans |
  | `pending.json` | The pending review queue |

  The single source of truth for manuscripts is `<workspace>/<canvas title>/第{n}章.md` in the canvas's mounted workspace.
- **Three model tools**, registered by the `./agent` composition entry and origin-tagged:
  - `novel_read`: the brief in three variants, cards, card, chapters, ledger, pending, chapter;
  - `novel_write`: card proposes a ghost card or edits a card by ref, chapter numbers automatically, review accepts, discards, archives or retracts;
  - `novel_extract`: prepare builds the material pack, import files the result through five validation gates.
- **The `novel:pointer` function section** (order 9500): renders one line when the session is bound to a long-novel canvas, and an empty string otherwise, so small talk costs nothing.
- **The `novel` skill**: an on-demand operating manual that carries no work content.

## Key design

- **The session binding decides scope**: the canvas chip in the session header binds a session to a canvas.
  - Only sessions bound to a long-novel canvas get the three tools; they are granted and revoked on the session's own scope.
  - Unbinding, or changing the canvas's genre, revokes them at once.
  - In an unbound session the tools are absent, not denied.
- **The cards are the single source of truth**:
  - Every setting the model creates is a **ghost card** (the canvas's proposed status). It stays out of the brief until the user accepts it with ✓; ✗ discards it into the archive.
  - Cards are never deleted; an archived card stays on the canvas, hidden.
  - An edit merges fields into the card in place instead of starting a new one.
- **Refs**:
  - Characters use `c<n>`.
  - World and principle cards use `w<n>`, and foreshadows use `#<n>`. These three share one number space, so `w19` and `#19` never coexist.
  - A new card takes the max of its space plus one. Tools, plans and reconciliation can name a card by ref, card id, or (for characters) name.
- **Review closes a chapter, always last**:
  - A chapter goes: written → reconciled → pending items handled → the user's 「✓ 审过」 closes it.
  - If the manuscript is not right yet, fix it first; do not reconcile it.
  - All five reconciliation gates live in plugin code:
    1. an evidence search of the manuscript, against fabrication;
    2. the foreshadow whitelist;
    3. new settings, foreshadows and characters always land as ghost cards;
    4. high confidence imports automatically and can be retracted, while medium and low confidence go to the pending queue;
    5. missed plans go to the pending queue on their own.
  - Delegating the grading to the host's native subagent is the main agent's job; the plugin itself never delegates.
- **Briefs have token budgets**: about 2k for write, about 2.5k for plan, and extract scales with the manuscript. No variant injects every previous chapter or every foreshadow.

## Install

```sh
dsh plugin add @khorsheed/dsh-canvas-novel
```

This package needs the canvas (`@khorsheed/dsh-canvas`) installed alongside it. Without the canvas there are no works: every engine verb answers `missing`, and nothing throws.

The patch mounts two rows:

| Row | Contents | As shipped |
|---|---|---|
| `canvas-novel` | The core: genre plus engine | Available everywhere |
| `canvas-novel-agent` | The three tools, the pointer and the skill | **Disabled** at the profile root |

The agent surface belongs to the writing scene, not to every session.

**The only supported way to enable the agent surface is a preset grant**:

```sh
dsh plugin add @khorsheed/dsh-bundle-writing
```

Its `preset-writing` mounts `@khorsheed/dsh-canvas-novel/agent` inside the writing preset's scope. A preset of your own works the same way: add a line `name: "@khorsheed/dsh-canvas-novel/agent"` to that preset's `agent.cordis.yml`.

Enabling the root row by hand (removing `disabled: true`) makes it apply to every session. **Do that only when no preset grants the entry**: with both live, the same names register twice and the boot fails.

## Quick start

1. Create a canvas with the 长篇小说 genre and mount a workspace on it. Bind the session to it with the canvas chip in the session header.
2. Talk through the settings. The model files them as ghost cards, and you accept them with ✓ or discard them with ✗ on the canvas.
3. Plan. `novel_write(what=chapter, plan=…)` registers the plan; once confirmed, start writing.
   - The manuscript lands in the canvas workspace through the session's fence.
   - If it cannot land, the registration is refused, so an empty-slot chapter never appears.
4. Reconcile once the chapter is written: run `novel_extract(prepare)`, delegate to a subagent, then run `novel_extract(import)`.
   - Handle the pending items, then close the chapter with 「✓ 审过」.
   - The phase lamp runs: planning → writing → extracted → reviewed.

**UI status**: card faces, card sections, the board strip and the session-header binding chip ride the canvas's genre seams. The chapter reader, the foreshadow ledger page and the pending strip have no UI yet; use the tools for that part for now.

## Compatibility

| Host line | Verdict |
|---|---|
| npm release 0.2.0-rc.2 | ✅ Development baseline (verifiedHost): the full build and test run on this line |
| deepseek-harness master | Verified as it moves. Function prompt sections, the ctx.fs version guard and per-scope tool registration are long-term seams |

The machine-readable label is `dsh.compat` in package.json (minHost `0.2.0-rc.2`):

- State writes go through the ctx.fs fence, re-rooted at the plugin's own state directory; a read-only deployment still refuses them.
- Chapter manuscripts land in the canvas workspace under the session's sandbox mode.
- A headless profile has no browser, and the agent row works as usual.

中文：[README.md](README.md)
