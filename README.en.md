# dsh-plugins

English | [中文](README.md)

The community plugin monorepo for the **dsh** (DeepSeek Harness) ecosystem: **43 purely additive plugin packages, 33 of them published on npm**. Every package integrates through official extension points only — slots, commands, Remote services, session projections. No official package is modified, no official UI slot is replaced, no core service is hacked; when an optional capability is absent the plugin degrades silently instead of failing the boot. The whole set is designed for coexistence: install, uninstall, or toggle any combination without interference, and the production instance runs the full stack long-term.

> This page lists only **published** packages. Package counts, shapes, and profile membership follow the machine-generated [authoritative package map](docs/packages.md); per-package versions and the host-compatibility matrix follow the [release status](docs/release-status.md) (regenerated after every publish wave). The repository is also the development workspace — see [Development](#development).

## Profile packs: three ready-to-run experiences

The default install unit is a complete profile (a pack), not a single package. Its `dependencies` decide which packages get installed and its `dsh.profile.bundles` decides which self-mounting rows get activated:

| Pack | What it is | Members |
| --- | --- | --- |
| [dsh-web-basic](https://github.com/Khorsheed/dsh-web-basic) | **Everyday mode**: message control, artifact preview, task status, shortcuts, and the ops guard | 10 |
| [dsh-web-dev](https://github.com/Khorsheed/dsh-web-dev) | **Development**: everything in basic, plus delegation to local coding agents, live worktree state, and room multi-agent collaboration — ships the "dev mode" preset | 23 |
| [web-eval](profiles/web-eval) (in this repo) | **Evaluation**: a factorial experiment bench — datasets, conditions, and plans reviewed in git, deterministic orchestration — ships the "eval mode" preset | 26 |

The first two are standalone repositories: clone, run two scripts, and the running instance hands over on the same port — see their READMEs. Single-package install is the advanced path; see [Install](#install).

## Capability map

Each package's full feature list, configuration, and screenshots live in its own directory README (follow the directory link). The "Ships with" column says which pack installs it by default; packages marked "standalone" are installed individually with `dsh plugin add`.

### Conversation control

| Package | What you get | Ships with |
| --- | --- | --- |
| [`message-tools`](packages/message-tools) | **In-place edit / true withdraw / restore** for user messages — the only plugin here that changes what the model sees, using the same mechanism as official compaction | basic + dev |
| [`message-timeline`](packages/message-timeline) | A floating **message timeline** on the conversation's left edge; click to jump to any user message | basic + dev |
| [`session-title-edit`](packages/session-title-edit) | **Inline rename** of the session title in the chat header; user-set titles are pinned against auto-generation | basic + dev |
| [`quote`](packages/quote) | Select any text for a floating **quote action menu** (quote into the composer / side chat / copy); other plugins can register their own actions | standalone |

### Files and artifacts

| Package | What you get | Ships with |
| --- | --- | --- |
| [`file-preview`](packages/file-preview) | A read-only host-side **file-preview Remote service**: the files a session touched, current contents, per-change diffs | basic + dev |
| [`ui-file-preview`](packages/ui-file-preview) | The session "**Artifacts**" tab, per-turn change cards, and a file-preview drawer (installs paired with the row above) | basic + dev |
| [`local-files`](packages/local-files) | A **local file browser** in the right sidebar: lazy file tree plus structured HTML/Markdown/JSON/CSV/image previews | dev |
| [`ui-content-preview`](packages/ui-content-preview) | (composition component) The shared **content-preview kernel** for community file surfaces, inlined at the source plane into each client bundle | inlined by its hosts |

### Development collaboration

| Package | What you get | Ships with |
| --- | --- | --- |
| [`worktrees`](packages/worktrees) | A per-session **repo/worktree badge** in the session header plus a change drawer: uncommitted/committed file trees, diffs, commit history | dev |
| [`worktrees-tool`](packages/worktrees-tool) | (companion tool row) The worktrees **model tool**, granted per session by a preset | dev |

### Local multi-agent

Delegate subtasks to coding-agent CLIs installed on your machine — each with its own context, its own accounting, and cross-turn resume. Every harness runs under its own scoped home (`$DSH_HOME/local-agent/<name>`, mode 0700) and **never touches the private config and credentials in your user directory**.

| Package | What you get | Ships with |
| --- | --- | --- |
| [`local-agent`](packages/local-agent) | The family **core**: harness registry, scoped-home provisioning, the `/<harness> login|sessions|status|logout` command family | dev |
| [`local-agent-kimi`](packages/local-agent-kimi) | **Kimi Code** harness: `kimi -p` delegation, resume, accounting | dev |
| [`local-agent-codex`](packages/local-agent-codex) | **Codex** harness: `codex exec` delegation, resume, accounting | dev |
| [`local-agent-claude-code`](packages/local-agent-claude-code) | **Claude Code** harness: `claude -p` delegation, resume, accounting | dev |
| [`local-agent-dsh`](packages/local-agent-dsh) | **dsh self-delegation** harness: use dsh itself as a local CLI | dev |
| [`local-agent-dsh-headless`](packages/local-agent-dsh-headless) | (composition component) The **headless sub-profile** patch for dsh delegation | mounted by its provider |
| [`local-agent-tool-subagent`](packages/local-agent-tool-subagent) | (composition component) The family's shared **delegation tool row**, with a `resume` parameter | dev |

### Multi-agent collaboration

| Package | What you get | Ships with |
| --- | --- | --- |
| [`room`](packages/room) | **Room conversations**: invite several agents into one session — member roster tab, @ dispatch, task board, notification gate | dev |
| [`room-tool`](packages/room-tool) | (companion tool row) `room_invite / room_task / room_message`, granted per session by a preset | dev |

### Tasks and ambience

| Package | What you get | Ships with |
| --- | --- | --- |
| [`taskpilot`](packages/taskpilot) | **Background-task / sub-agent pills** above the composer: live timers, stop/interrupt, and a detail drawer replaying the execution trace | basic + dev |
| [`context-guard`](packages/context-guard) | A **one-click compact reminder** on the composer once context usage crosses your configured threshold | basic + dev |
| [`whalesong`](packages/whalesong) | Task ambience: the whale spouts, the favicon animates, completion/blocking chimes (auto-muted under `prefers-reduced-motion`) | basic + dev |

### Experience and efficiency

| Package | What you get | Ships with |
| --- | --- | --- |
| [`ui-shortcuts`](packages/ui-shortcuts) | **Rebindable shortcuts** (pause / steer-send / new session) plus a `ctx.shortcuts` action registry any plugin can register into | basic + dev |
| [`inline-html-render`](packages/inline-html-render) | Renders agent-authored ```` ```dsh-card ```` HTML as **sandboxed interactive cards** inline in the conversation | dev |
| [`dsh-reader`](packages/dsh-reader) | A **link reader** tab: RSS/Atom subscriptions plus pasted article links, a card feed with a readable detail view | standalone |
| [`mobile`](packages/mobile) | **Mobile presentation** and an iOS bridge | standalone |

### Capability and infrastructure

| Package | What you get | Ships with |
| --- | --- | --- |
| [`capability-catalog`](packages/capability-catalog) | A **capability catalog**: every skill and tool in the running instance with its registration channel, a three-column settings grid with detail modals | dev |
| [`typesafe`](packages/typesafe) | **TypeSafe decision primitives** as a host service: typed noul/choice/score judgements with circuit breaker, cache, and decision logs | standalone |
| [`typesafe-tool`](packages/typesafe-tool) | (companion tool row) The typesafe model tool, granted per session by a preset | standalone |
| [`capture`](packages/capture) | A **rendered-fetch** Remote: a managed headless Chrome renders a URL and returns the serialized page with styles inlined | standalone |

### Operations guard

| Package | What you get | Ships with |
| --- | --- | --- |
| [`ankh-guard`](packages/ankh-guard) | A **safety gate for self-modification restarts**: a green-build credential bound to the git HEAD, a composition preflight, and watchdog rollback — let the AI change its own code and restart itself without taking the service down | basic + dev |

### One-command family bundles

If you'd rather not pick packages one by one, install a whole family in one command:

| Package | Contents |
| --- | --- |
| [`bundle-conversation-toolbox`](packages/bundle-conversation-toolbox) | The conversation toolbox: message-tools, message-timeline, session-title-edit, quote, inline-html-render, context-guard, taskpilot |
| [`bundle-local-agent`](packages/bundle-local-agent) | Local multi-agent: the local-agent core plus the kimi / codex / claude-code / dsh providers |

## Agent preset design

The packs deliver more than plugins — they ship **per-session-granted agent presets**. Three design rules:

1. **Tools are granted per session.** Model tool rows never mount at the profile root: each tool surface splits into a core (global service/UI) plus a companion `-tool` package (the model tool row only), and a preset composition references the companion row by name — a session gets the tool set exactly when it runs on that preset, and every other session's tool surface stays clean. With the companion's core absent the row stays pending and never crashes the host.
2. **UI hides itself with the grant.** Surfaces whose content binds to the session (session tabs, header badges) show or hide with the preset grant — a session that was never granted the preset never sees the entry point. Cross-session deployment surfaces get no runtime switch: whether they exist is the profile's install-layer decision. The full convention lives in [docs/plugin-visibility.md](docs/plugin-visibility.md).
3. **Purely additive declarations.** Each preset re-bases verbatim on the official "standard mode" composition and only appends community tool rows at the end — no official row is modified.

The three community presets:

| Preset | What it is | Community tools granted | Delivered by |
| --- | --- | --- | --- |
| **Dev mode** (dev) | Everything in the official standard mode, plus local delegation, live git state, and room collaboration | `subagent_kimi / subagent_codex / subagent_claude_code`, `worktrees`, `room_invite / room_task / room_message` | installs with [dsh-web-dev](https://github.com/Khorsheed/dsh-web-dev) |
| **Eval mode** (dsh-eval) | A read-only + delegation eval composition — no shell, no workflows | dataset authoring tools, eval execution tools | ships with the in-repo [profiles/web-eval](profiles/web-eval) |
| **Writing mode** (dsh-writing) | A writing flow including the canvas agent row | `canvas/agent` | ships with the in-repo [profiles/web](profiles/web) |

> The preset delivery mechanism moves with the host line: on the 0.1.5 line the packs install directory-style presets (`$DSH_HOME/.agent-presets/<id>/`); from 0.1.7-rc.1 presets become declarative bundle rows ([`packages/presets`](packages/presets) in this repo, to be published in the next wave). A preset that references a companion module which is not installed stays on the roster with a diagnostic and does not affect the other presets.

## Compatibility promise

The whole set is designed for coexistence: row ids, UI seats, events, and namespaces never overlap. One exception to spell out: images that already carry an `ankh-guard` row (historical forks) must not add the package again — a duplicate row id fails the boot. See the [ankh-guard README](packages/ankh-guard/README.md).

On the npm release line every package is fully functional, with one exception: ankh-guard's composition preflight gate degrades to warn-and-pass on a pure npm deployment (no harness checkout), while everything else stays complete. On the source line (deepseek-harness master) everything is complete. Per-package `minHost` ranges from 0.1.2-rc.1 to 0.1.5-rc.1 — see the [release status](docs/release-status.md) for the per-package matrix; hosts ≤ 0.1.1-rc.2 should stay on each package's 0.1.x release line.

## Model-impact summary

| Plugin | Model context | Tokens | KV cache |
| --- | --- | --- | --- |
| message-tools (edit/withdraw) | Yes — a surface replacement masks the range | Range tokens removed, small placeholders added | Prefix invalidated from the replacement point (same trade-off as official compaction) |
| message-tools (restore) | Yes — tail replay | Replayable tokens added | Tail extension only, no rewrite |
| local-agent delegation (sub-session) | Independent child context | Billed independently in the child, never enters the parent | Independent of the parent |
| All other plugins | None | None | None |

## Install

Prerequisite: a dsh host (per-package version requirements are in each package README's Compatibility section). **The recommended path is a profile pack** (see [Profile packs](#profile-packs-three-ready-to-run-experiences) above); single-package install is the advanced path for trimming or debugging.

On host ≥ 0.1.7-rc.2, single-package install needs no command line: **Settings → Plugins → Add plugin**, enter the npm package name (e.g. `@khorsheed/dsh-whalesong`), then enable/restart as prompted. Note that this entry installs **single plugin packages only** — pasting this monorepo's or a pack repo's GitHub URL is rejected and rolled back (the official installer only takes the package at a repository root and does not reach into subdirectories); for a pack, use its repo's install scripts.

```sh
# Install one package by npm name (self-mounting packages mount their own loader row — no hand-editing of cordis.yml)
dsh plugin --profile web add @khorsheed/dsh-whalesong

# Install a whole family in one command (meta packages)
dsh plugin --profile web add @khorsheed/dsh-bundle-conversation-toolbox
dsh plugin --profile web add @khorsheed/dsh-bundle-local-agent

# Installing local-agent pieces individually: the core and each harness go in explicitly together
dsh plugin --profile web add @khorsheed/dsh-local-agent
dsh plugin --profile web add @khorsheed/dsh-local-agent-kimi   # or -codex / -claude-code / -dsh
```

Restart the web instance afterwards. Composition-component packages (`*-tool`, `local-agent-dsh-headless`, `ui-content-preview`) are not mounted by `dsh plugin add` — they land through a profile's preset rows or a provider patch; see the [authoritative package map](docs/packages.md) for the full topology.

## Uninstall

```sh
dsh plugin --profile web remove @khorsheed/dsh-<name>
```

General rules:

- **Uninstalling restores exactly.** No plugin modifies or replaces official files, so removing one returns the composition to precisely its previous state.
- **User data is deliberately kept.** The local-agent family keeps each harness's scoped directory (`$DSH_HOME/local-agent/<name>`) so a reinstall needs no fresh login; ankh-guard keeps the state under its `stateDir` (credentials, restart records, interrupted-session snapshots); ui-shortcuts keybindings stay in `$DSH_HOME/settings.yaml`. No uninstall touches session logs — the audit trail of edits and withdrawals staying in the log is intentional.
- **Family rows follow.** Remove the local-agent core while harnesses are still installed and the harness rows stay **pending, never crashing** — reinstalling the core restores them.
- **`enabled: false`** disables a row without uninstalling — a deployment-layer operation, not a code change.

## Development

A standalone pnpm monorepo; every package publishes as `@khorsheed/dsh-*`.

```
packages/   one directory per publishable plugin
profiles/   the packs (web-basic / web-dev / web-eval and the production web)
build/      shared build/test presets (tsdown client bundle, vitest source-plane config)
scripts/    repo tooling (pack-dist, gen-typert, mirror sync, gate checkers)
```

```sh
pnpm install
pnpm run build      # pnpm -r --if-present run build
pnpm run test       # pnpm -r --if-present run test
pnpm run typecheck  # pnpm -r --if-present run typecheck
```

Tests must run through the root `pnpm test` or `pnpm --filter <pkg> test` — bare `vitest run packages/xxx` bypasses each package's vitest config (the source-plane alias preset) and fails with misleading resolution errors.

**The dev-time dependency on a harness checkout.** Two mechanisms resolve against a local deepseek-harness clone (env `DSH_HARNESS`, default `~/code/deepseek-harness`) that the published npm artifacts alone cannot satisfy:

- `scripts/gen-typert.mts` regenerates the `lib/typert.*` artifacts (for packages with `./typert`/`./remote` exports) against the harness checkout; full builds are freshness-cached and only regenerate when inputs or outputs change (`GEN_TYPERT_FORCE=1` forces).
- `build/vitest.ts` (the shared vitest preset) maps platform imports onto the harness's `tsconfig.base.json` paths — published packages carry no `src/`, and their `/client` entry is a loader-wrapped browser bundle that explodes under a bare import.

CI note: clone deepseek-harness next to this repo and set `DSH_HARNESS` before `pnpm test`; a stale harness checkout means the API surface under test may lag the production host. Publishing goes through `scripts/pack-dist.ts` (`--family` rewrites peer-dependency scopes); verify the tarball before `npm publish`. The full repository discipline lives in [AGENTS.md](AGENTS.md).
