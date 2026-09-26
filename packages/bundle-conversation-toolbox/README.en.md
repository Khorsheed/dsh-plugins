# @khorsheed/dsh-bundle-conversation-toolbox

English | [中文](README.md)

One command, seven session-experience plugins installed — message edit/withdraw, timeline jump-back, session-title rename, quote-anything, inline HTML cards, context-occupancy reminder, and background-task controls.

Each member installs fine on its own — but then the plugin list scatters them across seven cards. This family bundle folds their canonical rows into one "Conversation Toolbox" card: a single `dsh plugin add` installs the whole family, and the plugin list manages them as one card. A thin meta package — a patch inserting the members' canonical rows, npm dependencies that bring the members along, and locale card metadata — with **no runtime code and no client half of its own** (pure composition: it registers no service, tool, slot, or command).

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/bundle-conversation-toolbox-card.png" width="640" alt="the Conversation Toolbox bundle card in the plugin list: one card grouping the seven session-experience plugin rows">

## Features

- **One command installs all seven** — every member is an npm `dependency`, so installing this bundle brings the whole family along; no per-package installs.
- **Family grouping in the plugin list** — the seven rows fold into one "Conversation Toolbox" bundle card; the card title and description follow the host language (`locale/zh.json` / `locale/en.json`).
- **No double-mounting** — installing this bundle applies THIS patch only; members arrive as transitive dependencies and their own patches stay inert, so no row ever mounts twice (mechanism under How it works).
- **Member behavior unchanged** — each member's features, config, and session-level visibility (preset self-hide) criteria are exactly as when installed standalone; this bundle neither adds nor removes any. Details live in each member's own README.

## Members

| member package | row id | what it adds |
| --- | --- | --- |
| `@khorsheed/dsh-client-message-tools` | `message-tools` | copy, edit-in-place, and real withdrawal (out of the model context, restorable) for sent messages |
| `@khorsheed/dsh-message-timeline` | `message-timeline` | a floating timeline over the conversation scrollport — jump back to any user message |
| `@khorsheed/dsh-client-session-title-edit` | `session-title-edit` | inline session-title rename in the chat header (a user-set title pins against automatic regeneration) |
| `@khorsheed/dsh-quote` | `quote` | select any text for an action menu: quote into the current session / a side chat (self-hides when sidechat is absent), copy |
| `@khorsheed/dsh-inline-html-render` | `inline-html-render` | renders agent-authored `dsh-card` fenced blocks as sandboxed interactive cards inline in the conversation |
| `@khorsheed/dsh-context-guard` | `context-guard` | a compaction-reminder button in the composer once context occupancy crosses a threshold, plus a settings card |
| `@khorsheed/dsh-taskpilot` | `taskpilot` | dock pills above the composer for background jobs and subagents: stop/interrupt, live duration and tokens, detail sidebar |

## Install

```sh
dsh plugin --profile web add @khorsheed/dsh-bundle-conversation-toolbox
```

Restart the web instance to activate. Once mounted, all seven rows are in place; each plugin's browser half is discovered through its own package's `dsh.client` declaration.

```sh
dsh plugin --profile web remove @khorsheed/dsh-bundle-conversation-toolbox
```

Removal takes the seven rows back out of the composition (the members' own patches were never applied — nothing left behind).

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`): ✅ full — pure composition; the floor is the members' highest (minHost `0.1.5-rc.1`, from message-tools / quote / taskpilot; the rest floor at `0.1.2-rc.1`). Member-level degraded items on this line (e.g. quote's side-chat route probing) are documented in each member's own Compatibility section.
- source line (deepseek-harness master): ✅ full (verifiedHost: 0.1.7-rc.1).

**Version line mapping**: `0.1.0` and later require host `0.1.5-rc.1` and up.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**Shape: a composition-only meta package.**

- **The patch reuses the members' canonical rows verbatim**: each of the seven rows in `cordis.patch.yml` comes from the corresponding member's own `cordis.patch.yml`, id and name unchanged. The repo-wide check:plugins `dsh.bundle.kind: 'family'` sanction pins this mechanically — rows may only come from the allowlist union of member canonical rows, members must be real self-mounting packages, and every member must contribute at least one row (the specs in this package's `tests/` re-verify it row by row).
- **Installing the family without double-mounting**: all members are listed in `dependencies` (installation brings them along) and registered in `dsh.references` (the family roster, read by pack-time and catalog checks). The mechanism: `dsh plugin add` reconciles only the profile's *direct* dependencies into the bundles layer (`reconcilePlugins`) — installing this bundle applies THIS patch only; members arrive as transitive dependencies and their own patches stay inert, so no row ever mounts twice. A member installed directly still self-mounts (the repo rule is unbroken); any row overlap from installing both is resolved by the row-level switches on the official bundle detail page.
- **`src/index.ts` exports only constants** (`FAMILY_MEMBERS`) so the package has a buildable `lib/` (a pack-dist requirement); `locale/*.json` carries only the bundle card's `meta.title` / `meta.description`.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/bundle-conversation-toolbox`). Issues and contributions welcome there.
