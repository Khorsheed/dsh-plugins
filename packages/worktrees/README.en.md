# @khorsheed/dsh-worktrees

English | [中文](README.md)

Which worktree is this session working in, and does it have uncommitted changes? One glance at the header tells you.

In multi-worktree development, "which branch is this session on and how much is uncommitted" used to mean a trip to the terminal to run git. This plugin puts the answer in the session header: a branch capsule badge (with combined diff line counts, tinted when dirty) that opens a right-sidebar worktrees page — pending changes with diffs, an IDE-style commit log, and a full repository browse. Every surface is a read-only git fact; the plugin itself never writes to the repository. The one capability that does (creating/removing worktrees) lives in a session-granted companion tool package, and removal always asks for confirmation first.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/pilot-badge-standard.png" width="640" alt="the worktrees badge in the session header: a branch capsule (branch name + combined diff counts +175 −34) next to the repository-name capsule">

## Features

- **Session-header badge** (`conversation.session.header.utilities`, repository sessions only) — the branch name plus the combined uncommitted/committed diff line counts; hover for the two-segment breakdown; the counts tint warn when there are changes and stay neutral when clean. Refresh never relies on periodic polling (one summary costs 5–6 git invocations): every right-sidebar tab refresh, the host-forwarded `api-session/status` (turn boundary) and `api-session/activity` (user message) events, and the window regaining focus/visibility all trigger a re-read.
- **One click to the changes** — the branch capsule opens the right-sidebar worktrees tab through `ctx.sidebarRight.openTab` (also enterable from the sidebar's guide page).
- **Worktree-pending mode** — the currently selected worktree's full uncommitted set (worktree dimension, deliberately not session-filtered), VS Code Source Control style: leaves carry A/M/D/?? badges and line counts; selecting a file flips the right detail pane between 「改动 | 内容」 (colored diff / official CodeBlock) while the left tree collapses to an icon rail (click to restore); the header switcher repoints the list at another worktree.
- **Repository-commits mode** — this checkout's commit history (`git log HEAD`, newest 200: short sha + subject + relative time + branch/tag decorations), still useful after the branch merges into base; selecting a commit expands its commit file tree inline (with real add/del counts and the commit body), and clicking a file shows that commit's diff and content-at-commit.
- **Repository-files mode** — the full tracked file tree (`git ls-files`); click a file for its content, images render inline.
- **The detail pane's Reload gesture** — re-reads the current file's active view (diffs through the diff Remote, content/images through the read Remote); the old content stays visible in flight with the button disabled and spinning, and a failure keeps it, reporting through the existing error slot. Files pinned at a commit are immutable and carry no reload gesture.
- **Git action row** — refresh / copy branch name / show in folder (shown only when the once-per-page official open-in-app probe confirms a host file manager).
- **"Switch to this worktree" guidance** — after pointing the switcher at another worktree, one click appends a context notice to the session WITHOUT waking the agent (producer-owned kind `worktrees`), so the agent knows to use the new workdir on its next natural turn — zero extra model calls.
- **Preset-gated self-hide** — by default both the badge and the right-sidebar tab type read the official `pluginInventory` composition criterion: visible exactly when the current session's preset composition grants the companion tool row `@khorsheed/dsh-worktrees-tool`; every unreadable path fails open (stays visible). The tab type self-hides at the REGISTRATION level (the guide enumerates registrations, so hidden means unregistered; opened tabs are stored per session, so an ungranted session's layout never held one).
- Trees default to the first level with expand-all / collapse-all; every file list is fetched once (client-side trie) and only per-file diffs load on demand. File preview shares one content pane with the Files plugin, `@khorsheed/dsh-client-ui-content-preview`.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/worktrees-tab.png" width="640" alt="the worktrees tab in Worktree-pending mode: a changes file tree with A/M/D badges and line counts on the left, and the selected file's colored diff in the right detail pane">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/pilot-badge-other-preset.png" width="640" alt="on a preset that does not grant the companion tool row (minimal mode), the badge and the right-sidebar tab type self-hide, leaving only the official header buttons">

## Install

```sh
dsh plugin --profile web add @khorsheed/dsh-worktrees
```

Restart the web instance to activate; uninstalling restores the previous composition exactly:

