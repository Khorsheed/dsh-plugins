# story-bible (long-form novel writing · memory core)

Turns dsh into a workbench for serialized long-form fiction: one work spans dozens of sessions and a hundred chapters, and the model must remember the canon, know where the last chapter ended, never let a foreshadow die, and never write a character wrong. This package is the work-level memory system that does those four things — the four things full-text injection cannot (proposal: `proposals/active/2026-10-04-story-bible.md` in this repo, deliberately gitignored).

**Current version (M1+M3)**: the memory core, the injection surface, the two right-Sidebar page tabs (fragments' five views / chapter reader), and the keyed tool rows. The subagent-delegated reconciliation loop (M2) and the ledger meeting / archaeology layer (M4) come later.

## What it provides

- **Work registry + per-work memory store** (`ctx.storyBible`): `index.json` and one directory per work under `$DSH_HOME/state/story/` (`work.json` / `memories.json` / `characters.json` / `experiences.jsonl` / `mentions.jsonl` / `chapters.json` / `pending.json`). The single source of truth for manuscripts is `<workspace>/<title>/第{n}章.md` in the mounted workspace; the state directory holds derivatives only.
- **Remote service `story`**: the UI data face (listWorks / createWork / readWork / listMemories / listCharacters / listExperiences / listChapters / readChapter / ledger / listPending / listMentions / focusWork / getFocus / reviewChapter / confirmChapterPlan / writeMemory / writeCharacter / decideMemory / decidePending / patchMemory / foreshadowExit / retractExperience / extractImport).
- **The two right-Sidebar tabs (M3)**: fragments (wall / sets / characters / world / info + the pinned pending queue) and the chapter reader (plan card with ✓ confirm / numbered chapter grid / phase lamp with ✓ approve / the manuscript through the shared content pane / outline-draft view for planning chapters); the shared work strip (dropdown = focusWork, live counts, the create form); two keyed `tool.call.toolview` rows (story_write → plan card with "Confirm →", story_extract → reconcile card with "Review →"). Mode visibility follows the cross-session rule: no runtime switch — the install layer decides.
- **Three model tools** (registered by the `./agent` composition entry, origin-tagged): `story_read` (brief in three variants / memories / character / chapters / ledger / pending / chapter), `story_write` (work / memory ghost cards / character / chapter with auto numbering / review), `story_extract` (prepare material pack / import with five validation gates).
- **The focus pointer function section** (`story:pointer`, order 9500): driven by the per-session focus map — one guidance line with a focus, an empty string without; idle chat costs nothing.
- **The `story` skill**: one standing operating manual, loaded on demand, carrying no work content.

## Key designs

- **Focus scope**: a process-lifetime `{sessionId → workId}` map owned by the story service. Every tool and the pointer resolve through it; a session with no focus gets zero injection, and the tools answer guidance instead of errors.
- **Unapproved text never enters memory**: both `story_extract` phases hard-gate on the user's ✓审过.
- **Validation lives in plugin code**: the five import gates — evidence grep (anti-fabrication), the foreshadow-id whitelist, new_* always pending, high lands automatically (retractable) while medium/low pends, and missed plan ops pend separately. Delegating the judging to the host-native subagent is the main agent's job; the plugin never delegates.
- **Briefs carry token budgets**: write ~2k / plan ~2.5k / extract rides the chapter body; no variant ever injects all previous chapters or the whole foreshadow history.

## Install

```sh
dsh plugin add @khorsheed/dsh-story-bible
```

The patch mounts two rows: `story-bible` (core: store + Remote) and `story-bible-agent` (the tools, pointer and skill — the canvas `./agent` pattern). To scope the tools to one preset: disable the `story-bible-agent` row in the profile's `cordis.patch.yml` and add a row named `"@khorsheed/dsh-story-bible/agent"` to that preset's own `agent.cordis.yml` — never live at both levels at once (the tools would register twice).

## Quick start

1. The work strip atop either tab (「灵感碎片」/「章节阅读」): ＋ creates a work (title + a mounted workspace), the dropdown focuses one — the session's focus follows.
2. Talk setting → ghost cards land on the wall; ✓ routes them by kind (File → moves them into the sets).
3. Plan → the plan card pins atop the reader; ✓ Confirm plan, then write; the manuscript lives in the workspace file.
4. Read, then 「✓ 审过本章」(the human gate) → reconcile: `story_extract(prepare)` → delegate to a subagent → `story_extract(import)`; pending items wait in the pinned queue for your ✓/✗.
5. Switching works is the dropdown (focus, tools and the pointer follow). The same loop is drivable through the tools alone (story_write(work) focuses/creates).

## Compatibility

| Host line | Verdict |
|---|---|
| npm release 0.2.0-rc.2 | ✅ development baseline (verifiedHost): full build+test ran on this line |
| deepseek-harness master | tracked; function prompt sections, Typert Remotes, the ctx.fs version guard and the page-type right-Sidebar tab seats are long-standing seams |

Machine-readable labeling lives in package.json `dsh.compat` (minHost `0.2.0-rc.2`): state writes go through the mounted ctx.fs with the boundary re-rooted at the plugin's own state dir (a read-only deployment still denies); the focus map is process-lifetime — a restart means "nothing focused", which the pointer, the tools and the work strip answer honestly; a headless profile has no browser consumer and the agent row (tools/pointer/skill) works as before.

中文: [README.md](README.md)
