# @khorsheed/dsh-basic

English | [中文](README.md)

One install brings the twelve plugins that make everyday dsh comfortable.

Making dsh comfortable used to mean picking through a dozen-plus community plugins and installing them one by one: sent messages could not be edited or withdrawn, you had to go hunting for the files the agent wrote, and nothing warned you when the context was about to fill up. With Basic Essentials installed, sent messages can be edited and withdrawn, a timeline on the left of the conversation jumps back to any message, the files the agent changed can be stepped through change by change in the sidebar, background jobs show above the composer where you can stop them, and it all works on a phone; the plugin inventory gains just one 「基础体验」 (Basic Essentials) card.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/basic-mode.png" width="640" alt="Basic Essentials at a glance: message edit and withdraw, quote actions, session artifacts and the file list in one screen">

## Features

- **Conversations you can fix** — sent messages can be edited and withdrawn (withdrawn content truly leaves the model context), a timeline along the left edge jumps back to any message you sent, and the title renames in place.
- **Select to quote** — select text in the conversation and the menu that pops up quotes it into the composer or copies it.
- **See what the agent touched** — files the agent wrote or edited preview in the sidebar, stepping through every change; any local directory can be browsed too, with HTML, Markdown, JSON, CSV and images previewed directly.
- **Background work stays visible** — background jobs and subagents show as pills above the composer and can be stopped at any time; a whale spouts while a task runs, and a chime plays when it finishes or gets blocked.
- **A reminder before the context fills up** — once occupancy crosses the ratio you set, a one-click compact reminder appears next to the composer.
- **Interactive cards in the conversation** — HTML the agent outputs renders inline in the conversation body as a sandboxed card.
- **Know what the instance has** — the capability catalog lists every skill and tool in the instance with where each was registered from.
- **Works on a phone** — mobile layout, a conversation home page and the iOS client bridge.
- **One card in the inventory** — the whole family folds into a single 「基础体验」 card; the detail page still lists every member, each with its own enable switch.

## Members

| Member | What it does |
| --- | --- |
| Message tools (`@khorsheed/dsh-client-message-tools`) | edit or withdraw sent messages; withdrawn content truly leaves the model context |
| Message timeline (`@khorsheed/dsh-message-timeline`) | a timeline along the conversation's left edge — jump back to any message you sent |
| Title edit (`@khorsheed/dsh-client-session-title-edit`) | rename the current session inline next to the chat title |
| Quote (`@khorsheed/dsh-quote`) | selected-text action menu: quote into the session or side chat, copy |
| Inline cards (`@khorsheed/dsh-inline-html-render`) | sandboxed interactive HTML cards inline in the conversation body |
| Context guard (`@khorsheed/dsh-context-guard`) | a one-click compact reminder in the composer once context occupancy crosses the set ratio |
| Background tasks (`@khorsheed/dsh-taskpilot`) | watch background jobs and subagents above the chat box, stop them any time |
| Session artifacts (`@khorsheed/dsh-file-preview`) | preview files the agent wrote or edited and step through every change |
| Local files (`@khorsheed/dsh-local-files`) | browse any local directory, previewing HTML, Markdown, JSON, CSV and images |
| Capability catalog (`@khorsheed/dsh-capability-catalog`) | list every skill and tool in the instance with its registration channel |
| Mobile (`@khorsheed/dsh-mobile`) | mobile layout, conversation home page and the iOS client bridge |
| Whalesong (`@khorsheed/dsh-whalesong`) | a whale spout animation while tasks run, chimes on completion or when blocked |

Not in this bundle: ankh-guard (`@khorsheed/dsh-ankh-guard`) and context-lens (`@khorsheed/dsh-context-lens`) moved to the dev suite on 2026-10-24 — the former only matters on a watchdog-guarded, self-modifying instance, the latter is a debugging view of how model requests are composed. The reader (`@khorsheed/dsh-reader`) ships with the learning and writing suites since 2026-10-19, and its rendered fetch (`@khorsheed/dsh-capture`) moved along with it on 2026-10-20. Sidechat (`@khorsheed/dsh-sidechat`) left the same day (never published with the bundle); ui-shortcuts (`@khorsheed/dsh-ui-shortcuts`) is retired — the host ships built-in shortcut settings since 0.1.7-rc.2.