```sh
dsh plugin --profile web remove @khorsheed/dsh-worktrees
```

A composition may mount the `worktrees` row exactly once: the official images (the npm release line and upstream master) mount no such row, so the add above is the install path — a composition that already mounts the id by other means must NOT also add it (a duplicate loader entry id fails boot). When in doubt, check first: `dsh --profile web --dump-config | grep worktrees` printing nothing means the add is safe.

> **The model tool split out (BREAKING, since 0.2.0)**: the core no longer registers the model-facing `worktrees` tool at the profile root — the tool rides the companion `@khorsheed/dsh-worktrees-tool`, **granted per session** through agent-preset compositions (migration: install the companion and add `- id: worktrees-tool / name: '@khorsheed/dsh-worktrees-tool'` to the target preset's `agent.cordis.yml`; web-dev's dev preset already carries it). The badge / service / Remote are unchanged; the right-sidebar tab TYPE now self-hides on the same criterion at the registration level.

## Config

| Field | Default | Description |
|---|---|---|
| `baseRef` | `main` | Base branch for the committed segment (`base...HEAD`) and ahead/behind; `''` disables the committed segment entirely |
| `visiblePresets` | `[]` | A **manual override** for badge and right-sidebar tab visibility. Absent or empty = the **composition criterion**: the official `pluginInventory` preset-composition data decides — visible exactly when the current session's preset composition names the `@khorsheed/dsh-worktrees-tool` row; unavailable composition data (no namespace, RPC failure, a missing or broken preset group), sessions with NO preset, and the no-session home state all stay visible (fail-open). A non-empty list falls back to the pilot semantics: sessions whose preset id is outside the list render no badge and register no tab type. The config reaches the browser through the Remote's `badgeConfig` method — the web boot hands client entries no config |

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`): ✅ full — the changes/commits/repository view migrated to the official right-sidebar tab surface (a page type registered into `ctx.sidebarRightTabs`, its body in the keyed `sidebar.right.pane.tab` seat, opened from the badge through `ctx.sidebarRight.openTab`); the "show in folder" gesture now rides the official open-in-app route probe (GET `/open-in-app/apps` + POST `/open-in-app/open`, directories only), restoring the gesture 0.1.2 had to hide. The badge stays in `conversation.session.header.utilities`: the 0.1.5 header corner is a single slot the shipped web composition already occupies with ui-sidebar-right's ExpandButton, and single-slot semantics are shadowing (same priority throws at registration, a different priority replaces the occupant) — no coexistence. The badge's and the tab type's default visibility criterion reads the official `pluginInventory` composition data (the tab at the registration level: the guide enumerates registrations, so hidden means unregistered; verified live on 0.1.5: visible on the dev preset, hidden on standard, clean flips). Full build and tests pass; minHost moves up to 0.1.5-rc.1 — older hosts stay on the previous release line.
- source line (deepseek-harness master): ✅ (verifiedHost: 0.1.7-rc.1). Headless profiles have no browser consumer and this plugin contributes nothing there. Badge and tab visibility: by default both read the official `pluginInventory.list()` preset-composition data (visible when the session's preset names the `@khorsheed/dsh-worktrees-tool` row); a non-empty `visiblePresets` is a manual override (read from the session's `projectionValues.agentPreset` projection); both paths fail open when the read is unavailable. Session V4 adaptation: the directAgent context message's source moved to the producer-owned kind `worktrees` (the `form: 'notice'` one-line form is kept; V4 native admission refuses the retired `kind: 'plugin'` wrapper at the durable write; a 0.1.5 host's `user/message` admission accepts any non-empty kind, and both lines' renderers classify an unknown non-`user` kind as a context-injection row labeled by the kind).

**Version-line map**: `0.2.0` and later support host `0.1.5-rc.1` and up; hosts on `0.1.2-rc.1` stay on `0.1.0-rc.9`.

## Known Limitations

- **The per-session worktree switch is in-memory** — the active-worktree override lives in the host process; after a host restart the session falls back to its static cwd and must be re-switched.
- **A 2 MiB preview cap** — content/image reads of repository files beyond the cap are refused; git-agnostic local-file reads truncate at the cap and report incompleteness, and binary files get a non-text placeholder.
- **No periodic polling** — plugin-owned events cannot enter the official Remote event-forwarding allowlist (upstream seam S17), so the badge's freshness rides the triggers listed above; purely external git changes between turns appear at the next trigger.
- **Not for headless profiles** — every surface is web UI; a composition with no browser consumer gets nothing from this plugin (and no error either).

## How it works

<details>
<summary>Internals (click to expand)</summary>

**Architecture.** The host half is the `WorktreesService` core (`ctx.provide('worktrees')`) plus the `WorktreesRemoteService` Typert Remote (cordis key `worktreesRemote`, wire namespace `worktrees` — the browser calls `remote.worktrees.*`). The service is stateless — the worktree registry is `git worktree list` itself; the Remote is a thin adapter that resolves the calling agent's session cwd (the session's active-worktree override wins, falling back to `header.cwd`) and delegates to the core, copying no logic. Every git command runs inside the resolved repository toplevel, and every client-supplied path passes `assertSafePath` (absolute paths and `..` rejected) before any diff or read — the surface never escapes the session's repository. The Remote also carries a git-agnostic local-file family (`listLocalDirectory` / `readLocalFile` / `readLocalImage`): absolute paths, the same validation, no session binding — callable by any session or the global frame.

**Client.** The generated Remote contribution is self-mounted through the official `ctx.remote.$mount` — no core-package edits; composing the plugin out removes every surface it adds. The badge registers into `conversation.session.header.utilities` (order -20, leftmost); the right-sidebar tab uses the official two-stage registration — the type into `ctx.sidebarRightTabs` (behind a registration-level visibility toggle), the body into the keyed `sidebar.right.pane.tab` seat. "Show in folder" uses ui-content-preview's `OpenInAppProbe` (one probe per page at apply, published through a snapshot store the surfaces subscribe to); the preview kernel is likewise ui-content-preview's `ContentPane`. Host→client invalidation borrows the two events the official `api/remotes` allowlist forwards (`api-session/status` on a turn boundary, `api-session/activity` on a user message); the `$on` capability is probed, and on hosts without it the badge keeps working through its other triggers.

**Directing the agent.** `directAgent` appends a durable `user/message` (`surfaceOp: 'append'`) to the session WITHOUT waking it: a producer-owned source kind `worktrees` in the one-line `form: 'notice'` shape, rendered immediately as a context-injection row and folded into the context at the next model boundary. The read side's `isWorktreesSource` accepts all three forms: the new kind, the V3→V4 migrated `plugin:@khorsheed/dsh-worktrees`, and the V3 wrapper a 0.1.5 host still serves verbatim (`kind: 'plugin'` plus the `plugin` field).

**The model tool lives in the companion.** The definition factory `defineWorktreesTool(service)` is exported from this package's `./tool`; the registrant is the companion `@khorsheed/dsh-worktrees-tool` (a non-self-mounting row — no `ctx.provide`, no `dsh.bundle` — referenced by name from each agent preset's `agent.cordis.yml`), so the capability is granted per session and the profile root never carries the row. Four actions: `list` (path/branch/is-main/dirty-count/merged-into-base), `switch` (the session's badge and tab follow), `create` (`git worktree add`, optionally `-b` a new branch, then switch), `remove` (`confirm: true` required; the main worktree and any worktree with uncommitted changes are refused).

**Health probe and identity.** The `./invariant` subpath registers an invariant companion that probes the `git` binary on PATH at load — the whole plugin is a git reader, so a host without git can never answer a query; a loud load-time failure beats empty badges everywhere. The identity triangle: the `cordis.patch.yml` row id `worktrees` ↔ tsdown `clientBundle('@khorsheed/dsh-worktrees')` ↔ the invariant's `PACKAGE_NAME`.

**Exports.** `.` exports the plugin body (`apply`/`Config`/`name`); `/client` exports the browser half (`apply`/`inject`, `WorktreesBadge`/`WorktreesTab`/`WorktreesController`); `/tool` exports `defineWorktreesTool`; `/types` is the Remote wire-type vocabulary (including the `WorktreesService` type); `/typert` and `/remote` are the two generated Remote sides.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/worktrees`). Issues and contributions welcome there.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
