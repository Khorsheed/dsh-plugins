# @khorsheed/dsh-basic

English | [中文](README.md)

The everyday dsh experience in one install: message tools, session artifacts, local files, context guards, mobile — a single 「基础体验」 card in the inventory instead of fourteen packages to pick one by one.

## Features

- **The whole family in one install** — message tools, message timeline, title edit, quote, inline cards, context guard, background tasks, session artifacts, local files, capability catalog, mobile, whalesong, ankh-guard and context-lens, all from a single install. The reader (`@khorsheed/dsh-reader`) ships with the learning and writing modes since 2026-10-19, not in this bundle; so does its rendered fetch (`@khorsheed/dsh-capture`) since 2026-10-20. Sidechat (`@khorsheed/dsh-sidechat`) left the same day (never published with the bundle); ui-shortcuts (`@khorsheed/dsh-ui-shortcuts`) is retired — the host ships built-in shortcut settings since 0.1.7-rc.2.
- **One card in the inventory** — locale card metadata folds the family into a single 「基础体验」 card; the detail page still lists every member row with its own enable switch.
- **Pure composition, zero runtime** — the package registers no service, tool, slot, or command of its own; the patch reuses the members' canonical rows verbatim and never double-mounts (mechanism in How it works below).

## Members

| member package | row id | contents |
| --- | --- | --- |
| `@khorsheed/dsh-client-message-tools` | `message-tools` | edit or withdraw sent messages; withdrawal truly leaves the model context |
| `@khorsheed/dsh-message-timeline` | `message-timeline` | a conversation timeline — jump back to any of your messages |
| `@khorsheed/dsh-client-session-title-edit` | `session-title-edit` | rename the current session inline from the chat header |
| `@khorsheed/dsh-quote` | `quote` | selected-text action menu: quote into the session or side chat, copy |
| `@khorsheed/dsh-inline-html-render` | `inline-html-render` | sandboxed interactive HTML cards inline in the conversation |
| `@khorsheed/dsh-context-guard` | `context-guard` | a composer compact button once context occupancy crosses the threshold |
| `@khorsheed/dsh-taskpilot` | `taskpilot` | watch and stop background jobs and subagents from dock pills |
| `@khorsheed/dsh-file-preview` | `file-preview` | preview files the agent wrote or edited and step through every change |
| `@khorsheed/dsh-local-files` | `local-files` | browse any local directory with structured previews |
| `@khorsheed/dsh-capability-catalog` | `capability-catalog` | enumerate every skill and tool with its registration channel |
| `@khorsheed/dsh-mobile` | `mobile` | mobile layout, conversation library and the iOS bridge |
| `@khorsheed/dsh-whalesong` | `whalesong` | whale spout animation with completion and blocked chimes |
| `@khorsheed/dsh-ankh-guard` | `ankh-guard` | gate self-modification restarts on a green build and test credential |
| `@khorsheed/dsh-context-lens` | `context-lens` | per-turn structured breakdown of every model request: sections, tools, tokens, timing |

## Install

Paste the package name `@khorsheed/dsh-basic` into the host's add-plugin dialog (or pick it from the marketplace index), confirm, and restart the instance — installing this one package brings all fourteen members along as dependencies, and this bundle's patch mounts their rows.

The CLI equivalent:

```sh
dsh plugin --profile web add @khorsheed/dsh-basic
```

```sh
dsh plugin --profile web remove @khorsheed/dsh-basic
```

Removing the bundle removes the whole family; to keep the family and disable a single row, use the row-level switches on the bundle detail page.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`): ✅ full — pure composition; the floor is the members' highest (minHost `0.1.5-rc.1`; several members floor lower). Per-member behavior differences above that floor are documented in each member's own Compatibility section.
- source line (deepseek-harness master): ✅ full (verifiedHost: 0.2.1-rc.1).

**Version-line map**: `0.1.0` and later require host `0.1.5-rc.1` and up.

## Known Limitations

- **Removal is all-or-nothing** — removing this package removes every member along with it; there is no "drop one member from the bundle" — disable single rows via the row-level switches on the bundle detail page.
- **No mode preset** — this bundle is the basic-experience collection and carries no `@deepseek-ai/dsh-agent-preset` row; the modes (dev / writing / learning / video / gamedev) ship as the corresponding `@khorsheed/dsh-<mode>` mode bundles.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**A composition-only meta package.** Every row in `cordis.patch.yml` comes verbatim from the corresponding member's own `cordis.patch.yml`, id and name unchanged. The repo-wide check:plugins `dsh.bundle.kind: 'family'` sanction pins this mechanically: rows may only come from the allowlist union of member canonical rows, members must be real self-mounting packages, and every member must contribute at least one row.

**Installing me installs the family — without double-mounting.** All members are listed in `dependencies` (installation brings them along) and registered in `dsh.references` (the family roster, read by pack-time and catalog checks). The mechanism: `dsh plugin add` reconciles only the profile's *direct* dependencies into the bundles layer (`reconcilePlugins`) — installing this bundle applies THIS patch only; members arrive as transitive dependencies and their own patches stay inert, so no row ever mounts twice. A member installed directly still self-mounts (the repo rule is unbroken); any row overlap from installing both is resolved by the row-level switches on the official bundle detail page.

**`src/index.ts` exports only constants** (`FAMILY_MEMBERS`) so the package has a buildable `lib/` (a pack-dist requirement).

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/basic`). Issues and contributions welcome there.
