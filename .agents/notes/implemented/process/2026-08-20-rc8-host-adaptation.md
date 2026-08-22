# Agent Note: rc.8 host adaptation — commands/execute images + renderMessageImages

Status: implemented

English | [中文](2026-08-20-rc8-host-adaptation.zh.md)

## Problem

`deepseek-harness` released `0.1.0-rc.8` (2026-08-19). Unlike the additive rc.7 line, rc.8 carries two breaking changes that land squarely on this repo's plugins:

1. **`commands/execute` gained a required `images` parameter** — host service `execute(agent, line, signal?)` became `execute(agent, line, images, signal?)`, and the typert remote mirrors it, so every `ctx.remote.commands.execute(sessionId, line)` call would pass shifted arguments against an rc.8 host.
2. **Chat-node owner props dropped `loadImage` for the required `renderMessageImages`** — attachment rendering moved behind the `conversation.message.images` slot; occupants of `conversation.chat.node` keys (message-tools shadows the official `user`/`steering` renderers) must call the owner-prop renderer instead of importing `dsh-client-ui-attachment` directly.

Everything else the repo consumes is unchanged or additive (cordis 4.0.1 identical; slot names only gained `conversation.message.images` / `conversation.input.attachments` / `conversation.hero.brand.mark`; `ctx.subagents.start` and the descriptor contract untouched; `dsh-session` added optional `interrupted?: true` on `assistant/message`; `dsh-subagent` renamed report-delivery `'wakeup'` → `'next-step'`, unused here).

## Decision

- **Four packages adapted, six call/render sites**: context-guard (`/compact` action), local-agent (settings login/logout/preset commands) and taskpilot (stop/interrupt verbs) pass `[]` as the new `images` argument; message-tools' `UserMessageView` renders historical images through the owner-prop `renderMessageImages({ images, align: 'end' })`, dropping the `dsh-client-ui-attachment` import (and its peer/dev dependency) and the plugin-local `image.*` locale keys the old gallery consumed. Tests updated to the new contracts.
- **`dsh.compat.minHost` is `0.1.0-rc.8` for exactly those four packages** — minHost is the verified floor (per the rc.7 sync note), and for these four the floor genuinely moved: their current builds misbehave on rc.6/rc.7 hosts. The other packages keep `0.1.0-rc.6` (the rc.7→rc.8 audit shows their consumed surfaces unchanged or additive).
- **Dev-time baseline moved to rc.8**: every package's `@deepseek-ai/dsh-*` devDependencies resolve `^0.1.0-rc.8` (`dsh-client-web-react` stays — it has no rc.8); peer ranges keep the wide `^0.1.0-rc.6` line per convention; the lockfile was refreshed (151 rc.8 packages, zero pre-rc.8 second copies). **The `minimumReleaseAgeExclude` list in `pnpm-workspace.yaml` must move with the host line**: the adaptation initially bumped the lockfile without rewriting the rc.7-era exclusion list, and every rc.8 package then fell inside the supply-chain policy's publish-age window — the main checkout could not `pnpm install` at all until the list was rewritten to the lockfile's actual 75 rc.8 records (`3a5e07d`, the same move `3743226` made for rc.7). Any future host-line bump includes this step.
- **Deployment checkout** (`~/code/deepseek-harness`): same procedure as rc.7 — guard checkpoint, backup branch `deploy-pre-rc8`, hard-reset to the upstream rc.8 release merge, watchdog restart via `schedule-exit` with the preflight gate. taskpilot compiles its types from this checkout (`scripts/sync-harness-paths.mjs`), so its build went green only after the reset.
- **Vanilla instance** (`~/.dsh-vanilla/toolchain`): npm-installed `@deepseek-ai/dsh@0.1.0-rc.8`, serving the plugin-free rc.8 baseline on 3081.
- **README Compatibility sections** re-labeled to the rc.8 line in all 17 established packages (en+zh, sidecars re-recorded); the three local-agent-family READMEs that lacked the section gained it. New in-tree packages from other agents (datasets, mission, lab) were left to their owners.

## Alternatives considered

- **One build straddling rc.7 and rc.8** — rejected: the new `images` parameter is positional and required, and `renderMessageImages` replaces a removed prop, so no single call shape is correct on both lines; the repo tracks the host line and labels the floor honestly instead.
- **Bump peer ranges to `^0.1.0-rc.8`** — rejected per the rc.7 note: peer ranges are a compatibility envelope, not the current line; `dsh.compat.minHost` carries the floor.
- **Keep `image.*` locale keys / the ui-attachment dependency for a future gallery** — rejected: dead weight after the migration; the rc.8 attachment-slot occupant owns image presentation including labels.

## Consequences

- rc.8 is the development baseline: fresh installs resolve rc.8 types, the four adapted packages declare it as their floor, and both local instances (prod on 3080, vanilla on 3081) serve rc.8.
- message-tools' prod `file:` tarball was repacked from the adapted build (same 0.4.9 line, profile reference unchanged).
- gen-typert crashed once in the new type environment on a stale overlay (`Remote boundary contains non-JSON type undefined` at file-preview); the first clean regeneration refreshed the overlay and the failure did not recur — noted here because it looks alarming mid-upgrade and is self-healing.
- ankh-guard's degraded preflight item stays degraded: rc.8 still does not export `composeProfile`.
- The official `@deepseek-ai/dsh-subagent-codex` / `dsh-subagent-claude-code` bundles (optional, not mounted by dsh-base) overlap the local-agent family only in one-shot delegation; the family's scoped homes, cross-round resume, session records, and settings UI remain differentiators, and the provider/tool names do not collide.
- **Stale-tree gotcha when moving old harness checkouts to a new host line**: `git reset --hard` removes tracked files only, so directories of packages deleted or migrated out in the new line survive as `node_modules`/`lib` remnants. tsdown's workspace enumeration is a directory glob (`packages/*/*`), so each remnant becomes a phantom "package" (named after the root package by config fallback); a remnant without built `lib/types` aborts the whole build with `Cannot find entry`. The deploy checkout carried 13 phantoms (migrated community plugins, retired `web-react`/`schema-form`), the mirror 2 — both cleaned. Any future checkout update should sweep `packages/*/*` dirs lacking a `package.json` before building.
- Follow-up (2026-08-20): the adaptation edited local-agent's sources but missed its tests — `local-agent.spec.ts` still called `commands.execute` with the rc.7 arity (17 failures), and the client locale spec assumed zh as the default locale while rc.8 resolves the initial locale from the browser (jsdom reports en-US). Fixed: tests pass `[]` for images, and the locale spec pins zh explicitly via `setLocale('zh')`. Sweep lesson: after a host-line bump, run the full suite per package, not only the packages whose sources changed.
- Follow-up 2 (2026-08-20): the dev-baseline sweep missed the `^0.1.0-rc.6` devDependency specifiers — pnpm never re-resolves satisfied ranges, so several packages kept rc.7 resolutions in the lockfile, and where two type identities of one package met in a single compilation (e.g. local-agent-codex's own dsh-commands import vs the family core's), tsc failed with private-property duplicate-identity errors. Fixed for the local-agent family (kimi/codex/claude-code: dsh-commands + dsh-session; dsh-headless: dsh-cmdline + dsh-code-runtime-worker-thread + dsh-mcp-client). Still stale at this writing, owned by their respective lines: context-guard, datasets, lab, mission, taskpilot, ui-shortcuts.
