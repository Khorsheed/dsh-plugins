# @khorsheed/dsh-bundle-conversation-toolbox

English | [中文](README.md)

The family bundle "Conversation Toolbox": seven session-experience plugins — message-tools, message-timeline, session-title-edit, quote, inline-html-render, context-guard, taskpilot — in one install. A thin meta package — a patch inserting the members' canonical rows, npm dependencies that bring the members along, and locale card metadata — **with no runtime code and no client half of its own** (pure composition: it registers no service, tool, slot, or command).

## Shape: a composition-only meta package

- **The patch reuses the members' canonical rows verbatim**: each of the seven rows in `cordis.patch.yml` comes from the corresponding member's own `cordis.patch.yml`, id and name unchanged. The repo-wide check:plugins `dsh.bundle.kind: 'family'` sanction pins this mechanically: rows may only come from the allowlist union of member canonical rows, members must be real self-mounting packages, and every member must contribute at least one row.
- **Installing me installs the family — without double-mounting**: all members are listed in `dependencies` (installation brings them along) and registered in `dsh.references` (the family roster, read by pack-time and catalog checks). The mechanism: `dsh plugin add` reconciles only the profile's *direct* dependencies into the bundles layer (`reconcilePlugins`) — installing this bundle applies THIS patch only; members arrive as transitive dependencies and their own patches stay inert, so no row ever mounts twice. A member installed directly still self-mounts (the repo rule is unbroken); any row overlap from installing both is resolved by the row-level switches on the official bundle detail page.
- **`src/index.ts` exports only constants** (`FAMILY_MEMBERS`) so the package has a buildable `lib/` (a pack-dist requirement).

## Members

| member package | row id | contents |
| --- | --- | --- |
| `@khorsheed/dsh-client-message-tools` | `message-tools` | message tools: host Remote + client projection surface |
| `@khorsheed/dsh-message-timeline` | `message-timeline` | floating message-timeline navigation |
| `@khorsheed/dsh-client-session-title-edit` | `session-title-edit` | inline session-title rename |
| `@khorsheed/dsh-quote` | `quote` | quote anything (current session / side chat; the side-chat route self-hides when sidechat is absent) |
| `@khorsheed/dsh-inline-html-render` | `inline-html-render` | inline HTML cards in the transcript |
| `@khorsheed/dsh-context-guard` | `context-guard` | context-occupancy reminder + settings card |
| `@khorsheed/dsh-taskpilot` | `taskpilot` | stop/interrupt commands for background work |

## Install

```sh
dsh plugin --profile web add @khorsheed/dsh-bundle-conversation-toolbox
```

Once mounted, all seven rows are in place; each plugin's browser half is discovered through its own package's `dsh.client` declaration. Per-member session-level visibility (preset self-hide) keeps its own criteria — this bundle neither adds nor removes any.

## Compatibility

- **npm release line (`@deepseek-ai/dsh@0.1.5`)**: ✅ full — pure composition; the floor is the members' highest (minHost `0.1.5-rc.1`, from message-tools / quote / taskpilot; the rest floor at `0.1.2-rc.1`). Member-level degraded items (e.g. quote's side-chat route probing) are documented in each member's own Compatibility section.
- **deepseek-harness master / npm 0.1.7-rc.1+**: ✅ full (verifiedHost `0.1.7-rc.1`).

**Version-line map**: `0.1.0` and later require host `0.1.5-rc.1` and up.
