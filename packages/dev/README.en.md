# @khorsheed/dsh-dev-suite

English | [中文](README.md)

The dev mode in one install: the `dsh-dev` agent preset plus the whole family it grants tools from — the local-agent core, the Kimi / Codex / Claude Code / dsh delegation providers, worktrees, room and typesafe. One 「开发模式」 card in the inventory; a session switched to dev mode gets the mode's tool set automatically.

## What the mode is

Dev mode is the official standard mode's full capability set, plus community tools granted per session: the three local-agent delegation tools (`subagent_kimi` / `subagent_codex` / `subagent_claude_code`), the worktrees model tool, the room collaboration tools and the typesafe judgement tool. Switch a session to 「开发模式」 in the mode selector and they are there; no other session sees any of them.

## Members

| member package | row ids | contents |
| --- | --- | --- |
| `@khorsheed/dsh-local-agent` | `local-agent` | the family core: shared scoped-homes root, delegation facade and Remote |
| `@khorsheed/dsh-local-agent-kimi` | `local-agent-kimi` | Kimi CLI harness; `subagent_kimi` ships as the package's `./tool` entry, granted by the preset |
| `@khorsheed/dsh-local-agent-codex` | `local-agent-codex` (+ override `tool-subagent-codex`) | Codex CLI harness; `subagent_codex` granted per session the same way |
| `@khorsheed/dsh-local-agent-claude-code` | `local-agent-claude-code` (+ override `tool-subagent-claude-code`) | Claude Code harness; `subagent_claude_code` granted per session the same way |
| `@khorsheed/dsh-local-agent-dsh` | `local-agent-dsh` | the dsh harness controller (Settings → 本地 Agent switch, off by default) |
| `@khorsheed/dsh-worktrees` | `worktrees` | the session worktree's branch, pending changes and commit history |
| `@khorsheed/dsh-room` | `room` | turn a session into a shared conversation with coordinators and members |
| `@khorsheed/dsh-typesafe` | `typesafe` | typed model judgement primitives other plugins call in code |

Card-less library (deps-only: in `dependencies`, no patch rows of its own): `@khorsheed/dsh-local-agent-dsh-headless` (the provisioned sub-dsh face) — the same treatment as @khorsheed/dsh-bundle-local-agent; it never appears on the inventory page and lives or dies with the family.

## Install

Paste the package name `@khorsheed/dsh-dev-suite` into the host's add-plugin dialog (or pick it from the marketplace index), confirm, and restart the instance — this one install brings every member along as dependencies, and the bundle's own patch mounts both the mode preset and the family rows. Then switch a session to 「开发模式」 in the mode selector.

The CLI equivalent:

```sh
dsh plugin --profile web add @khorsheed/dsh-dev-suite
```

```sh
dsh plugin --profile web remove @khorsheed/dsh-dev-suite
```

Removing the bundle removes the whole family including the mode preset; to keep the family and disable a single row, use the row-level switches on the bundle detail page.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.7-rc.1`): ✅ full — pure composition; the members floor at `0.1.5-rc.1`, but the mode preset row (an `@deepseek-ai/dsh-agent-preset` declaration) only exists on host `0.1.7-rc.1` and later, so the floor is the higher of the two. Per-member behavior differences are documented in each member's own Compatibility section.
- source line (deepseek-harness master): ✅ full (verifiedHost: 0.2.1-rc.1).

**Version-line map**: `0.1.0` and later require host `0.1.7-rc.1` and up.

## Known Limitations

- **dsh-side integration only** — each provider's CLI (`kimi` / `codex` / `claude`) must be installed on `PATH` separately, and login goes through each `/<harness> login`; the bundle neither installs the CLIs nor logs you in.
- **Removal is all-or-nothing** — removing this package removes every member along with it; there is no "drop one member from the bundle" — disable single rows via the row-level switches on the bundle detail page.
- **The preset row mirrors @khorsheed/dsh-presets** — the two copies are byte-identical in composition, pinned by the repo's parity spec; once the presets package retires, this file is the canonical copy.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**A mode bundle = a family bundle plus one mode preset row.** The member rows in `cordis.patch.yml` (including the two bare overrides disabling the official same-named tool rows) come verbatim from the corresponding member's own `cordis.patch.yml`; the closing `preset-dsh-dev` row (an `@deepseek-ai/dsh-agent-preset` declaration) is mirrored verbatim from `@khorsheed/dsh-presets`, with `scripts/preset-mode-parity.spec.ts` pinning the two copies' plugin composition and display fields against drift. The repo-wide check:plugins `dsh.bundle.kind: 'mode'` sanction pins the whole shape mechanically: rows may only come from the allowlist union of member canonical rows plus exactly one `preset-<mode>` row, members must be real self-mounting packages each contributing at least one row, and the mode value is unique across the tree.

**Installing me installs the family and the mode — without double-mounting.** All members are listed in `dependencies` (installation brings them along) and registered in `dsh.references` (the family roster, read by pack-time and catalog checks). `dsh plugin add` reconciles only the profile's *direct* dependencies into the bundles layer (`reconcilePlugins`) — installing this bundle applies THIS patch only; the members' own patches stay inert, so no row ever mounts twice. A member installed directly still self-mounts; any overlap is resolved by the row-level switches on the bundle detail page.

**`src/index.ts` exports only constants** (`MODE` / `FAMILY_MEMBERS` / `FAMILY_DEPS_ONLY`) so the package has a buildable `lib/` (a pack-dist requirement).

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/dev`). Issues and contributions welcome there.
