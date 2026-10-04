# story-bible (long-form novel writing · memory core)

Turns dsh into a workbench for serialized long-form fiction: one work spans dozens of sessions and a hundred chapters, and the model must remember the canon, know where the last chapter ended, never let a foreshadow die, and never write a character wrong. This package is the work-level memory system that does those four things — the four things full-text injection cannot (proposal: `proposals/active/2026-10-04-story-bible.md` in this repo, deliberately gitignored).

**M1 scope (this version)**: the memory core plus the injection surface — **host-only, no browser half**. The two right-sidebar tabs (chapter reader / inspiration wall) land with M3 against the Remote data face `story` already mounted here.

## What it provides

- **Work registry + per-work memory store** (`ctx.storyBible`): `index.json` and one directory per work under `$DSH_HOME/state/story/` (`work.json` / `memories.json` / `characters.json` / `experiences.jsonl` / `mentions.jsonl` / `chapters.json` / `pending.json`). The single source of truth for manuscripts is `<workspace>/<title>/第{n}章.md` in the mounted workspace; the state directory holds derivatives only.
- **Remote service `story`**: the UI data face (listWorks / createWork / readWork / listMemories / listCharacters / listExperiences / listChapters / readChapter / ledger / listPending / focusWork / getFocus / reviewChapter / writeMemory / writeCharacter / decideMemory / decidePending / extractImport).
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

## Quick start (the M1, UI-less flow)

1. `story_write(what=work, title=…, workspace=…)` creates and focuses a work (an existing title focuses instead).
2. Talk setting → `story_write(what=memory, kind=…)` drops a ghost card; the user's ✓ (`story_write(what=review, target=memory, …)`) routes it by kind.
3. `story_read(what=brief, for=plan)` → `story_write(what=chapter, plan=…)` (n allocates max+1).
4. `story_read(what=brief, for=write)` for the writing pass; the manuscript lives in the workspace file.
5. The user approves → `story_extract(chapter, phase=prepare)` → delegate to a subagent → `story_extract(phase=import, payload=…)` reconciles.

## Compatibility

| Host line | Verdict |
|---|---|
| npm release 0.2.0-rc.2 | ✅ development baseline (verifiedHost): full build+test ran on this line |
| deepseek-harness master | tracked; function prompt sections, Typert Remotes and the ctx.fs version guard are long-standing seams |

Machine-readable labeling lives in package.json `dsh.compat` (minHost `0.2.0-rc.2`): M1 declares no `dsh.client` browser half; state writes go through the mounted ctx.fs with the boundary re-rooted at the plugin's own state dir (a read-only deployment still denies); the focus map is process-lifetime — a restart means "nothing focused", which the pointer and the tools answer honestly.

中文: [README.md](README.md)
