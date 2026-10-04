# Agent Note: story-bible M3 — the client surface (two tabs, one Remote, host verbs added)

Status: implemented

## Problem

M1 shipped the memory core headless: the whole loop (focus → ghost card → plan → write → review → reconcile) was drivable through the tools, but an operator had no surface to SEE it — the proposal's §6 promises two right-Sidebar tabs (灵感碎片 with five views, 章节阅读) whose acceptance is "mockup v7 全部交互真实可用；多作品切换隔离正确". M3 has to answer three implementation questions M1 left open: how two tab types from one package register, what the view layer reads where the M1 verb set stops, and how the surface learns about the main session's own writes (the agent edits the same store through story_* tools, unannounced).

## Decision

### Two tab types, two registration ids, zero runtime switches

The package registers two page types on the right-Sidebar registry: `story-fragments` under the package's own id (the identity triangle's client end) and `story-reader` under `@khorsheed/dsh-story-bible/reader` — the tab registry requires a unique `id` per type, and a kind's body registers under its definition's id on the keyed `sidebar.right.pane.tab` seat (verified in the host's tab-registry source, not assumed). Mode visibility follows docs/plugin-visibility.md's cross-session branch: the works store is deployment-level content, so there is NO runtime switch — the install layer decides, and the agent row (tools/pointer/skill) keeps riding the cordis preset grant untouched. The two `tool.call.toolview` rows (`story_write` → plan card with 「去确认」, `story_extract` → reconcile summary with 「去处理」) go through the structural slot view (the canvas propose-row precedent) and degrade to the host's generic rows without ui-tool.

### The view layer: one shared shell, per-view slices, poll + touch

Both tabs mount the same work strip (registry dropdown = focusWork, live counts from readWork, inline create form with the registered-workspace picker) and the same `useWorkShell` hook: registry/focus/info in one place, mutations wrapped to touch the shared store on a landed write. Each view fetches its own slice of the story Remote on mount and whenever the store's `rev` moves. The main session's agent writes through story_* tools unannounced, so a visible tab bumps the store on a 5-second beat (the canvas BOARD_POLL precedent) — polling plus touch, no invented action-metadata channel; the proposal's 「工具结果 action 元数据」 refresh contract is realized by the tool ROWS' doors (「去确认」/「去处理」 navigate to the relevant surface) plus this beat. The chapter body renders through the ui-content-preview kernel (source-plane inline, `ContentPane` with this package's own dictionary — the PREVIEW_KEYS resolution test pins the contract); a planning chapter shows the outline-draft view (its adopted wall ideas + plan) instead of an empty body.

### The host verbs M1 stopped short of (separate commit, 20bfa8c9)

The mockup's gestures needed five verbs the M1 set did not have, all added in the same fenced, version-guarded store style rather than worked around in the client:

- `patchMemory` — the 设定集's field edit rides the derives_from revision protocol the tool contract already documents (old row archives, new row heads the chain);
- `confirmChapterPlan` — the plan card's ✓ needs a durable fact (`planConfirmedAt` on ChapterRecord);
- `foreshadowExit` — the 世界记忆 card's three exits (登记揭晓/弃置/转设定) as ONE verb, so promote creates the canon rule and resolves the foreshadow into it atomically;
- `listMentions` — the dot strip reads mentions.jsonl;
- `retractExperience` — imported experiences now carry `e<n>` ids + the 自动·可撤销 mark, and the retract gesture removes one line by id (the journal stays append-only for the system; the user's retract is the sanctioned exception).

### The 场景/物品 boards render honestly empty

The proposal's §6 设定集 names five boards (世界观/人物/场景/物品/创作原则), but §2's kind axis (世界/人物/章节/伏笔点子/原则) files nothing into 场景 or 物品. Rather than inventing a tagging convention in the client, the two boards render with an empty state and this note records the seam: either the kind axis gains 场景/物品 values (a schema decision for a later milestone) or the boards fold into 世界观. The chip row stays five-wide so the layout does not move when the seam closes.

## Alternatives considered

**One tab type with an inner switcher.** Fewer registrations, but the two surfaces have different identities (one is a reader, one is a workbench), the guide would show one entry, and openTab-by-kind could not address either from the tool rows. Two kinds is also what the proposal's mockup has shipped since v1.

**Preset-visibility self-hide (the session-bound branch).** Rejected by the visibility doc's own rule: a session-preset criterion is undefined for cross-session content — the 2026-09-16 canvas self-hide incident hid a surface forever exactly this way.

**A chip badge with the live pending count.** It needs an apply-level poller keyed to a session's focus — real plumbing for a label. The queue itself carries the count in its header; the badge can land with the M4 maintenance layer if it is missed.

**Reaching around M1's missing verbs in the client** (e.g. editing a memory as delete+create from the browser). It would have lost the derives_from trail the invariant promises (LLM 写的一切都可见可撤) and split the revision protocol across two implementations. The host-side verbs are the smaller, more honest change.

## Consequences

- The full journey is drivable in a link dev instance: 新建作品 → 灵感落卡/采纳/归档 → 规划 → 写作 → 审过 → 对账 → 待审处理 → 多作品切换, all against the real store.
- The tool ROWS parse the M1 tools' settled answer text (stable heads frozen by tests); a future wording change to those answers must move the row regexes (`src/client/rows.ts`) in the same commit.
- `docs/packages.md` gained the story-bible web column; `scripts/check-plugin-independence.ts`'s ALLOWED_EDGES gained the story-bible → ui-content-preview source-plane edge (the local-files / worktrees precedent).
- 59 client+host specs pin the five views' same-source rendering, the ghost-card flow, the pending queue, the plan/review state machines, the work strip, the row parsers, the store, and the PREVIEW_KEYS dictionary contract.
- Known leftover: 在编辑器打开 prefers the open-in-app IDE probe (directories only — the host route refuses files) and falls back to the official document preview; the 场景/物品 boards are empty by design until the kind axis closes the seam.
