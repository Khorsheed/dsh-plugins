# dsh-plugins

English | [中文](README.zh.md)

Community plugin monorepo for the **dsh** ecosystem (DeepSeek Harness): **14 packages** that extend the official web GUI. 13 are self-mounting bundles — each installs with one command and uninstalls with one command, and each is a pure increment: it mounts only its own loader row, touches official extension points (slots, commands, Remote services, session mirrors), and removes cleanly when uncomposed. The 14th (the local-agent family's delegation tool) rides the harnesses and uninstalls with them. The whole pack already runs together on the production profile, and nothing about the official UI is patched or replaced.

This README is the catalog: what each plugin does, how to load it, and exactly how to unload it. The repo is also a developer workspace — see [Development](#development).

## What's in the box

| Package (npm) | Face | Row id | One-line feature |
| --- | --- | --- | --- |
| `@khorsheed/dsh-client-message-tools` | host + client | `message-tools` | Edit, really-withdraw and restore user messages |
| `@khorsheed/dsh-message-timeline` | client | `message-timeline` | Floating history timeline along the chat scrollport, jump to any user message |
| `@khorsheed/dsh-client-session-title-edit` | client | `session-title-edit` | Inline session-title editing in the chat header |
| `@khorsheed/dsh-file-preview` | host | `file-preview` | Read-only file-preview Remote service (list + content + diffs) |
| `@khorsheed/dsh-client-ui-file-preview` | client | `ui-file-preview` | 「产物」tab, per-turn "N files changed" card, file-preview drawer |
| `@khorsheed/dsh-local-agent` | host + client | `local-agent` | Local coding-agent family **core**: scoped homes, login/session commands, delegation registry |
| `@khorsheed/dsh-local-agent-kimi` | host | `local-agent-kimi` | **Kimi Code** harness: `kimi -p` delegation, resume, usage accounting |
| `@khorsheed/dsh-local-agent-codex` | host | `local-agent-codex` | **Codex** harness: `codex exec` delegation, resume, usage accounting |
| `@khorsheed/dsh-local-agent-claude-code` | host | `local-agent-claude-code` | **Claude Code** harness: `claude -p` delegation, resume, usage accounting |
| `@khorsheed/dsh-local-agent-tool-subagent` | host (tool) | *(mounted by harnesses)* | Family-owned delegation tool with `resume` continuation |
| `@khorsheed/dsh-taskpilot` | host + client | `taskpilot` | Background-job / subagent dock pills above the composer with stop/interrupt and a detail drawer |
| `@khorsheed/dsh-whalesong` | client | `whalesong` | Task ambience: the whale spouts, the favicon animates, chimes on completion/blocked |
| `@khorsheed/dsh-ui-shortcuts` | client | `ui-shortcuts` | User-rebindable keyboard shortcuts: pause, steer-send, new session |
| `@khorsheed/dsh-ankh-guard` | host | `ankh-guard` | Safety gate for self-modification restarts: green-build credential + preflight + watchdog rollback |

Versions are the current workspace lines; the npm registry may have newer ones.

## Do the plugins conflict?

**No — they are designed to coexist, and they already do.** The production profile composes all 13 bundles over the stock `dsh-base` + `dsh-web-app` layers and boots; every client bundle serves. Three properties guarantee it:

- **Distinct loader entry ids.** Each `cordis.patch.yml` inserts its own row ids, and nothing is ever re-inserted: the local-agent family's core row ships only in the core bundle's patch (harness bundles declare it as a dependency instead), and each harness mounts its own tool row with a distinct id (`tool-subagent-kimi`, `tool-subagent-codex-local`, `tool-subagent-claude-code-local`).
- **Distinct UI seats.** Each client mounts its own slots with `slots.inject` discipline: `conversation.session.header.utilities` (message-timeline), `conversation.session.header.actions` (session-title-edit), `conversation.chat.node` (message-tools shadows the official user renderer), `conversation.input.dock` (taskpilot), `conversation.view` / `conversation.chat.turnTail` (ui-file-preview), `settings.general.item` (ui-shortcuts). `shell.overlay` is shared by taskpilot and ui-file-preview, but it is a multi-registration stack — two separate overlays, no fight.
- **Degrade, don't explode.** A plugin that cannot find an optional sibling or capability degrades silently instead of failing boot.

There are **two exclusivity rules** worth remembering, and they are the only real conflicts in the whole pack:

1. **`ui-shortcuts` is exclusive with the official `@deepseek-ai/dsh-client-ui-shortcuts`.** Both use the loader entry id `ui-shortcuts`; mounting both in one profile fails loud at boot on the duplicate id — keep exactly one. In practice the official one cannot even be installed: it was a fork-grown package, **never published to npm, and removed from the harness when it migrated into this repo** — the rule only guards against an old fork tarball lying around. The default web bundle never mounted a shortcuts row at all (not enabled, not disabled — simply absent).
2. **`ankh-guard` must not be added as a profile bundle on a host that already mounts the `ankh-guard` row** (pre-migration fork images did, via the base bundle): the duplicate row id fails boot. Check `dsh.profile.bundles` first; if the row is already there, skip the add (or disable the duplicate instead of adding).

And one namespace rule: exactly one composition may mount the `filePreview` Remote (ui-file-preview does); a double-mount logs loud but the rest of the plugin still registers.

## Install

Prerequisites: a dsh host ≥ `0.1.0-rc.6` (every bundle declares `minHost`), any profile (`web` / `headless` / custom). Every bundle declares `dsh.bundle`, so one command installs it **and** mounts its loader row — no hand-edited `cordis.yml`. Restart the web instance afterwards.

```sh
# one plugin, by npm name
dsh plugin --profile web add @khorsheed/dsh-whalesong

# from a tarball / a source directory (message-timeline is source-only — see below)
dsh plugin --profile web add ./khorsheed-dsh-whalesong-0.1.0-rc.5.tgz
dsh plugin --profile web add /path/to/dsh-plugins/packages/message-timeline
```

The whole pack, family by family:

```sh
# dialog control
dsh plugin --profile web add @khorsheed/dsh-client-message-tools
dsh plugin --profile web add @khorsheed/dsh-message-timeline
dsh plugin --profile web add @khorsheed/dsh-client-session-title-edit

# file preview (host service + UI, install both)
dsh plugin --profile web add @khorsheed/dsh-file-preview
dsh plugin --profile web add @khorsheed/dsh-client-ui-file-preview

# local-agent family (core + the harnesses you actually use)
dsh plugin --profile web add @khorsheed/dsh-local-agent
dsh plugin --profile web add @khorsheed/dsh-local-agent-kimi
dsh plugin --profile web add @khorsheed/dsh-local-agent-codex
dsh plugin --profile web add @khorsheed/dsh-local-agent-claude-code

# task / ambience / shortcuts
dsh plugin --profile web add @khorsheed/dsh-taskpilot
dsh plugin --profile web add @khorsheed/dsh-whalesong
dsh plugin --profile web add @khorsheed/dsh-ui-shortcuts

# ops guard (self-hosting / self-modification scenarios)
dsh plugin --profile web add @khorsheed/dsh-ankh-guard
```

## Uninstall

One command removes a plugin: the host CLI drops the dependency and reconciles its bundle row out of the profile, so every surface the plugin added disappears.

```sh
dsh plugin --profile web remove @khorsheed/dsh-<name>
```

The general rules:

- **Uninstall is exact.** No plugin patches or replaces official files, so removal restores the previous composition precisely.
- **User data is deliberately kept.** The local-agent family keeps each harness's scoped home (`$DSH_HOME/local-agent/<name>`) so a reinstall needs no fresh login — delete the directory to remove every trace. ankh-guard keeps its state under `stateDir` (`$DSH_HOME/state` by default): credentials, restart records, the interrupted-session snapshot. ui-shortcuts keeps your key bindings in `$DSH_HOME/settings.yaml`. Session logs are never touched by any uninstall — the audit trail of an edit/withdrawal lives in the log on purpose.
- **Family rows travel together.** Removing a harness removes its harness row, its `/…` command family, its tool row, and its UI rows. Removing the core (`dsh-local-agent`) while harnesses remain leaves those harness rows **pending, not crashing** — re-add the core to reactivate.
- **`enabled: false`** on a row disables a plugin without removing it — a deployment concern, not a code change.

Per-plugin unload details follow in the catalog.

## The plugin catalog

### Dialog control

#### `dsh-client-message-tools` — edit / withdraw / restore user messages

The only plugin in the pack that changes what the model sees, and it uses the official compaction mechanism to do it:

- **Edit** — in-place replacement: the host appends a `user/message` surface replacement whose content *is* the edited text; the model reads the edited text in place of the original, and everything that followed the original leaves the model context. Edit chains work (an edited bubble edits again), and the editor carries a real model chip.
- **Withdraw** — a real withdrawal, not a marker: the host appends a surface replacement whose span covers the target message and every surface node after it, so the span leaves `session.surface` and never reaches the model again. Each landed withdrawal renders as an expandable 「已撤回 N 条消息」 divider; the original text is backfilled into the composer draft (never auto-sent).
- **Restore** — a tail replay of the whole withdrawn span along its authoritative boundary (`sourceEventSeqs`): user messages verbatim, assistant replies as framed text, in original order. Tool calls/results never replay. Renders as a 「已恢复」 group.

Model impact (the one significant one in the pack): an edit/withdraw removes the shadowed span's tokens from subsequent requests and invalidates the KV-cache prefix from the replacement point — the same tradeoff as official compaction.

**Uninstall** — `dsh plugin --profile web remove @khorsheed/dsh-client-message-tools`: all edit/withdraw/restore surfaces disappear; the audit trail stays in the session log by design.

#### `dsh-message-timeline` — history timeline

A flat floating timeline along the left edge of the chat scrollport — one row per loaded user message (steering messages included, configurable), a dimmed tick at rest, text on hover/focus, click to jump. Follows the reading position, pages older history at its top, `enabled` is the master switch. Pure read of the session snapshot: zero events, zero prompts, zero model/KV impact.

> **Source-only package.** `dsh-message-timeline` is `private` and not published to npm — install it from this repo (`dsh plugin --profile web add /path/to/dsh-plugins/packages/message-timeline` or a packed tarball).

**Uninstall** — `dsh plugin --profile web remove @khorsheed/dsh-message-timeline`.

#### `dsh-client-session-title-edit` — inline session-title editing

A pencil control right of the title in the chat header → inline editor (Enter commits, Escape cancels, trimmed-empty disables save). Rides the official `session.rename` RPC, so a user-sourced title is **pinned** against automatic regeneration. No host half, no new RPC; titles are projection-only, so zero model impact.

**Uninstall** — `dsh plugin --profile web remove @khorsheed/dsh-client-session-title-edit`.

### File preview (host + UI)

#### `dsh-file-preview` — the host service

A read-only Remote service: `list` folds one session's log into the files its `read`/`write`/`edit` tool calls touched (nested Code Mode dispatches included), with every change's diff; `read` serves the current content of one of those files through `ctx.fs` (images as browser URLs). Config caps `maxReadBytes` / `maxFiles`. Owns no session state, writes nothing — the log and the filesystem stay authoritative.

**Uninstall** — `dsh plugin --profile web remove @khorsheed/dsh-file-preview`. If the UI half stays installed, its surfaces degrade to empty rather than fail.

#### `dsh-client-ui-file-preview` — the browser surface

A 「产物」 tab in the conversation view ring (beside chat and trajectory) listing the session's files with inline preview, a change-history tab stepping through every diff, and content search; a per-turn "N files changed" card at the end of each finished turn; a content-only drawer with show-in-folder / open-in-IDE gestures. Pairs with `dsh-file-preview` (declared as a peer, auto-installed); without the host row the surfaces render a degraded/empty state instead of failing boot.

**Uninstall** — `dsh plugin --profile web remove @khorsheed/dsh-client-ui-file-preview`; remove both halves together unless you keep the headless service.

### The local coding-agent family

Let dsh delegate sub-tasks to the coding-agent CLIs on your machine — Kimi Code, Codex, Claude Code — each in its own context, each with its own accounting, each continuable across rounds.

**Architecture.** `dsh-local-agent` (the core) is a harness registry plus scoped-home provisioning: every harness runs under its own scoped home (`KIMI_CODE_HOME` / `CODEX_HOME` / `CLAUDE_CONFIG_DIR` under `$DSH_HOME/local-agent/`, created 0700 because it holds credentials), so your personal config and credentials are never touched. The core registers the `/<harness> login|sessions|status|logout` command family and ships the roster-driven browser settings section (Settings → 本地 Agent). Each harness bundle registers one harness and mounts its delegation tool at the **profile root**, so every agent preset can delegate without per-preset variants.

**Delegation.** `subagent_kimi` (`kimi -p`), `subagent_codex_local` (`codex exec`), `subagent_claude_code_local` (`claude -p --output-format json`). The parent sees only the final answer or a precise error; the child has an independent context, independent tokens, independent KV cache — it never enters the parent's context.

**Continuation (resume).** The family tool (`dsh-local-agent-tool-subagent`) extends the official `subagent_*` schema with an optional `resume` parameter — the dsh child session id returned by the first delegation. A resumed call continues the **same** CLI conversation in the **same** dsh child session, accounting per round. The handle never travels inside the prompt: it is read from the parameter and validated against the registry per (parent, provider), so a forged handle is rejected before any CLI process starts.

**Accounting & records.** Real usage and duration per delegation (`turn/start` … `turn/end`, closed on failure/cancel too; tokens bucketed per CLI's own accounting — kimi four-bucket sum, codex deduped cache hits, claude per-bucket), and `/… sessions` lists the sessions each delegation produced.

**Install note — the core and the harnesses go in together.** `dsh plugin add` reconciles only *direct* dependencies into the bundles layer, so a harness's transitive dependency on the core does not activate the core row by itself:

```sh
dsh plugin --profile web add @khorsheed/dsh-local-agent
dsh plugin --profile web add @khorsheed/dsh-local-agent-kimi   # or -codex / -claude-code
```

Prerequisite: the corresponding CLI on `PATH` (the same binary you run interactively — the plugin never installs it). Then restart and run `/<name> login` once.

**Uninstall (each harness)** — `dsh plugin --profile web remove @khorsheed/dsh-local-agent-kimi` (or `-codex` / `-claude-code`): unregisters the harness, its command family, its tool row, and its UI rows. The scoped home `$DSH_HOME/local-agent/<name>` is **kept on purpose** (sessions + credentials, so a reinstall needs no fresh login); delete it to remove every trace.

**Uninstall (the core)** — `dsh plugin --profile web remove @khorsheed/dsh-local-agent`: unmounts the `local-agent` row and the settings section; any harnesses left installed stay pending (never crash). Re-add the core to reactivate. The `$DSH_HOME/local-agent` homes root is left; delete to wipe.

**`dsh-local-agent-tool-subagent`** has no bundle row of its own — it is mounted once per harness with a distinct tool name by the harness patches. Uninstalling the harnesses unmounts its rows and pnpm prunes the package as an unused dependency.

### Task & subagent monitoring

#### `dsh-taskpilot` — dock pills for background jobs and subagents

Two capsule entries above the composer, each independently shown only when it has data:

- **Background jobs** — the current session's jobs (running first, ticking every second), a stop button per running job, a row click opens the detail drawer.
- **Subagents** — the session's **full subagent lineage** (direct children + deep descendants, same index as the title tree), duration and token readouts, an interrupt button per running subagent (deep-child interrupts are authorized to their direct parent), a row click jumps to the child session.
- **Detail drawer** — command/type/status/times/duration plus a trajectory replayed from the session log (start, each `job_output` increment, stop, completion; collapsed by default).

All data comes from official mirrors (`jobsBySession` / `subagentsByParent` — the same sources as the title-tree list); the stop/interrupt verbs register on the official `commands` extension point (`/taskpilot-stop`, `/taskpilot-interrupt`). Zero model impact.

**Uninstall** — `dsh plugin --profile web remove @khorsheed/dsh-taskpilot`.

### Status ambience

#### `dsh-whalesong` — the whale spouts while tasks run

- **favicon waterline bubbles** — while any session runs, the tab icon becomes a whale bobbing at a waterline with three rising bubbles (SVG frames); idle keeps a static whale colored to the page palette.
- **sidebar droplets** — three DeepSeek-blue droplets rise from the sidebar whale's blowhole (DOM overlay anchored to the official logo, with a rail-corner fallback).
- **chimes** — completion: three rising sine glides; blocked: the same rise twice (WebAudio synthesis, no audio assets). `prefers-reduced-motion` silences both.

Config (`enabled`, `volume`) hot-applies within one poll round-trip, no refresh. Read-only over the session list: zero model impact.

**Uninstall** — `dsh plugin --profile web remove @khorsheed/dsh-whalesong` restores the previous composition exactly.

### Productivity

#### `dsh-ui-shortcuts` — user-rebindable keyboard shortcuts

Three fixed actions, your keys: **pause the running turn** (`Esc` — same as the composer Stop), **steer-send the draft** (`Ctrl/Cmd+S`), **new session** (`Ctrl/Cmd+O`). Rebind in Settings → 通用 → 快捷键; preferences persist in `$DSH_HOME/settings.yaml`. The package also exposes a `ctx.shortcuts` registry so any plugin can contribute its own actions and get the settings row, rebinding, persistence, and conflict-free dispatch for free. All actions run through public services only.

> ⚠️ **Exclusive with the official shortcuts package.** This package shares the loader entry id `ui-shortcuts` with `@deepseek-ai/dsh-client-ui-shortcuts`; mounting both in one profile fails loud at boot on the duplicate id — keep exactly one. The official package was fork-grown, never published to npm, and removed from the harness when this package migrated in, so there is nothing to install and ours alone is always safe. Note the roles are reversed from what you might expect: **this package *provides* the `ctx.shortcuts` registry** that any plugin can register actions into — the official one had no contribution seam at all.

**Uninstall** — `dsh plugin --profile web remove @khorsheed/dsh-ui-shortcuts`; key bindings remain in `settings.yaml` (delete the `ui-shortcuts` section to clear them).

### Ops guard

#### `dsh-ankh-guard` — let the agent change its own code and restart without taking the service down

For self-hosting scenarios where an AI agent edits code and restarts the service on its own. One rule at the core: **prove the code is good before you allow a restart.**

- **Green-build credential gate** — after a green build + tests, record a credential bound to the current git commit (valid `maxAgeMinutes`, default 10). A restart request checks the credential exists, is fresh, and the HEAD still matches — broken builds never get a credential, so the restart is refused before it can hurt.
- **preflight composition gate** — after the credential, before anything is stopped, deep-dry-run the exact composition in a subprocess (the whole plugin tree boots through the same engine, then disposes; the web port pinned to 0 so it never collides). A composition that cannot boot means the running instance is never stopped.
- **watchdog, seamless restart** — a detached supervisor takes over the port when the instance exits, respawns it, runs the canary; on repeated boot failure it rolls back to the last known-good revision (healthy-boot stamp → checkpoint → credential HEAD), always leaving `guard-backup-*` recovery anchors, and stops at a crash page after four consecutive failures.
- **The restart report reaches the model by itself** — queued as the next turn via `agent.followup`; interrupted sessions are snapshotted at SIGTERM and resumed with a "continue" followup on the next boot.

Six-step protocol: `checkpoint` → modify → build+test → `record` → `verify` → restart + `canary`. The same surface is available as the `selfRestartGuard` service in-app.

Compatibility note: on the npm release line the composition-preflight gate degrades (it rides the fork's `dsh preflight` command); every other capability (restart/supervise gating, watchdog, rollback-to-known-good) stays fully intact.

**Uninstall** — `dsh plugin --profile web remove @khorsheed/dsh-ankh-guard`: the row and its CLI/service surface go away; guard state under `stateDir` (default `$DSH_HOME/state`) is kept by design — delete it for a clean slate. If the host image already mounts the `ankh-guard` row, don't add the profile row at all (duplicate entry id → boot fail); disable the duplicate instead.

## Compatibility with host lines

All packages declare `minHost: 0.1.0-rc.6` and touch only the official public stable surface (slots, core services, core events, cordis 4.x, schemastery):

- npm release line: ✅ full — the single exception is `dsh-ankh-guard`, ⚠️ degraded (composition-preflight gate depends on the fork's `dsh preflight`; without it the guard proceeds with a notice, everything else intact).
- source line (deepseek-harness master): ✅

## Model impact at a glance

| Plugin | Model context | Tokens | KV cache |
| --- | --- | --- | --- |
| message-tools (edit/withdraw) | Yes — surface replacement shadows the span | Removes the span's tokens, adds a minimal placeholder | Prefix invalidated from the replacement point (same as official compaction) |
| message-tools (restore) | Yes — tail replay | Adds replayable tokens | Tail extension only, no rewrite |
| local-agent delegation (child) | Independent child context | Child-side billing, never in the parent | Fully independent of the parent |
| everything else | No | No | No |

## Development

Standalone pnpm monorepo; every package publishes as `@khorsheed/dsh-*`.

```
packages/    one directory per publishable plugin
build/       shared build/test presets (tsdown client bundle, vitest source-plane config)
scripts/     repo tooling (pack-dist, gen-typert, sync-harness-paths)
```

```sh
pnpm install
pnpm run build      # pnpm -r --if-present run build
pnpm run test       # pnpm -r --if-present run test
pnpm run typecheck  # pnpm -r --if-present run typecheck
```

Tests must run through the root `pnpm test` or `pnpm --filter <pkg> test` — a bare `vitest run packages/xxx` bypasses the per-package vitest config (the source-plane alias preset) and fails with misleading resolution errors.

**Dev-time dependency on a harness checkout.** Three mechanisms resolve into a local deepseek-harness clone (env `DSH_HARNESS`, default `~/code/deepseek-harness`); the published npm artifacts alone cannot serve them:

- `scripts/gen-typert.mts` regenerates the `lib/typert.*` artifacts (message-tools, file-preview, local-agent) against the harness checkout, then copies them back with the `@khorsheed` self-name rewritten in.
- `build/vitest.ts` (the shared vitest preset) maps platform imports onto the harness's `tsconfig.base.json` paths — published packages ship no `src/` and their `/client` entries are loader-wrapped browser bundles that explode on a plain test import.
- `scripts/sync-harness-paths.mjs` writes taskpilot's gitignored `tsconfig.paths.json` for type resolution (npm release chain incomplete).

CI note: clone deepseek-harness next to this repo and point `DSH_HARNESS` at it before `pnpm test`; a stale harness checkout means the tested API surface may lag the production host. Publish via `scripts/pack-dist.ts` (`--family` rewrites scopes in peer deps) and verify the tarball before `npm publish`. Full repo conventions live in [AGENTS.md](AGENTS.md).
