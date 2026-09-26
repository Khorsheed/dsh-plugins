# @khorsheed/dsh-bundle-local-agent

English | [中文](README.md)

Let dsh hand work to the other CLI agents on this machine — Kimi, Codex, Claude Code, dsh itself — with the whole local-agent family in one install.

One conversation, many agents: the mainline agent judges which task fits which harness, a delegation tool passes the task over with its requirements, and the finished CLI run brings the result back into the current dialogue (the run is visible in the 子代理 surface). This family bundle installs the local-agent core plus all four delegation providers at once, adding a single 「本地多Agent」 card to the inventory instead of making you pick packages one by one.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/08-local-agent.png" width="640" alt="The four Local Agent cards under Settings: Kimi, Codex, dsh, Claude Code — header dots showing each provider's auth state">

## Features

- **The whole family in one install** — the local-agent core (shared scoped-homes root, `/<harness> login|sessions` command family, delegation facade and Remote) plus the four delegation providers (kimi / codex / claude-code / dsh), with the family tool library, all from a single `dsh plugin add`.
- **In-place delegation tools** — `subagent_kimi` / `subagent_codex` / `subagent_claude_code` keep the official subagent tool names (toolName unchanged, so presets and prompts carry over), adding an optional `resume` parameter: continue the same CLI conversation in a later round instead of cold-starting every time.
- **No resident processes** — delegation defaults to one-shot processes; with no delegation or login activity, no extra provider process runs on the machine.
- **One card in the inventory** — locale card metadata folds the family into a single 「本地多Agent」 card; the two card-less libraries live and die with the family and never appear on their own.
- **Pure composition, zero runtime** — the package registers no service, tool, slot, or command of its own; the patch reuses the members' canonical rows verbatim and never double-mounts (mechanism in How it works below).

## Members

| member package | row ids | contents |
| --- | --- | --- |
| `@khorsheed/dsh-local-agent` | `local-agent` | the family core: shared scoped-homes root, delegation facade and Remote |
| `@khorsheed/dsh-local-agent-kimi` | `local-agent-kimi`, `tool-subagent-kimi` | Kimi CLI harness + the `subagent_kimi` delegation tool |
| `@khorsheed/dsh-local-agent-codex` | `local-agent-codex`, `tool-subagent-codex-local` (+ override `tool-subagent-codex`) | Codex CLI harness + the `subagent_codex` delegation tool |
| `@khorsheed/dsh-local-agent-claude-code` | `local-agent-claude-code`, `tool-subagent-claude-code-local` (+ override `tool-subagent-claude-code`) | Claude Code harness + the `subagent_claude_code` delegation tool |
| `@khorsheed/dsh-local-agent-dsh` | `local-agent-dsh` | the dsh harness controller (Settings → 本地 Agent switch, off by default) |

Card-less libraries (deps-only: in `dependencies`, no patch rows of their own): `@khorsheed/dsh-local-agent-tool-subagent` (the delegation tool implementation the provider rows name) and `@khorsheed/dsh-local-agent-dsh-headless` (the provisioned sub-dsh face). They never appear on the inventory page and live or die with the family.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/bundle-local-agent.png" width="640" alt="The 「本地多Agent」 family card's detail page in the plugin inventory: every member row listed with its own enable switch">

## Install

```sh
dsh plugin --profile web add @khorsheed/dsh-bundle-local-agent
```

Restart the web instance to activate. Once mounted, every family row is in place: each provider's CLI login runs through its own `/<harness> login` command (e.g. `/kimi login`); the dsh harness stays off until the Settings → 本地 Agent switch is flipped.

```sh
dsh plugin --profile web remove @khorsheed/dsh-bundle-local-agent
```

Removing the bundle removes the whole family; to keep the family and disable a single row, use the row-level switches on the bundle detail page.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`): ✅ full — pure composition; the floor is the members' highest (minHost `0.1.5-rc.1`, the floor of the core and the four providers; the deps-only libraries local-agent-tool-subagent / local-agent-dsh-headless floor lower). Per-member behavior differences above that floor (e.g. token-granularity live mirroring on 0.1.5) are documented in each member's own Compatibility section.
- source line (deepseek-harness master): ✅ full (verifiedHost: 0.1.7-rc.2).

**Version-line map**: `0.1.0` and later require host `0.1.5-rc.1` and up.

## Known Limitations

- **dsh-side integration only** — each provider's CLI (`kimi` / `codex` / `claude`) must be installed on `PATH` separately, and login goes through each `/<harness> login`; the bundle neither installs the CLIs nor logs you in.
- **Removal is all-or-nothing** — removing this package removes every member along with it; there is no "drop one member from the bundle" — disable single rows via the row-level switches on the bundle detail page.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**A composition-only meta package.** Every row in `cordis.patch.yml` (including the two bare overrides that disable the official same-named tool rows) comes verbatim from the corresponding member's own `cordis.patch.yml`, id and name unchanged. The repo-wide check:plugins `dsh.bundle.kind: 'family'` sanction pins this mechanically: rows may only come from the allowlist union of member canonical rows, members must be real self-mounting packages, and every member must contribute at least one row.

**Installing me installs the family — without double-mounting.** All members are listed in `dependencies` (installation brings them along) and registered in `dsh.references` (the family roster, read by pack-time and catalog checks). The mechanism: `dsh plugin add` reconciles only the profile's *direct* dependencies into the bundles layer (`reconcilePlugins`) — installing this bundle applies THIS patch only; members arrive as transitive dependencies and their own patches stay inert, so no row ever mounts twice. A member installed directly still self-mounts (the repo rule is unbroken); any row overlap from installing both is resolved by the row-level switches on the official bundle detail page.

**`src/index.ts` exports only constants** (`FAMILY_MEMBERS` / `FAMILY_DEPS_ONLY`) so the package has a buildable `lib/` (a pack-dist requirement).

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/bundle-local-agent`). Issues and contributions welcome there.
