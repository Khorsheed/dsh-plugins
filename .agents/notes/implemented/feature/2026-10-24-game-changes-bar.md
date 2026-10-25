# Agent Note: any working change can be published from the panel; versions say who published

Status: implemented

## Problem

On 2026-10-24 a Claude Code member of a game session rewrote seven files, ran its own preview, and stopped there. Its handoff document said that publishing belonged to the dsh side. The member has no `game_publish`, the user had been talking to the member, and no dsh turn ended, so the play area stayed on the old version while the conversation said the work was done. Earlier the same day the dsh agent itself had asked follow-up questions without publishing. The panel's commit bar could not help: it listed only panel edits.

## Decision

- **The bar covers every source.** The `changes` Remote compares the working build files with the snapshot of the waiting candidate (else the live version). Files modified within a minute of that version's record, or later, are compared byte for byte. The result lists added, changed and removed files, the newest change's time, the panel edits among them, and, when the last check ran after the newest change and failed, that check's findings. The bar polls it every 8 s while the page is visible, which is how a member's writes appear without a turn. It reads 「有新改动还没进游戏 · N 个文件 · 最近一次 …」 (or 「还没有可玩版本」), lists the files on demand, and offers 「检查并发版」. That button is the old commit: the same checks, no fix cap, merged into one bar with the panel edits.
- **Disabled while someone is still writing.** `busy` is `turn` while a session bound to the project has a turn running (the turn hooks report `turn/start` and `turn/end`), and `recent` when a file changed in the last 20 s; a CLI member gives no other sign. The button is disabled and the bar says why. A turn's end checks the project anyway, and the bar looks again once a recent writer goes quiet. Nothing publishes automatically on quiet; that would mean many empty runs.
- **Versions record who published.** `VersionRecord.by` is `user` (检查并发版, finalize), `agent` (`game_publish`) or `turn` (the end-of-turn check). The versions timeline tags each row. `game_read` says 「v3（用户发布，用户认可过的版本）」. Older versions carry no tag. The tag names who pressed publish, not who wrote the files; the note and the file diff say what changed.
- **Publish first, then report.** The skill, the mode guidance and both persona copies now say: whenever something playable changed, call `game_publish` before reporting or asking, unprompted. Publishing is safe, because auto-confirm off makes a candidate and a failed check makes no version. When a CLI member reports changes, the dsh agent publishes them, and a handoff to a member says "tell me and I will publish".

## Alternatives considered

**A secondary "check anyway" button while the agent writes.** It was drawn first. The user preferred disabling: a half-written build would mostly fail the checks anyway, and a turn's end already checks.

**Publish automatically once files go quiet.** This would catch a member's finished work without a click, but every pause in writing would start a browser run. Deferred until the bar proves insufficient.

**Two bars (panel edits, file changes).** Both end in the same checks and the same version, and two bars invite the question of which one to press.

**Detect who wrote each file.** The plugin cannot see authorship across the agent, CLI members and the user's editor. It records who published, and the note and diff carry what changed.

## Consequences

- The panel costs one stat walk of the project every 8 s while visible, plus byte compares for recently touched files.
- The play area reflects the user's own publishes as well as the agent's, so the timeline interleaves both. The tags make it readable.
- Whether CLI members should get the mode's tools (so they can publish themselves) is the room/local-agent owners' call; this change does not depend on it.
- Interaction draft: `proposals/prototypes/game-publish-bar.html`. The shipped checking state shows the three stages as text, not live progress.
