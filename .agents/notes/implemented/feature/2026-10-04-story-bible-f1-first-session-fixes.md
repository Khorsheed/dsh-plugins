# Agent Note: story-bible F1 — the manuscript write moves into story_write, and 审过 moves last

Status: implemented

## Problem

The first live session (a link dev instance) surfaced a structural bug and four presentation bugs:

- **空槽登记**: a work got registered onto a workspace OUTSIDE the session's sandbox (`lab-workspace`, a leftover path). The agent's own host-file-tool writes were fenced off, and it reported the mismatch honestly (that honesty stays). But the chapter had already registered — the reader showed 正文尚未生成 forever and `story_read(chapter)` read a missing file. Registration and the body write were two facts that could disagree.
- The custom tool rows looked like a second typography (own font/size/line-height) next to the host's message body.
- The phase lamp read 规划中 → 写作中 → 已审过 → 已抽取. The user ruled the correct order: 规划中 → 写作中 → 已抽取 → 已审过 — 审过是人工闸门，永远最后.
- Two registered tab kinds (story-fragments / story-reader) violated the user's expectation of one plugin = one host tab.
- An unconfirmed plan / an unhandled queue had no persistent surface — they sank.

## Decision

### F1-2: the manuscript write folds into story_write (the structural fix)

`story_write(what: chapter)` gains an optional `content` parameter: given, the store writes the body to `<workspace>/<title>/第{n}章.md` FIRST — through the calling session's resolved mode with the boundary re-rooted at the work's mounted workspace (the canvas exportManuscript fence: the session resolves the MODE, the work's registered workspace is the boundary) — and only then registers the chapter. A refused write refuses the registration: a chapter never sits on an empty slot again. The plan-only path (no content) registers as planning without touching the workspace. An existing file is rewritten under the version from the stat just taken. The fs layer creates missing parent directories. An agent may still write the file itself with host tools (the same workspace, inside its own fence) — registration stays plan-only then, and the reader's derivation carries the truth: planning+no body = 未生成; past-planning+no body = 文件丢失 · 重新定位 (the `fileMissing` derived phase — the gentle migration face for pre-fix rows, text-only for now).

The old failure mode is now impossible by construction: the store, not the agent, owns the write, and the fence answers before the index does.

### F1-6: 审过收章永远最后

The chapter machine is now 规划中 → 写作中(派生) → 已抽取 → 已审过. Concretely: `story_extract`'s prepare/import gate on the WRITING state (stored planning + non-empty body) — no body means nothing to reconcile; extracted and reviewed refuse. `reviewChapter` closes only an extracted chapter (`not-extracted` otherwise; reviewed is idempotent). The lamp arms ✓审过本章 exactly at 已抽取, disabled with the reason before, echoed 已审过 after. The skill's 铁律 2 becomes: 正文不满意就先改、别对账；审过收章永远最后. Invariant 2 (不满意的正文不进记忆) survives as process: extraction is still a deliberate user-initiated step, and the five import gates (evidence/whitelist/new_*/confidence/missed-plan) plus the pending queue and retract keep the memory honest.

### F1-4: one host tab

One tab kind `story` (写作), an internal 灵感碎片/章节阅读 switcher held in StoryUiStore, the M3 components kept as the two panes. The gate doors (去确认/去处理) live on the session-header chips (the tool rows were retired in the followup direction change): they switch the pane and open the one tab. The retired kinds' open tabs render the host's `tab.unavailable` fallback (a designed state); the README says close-and-reopen.

### F1-5: gate chips on the official seat

Two entries on `conversation.session.header.utilities` (a list slot: a chip with nothing to show renders nothing): 「第N章 plan 待确认」and「待确认 n」. Each reads its gate through the story Remote for the session's focus, on a 5s visible beat plus the shared store's rev. Session-bound chrome, so the preset criterion applies (preset-visibility.ts, the canvas template inlined per the doc's keep-copies rule): double probe (root row ∪ preset group), fail-open everywhere. Clicks open the story tab at the right pane.

### F1-1: workspace default + the picker door

The create form's workspace defaults to the SESSION's cwd (read structurally from useSessions), changeable through the host's directory picker (the datasets dual probe: legacy `ctx.workspaces.pickDirectory`, then `uiWorkspace.pickDirectory`; neither → a text input validated through the new `statWorkspace` Remote verb). A cross-workspace pick carries a forward-stated note: manuscript I/O depends on the session sandbox, and an outside workspace may be fenced.

### F1-3: the tool rows inherit the message body

`toolview.module.css` sets `font: inherit; line-height: inherit` on the row and drops every child font/size override; only layout and accent tokens (--dsw-*) remain.

## Alternatives considered

**Verify-then-register without owning the write** (stat at registration, refuse when missing). Rejected as the primary path: it still lets the agent's own fenced write fail silently before registration, which is exactly the reported bug. Owning the write makes the fence's answer the gate. The stat-verify survives as the read-side derivation (fileMissing), which is also the migration face.

**审过 before 对账 (M1's order).** The user's ruling overturns it; the lamp and the machine now agree. The skill text and the READMEs moved with it.

**Keep two tab kinds.** The host's tab registry is one-type-per-surface by convention; the internal switcher is mockup v7's actual shape.

**Chips on the composer dock instead of the header utilities.** The header seat is where glanceable session state lives (the message-timeline precedent); the composer dock is for input-adjacent actions. The chips point AT the surface, not at the input.

## Consequences

- The empty-slot chapter class is closed by construction; the reported session's own damage reads as 文件丢失 with guidance instead of a silent empty reader.
- The tool-row answers' typography is the host's body — the rows read as conversation, not as a foreign card.
- One plugin, one tab, one switcher state; old two-kind layouts degrade by design.
- The chips make the two human gates persistent without a new surface.
- `story_write(chapter)` with content is the write path the skill now teaches; host-tool writes remain legal inside the registered workspace.
- Tool descriptions, the skill, and both READMEs moved in the same commits; the M1/M3 notes' process descriptions stay historical.

## Related

- Superseded by [canvas-novel engine](2026-10-04-canvas-novel-engine.md): the package is now `@khorsheed/dsh-canvas-novel`, the genre 长篇小说 on the canvas.