## Install

Paste the package name `@khorsheed/dsh-basic` into the host's add-plugin dialog (or pick it from the marketplace index), confirm, and restart the instance — this one install brings all twelve members along as dependencies, and this package mounts them.

The CLI equivalent:

```sh
dsh plugin --profile web add @khorsheed/dsh-basic
```

```sh
dsh plugin --profile web remove @khorsheed/dsh-basic
```

Removing the bundle removes the whole family; to keep the family and turn off a single member, use the row-level switches on the bundle detail page.

For a scenario's capabilities (dev, writing, learning, video editing, game development, evaluation), install the matching suite on top of this package; each suite README's install section has a one-line command that installs it together with this one.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`): ✅ full — pure composition; the floor is the members' highest (minHost `0.1.5-rc.1`; some members floor lower). Individual member behavior differences above that floor are documented in each member's own Compatibility section.
- source line (deepseek-harness master): ✅ full (verifiedHost: 0.2.1-rc.1).

**Version-line map**: `0.1.0` and later require host `0.1.5-rc.1` and up.

## Known Limitations

- **Uninstall is family-wide** — removing this package removes every member together; there is no "drop one member from the bundle" operation. To disable a single member, use the row-level switches on the bundle detail page.
- **No mode** — this package is the everyday-experience collection and carries no agent preset; the modes (dev / writing / learning / video / gamedev / eval) come from the matching suites.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**A pure-composition meta-package.** The package registers no service, tool, slot, or command. Every row in `cordis.patch.yml` comes from the matching member package's own `cordis.patch.yml`, id and name verbatim:

| Member package | Row id |
| --- | --- |
| `@khorsheed/dsh-client-message-tools` | `message-tools` |
| `@khorsheed/dsh-message-timeline` | `message-timeline` |
| `@khorsheed/dsh-client-session-title-edit` | `session-title-edit` |
| `@khorsheed/dsh-quote` | `quote` |
| `@khorsheed/dsh-inline-html-render` | `inline-html-render` |
| `@khorsheed/dsh-context-guard` | `context-guard` |
| `@khorsheed/dsh-taskpilot` | `taskpilot` |
| `@khorsheed/dsh-file-preview` | `file-preview` |
| `@khorsheed/dsh-local-files` | `local-files` |
| `@khorsheed/dsh-capability-catalog` | `capability-catalog` |
| `@khorsheed/dsh-mobile` | `mobile` |
| `@khorsheed/dsh-whalesong` | `whalesong` |

The repo-level check:plugins `dsh.bundle.kind: 'family'` sanction pins this mechanically: rows may only come from the allowlist of the members' canonical rows, every member must be a real self-mounting package, and every member must contribute at least one row. The single 「基础体验」 card in the inventory comes from this package's locale card metadata.

**Installing me = installing the family, never a double mount.** Every member is listed in `dependencies` (installing brings them all) and registered in `dsh.references` (the family roster read at pack time and by the catalog layer). Mechanism: `dsh plugin add` reconciles only the profile's **direct** dependencies into the bundles layer (`reconcilePlugins`) — installing this bundle applies **this** patch only; the members arrive as transitive dependencies and their own patches are not applied, so no row is ever mounted twice. A member installed on its own with `dsh plugin add` still self-mounts (the repo rule holds); when both are installed, the official bundle detail page's row-level switches resolve the overlap.

**`src/index.ts` exports constants only** (`FAMILY_MEMBERS`), so the package has a buildable `lib/` (a hard requirement of pack-dist).

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/basic`). Issues and contributions go there.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
