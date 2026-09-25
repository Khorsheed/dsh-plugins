# @khorsheed/dsh-bundle-local-agent

English | [中文](README.md)

The family bundle "Local Multi-Agent": the local-agent core plus the four delegation providers (kimi / codex / claude-code / dsh) in one install. A thin meta package — a patch inserting the members' canonical rows, npm dependencies that bring the members along, and locale card metadata — **with no runtime code and no client half of its own** (pure composition: it registers no service, tool, slot, or command).

## Shape: a composition-only meta package

- **The patch reuses the members' canonical rows verbatim**: every row in `cordis.patch.yml` (including the two bare overrides that disable the official same-named tool rows) comes from the corresponding member's own `cordis.patch.yml`, id and name unchanged. The repo-wide check:plugins `dsh.bundle.kind: 'family'` sanction pins this mechanically: rows may only come from the allowlist union of member canonical rows, members must be real self-mounting packages, and every member must contribute at least one row.
- **Installing me installs the family — without double-mounting**: all members are listed in `dependencies` (installation brings them along) and registered in `dsh.references` (the family roster, read by pack-time and catalog checks). The mechanism: `dsh plugin add` reconciles only the profile's *direct* dependencies into the bundles layer (`reconcilePlugins`) — installing this bundle applies THIS patch only; members arrive as transitive dependencies and their own patches stay inert, so no row ever mounts twice. A member installed directly still self-mounts (the repo rule is unbroken); any row overlap from installing both is resolved by the row-level switches on the official bundle detail page.
- **`src/index.ts` exports only constants** (`FAMILY_MEMBERS` / `FAMILY_DEPS_ONLY`) so the package has a buildable `lib/` (a pack-dist requirement).

## Members

| member package | row ids | contents |
| --- | --- | --- |
| `@khorsheed/dsh-local-agent` | `local-agent` | the family core: shared scoped-homes root, delegation facade and Remote |
| `@khorsheed/dsh-local-agent-kimi` | `local-agent-kimi`, `tool-subagent-kimi` | Kimi CLI harness + the `subagent_kimi` delegation tool (resumable) |
| `@khorsheed/dsh-local-agent-codex` | `local-agent-codex`, `tool-subagent-codex-local` (+ override `tool-subagent-codex`) | Codex CLI harness + the `subagent_codex` delegation tool |
| `@khorsheed/dsh-local-agent-claude-code` | `local-agent-claude-code`, `tool-subagent-claude-code-local` (+ override `tool-subagent-claude-code`) | Claude Code harness + the `subagent_claude_code` delegation tool |
| `@khorsheed/dsh-local-agent-dsh` | `local-agent-dsh` | the dsh harness controller (Settings → 本地 Agent switch, off by default) |

Card-less libraries (deps-only: in `dependencies`, no patch rows of their own): `@khorsheed/dsh-local-agent-tool-subagent` (the delegation tool implementation the provider rows name) and `@khorsheed/dsh-local-agent-dsh-headless` (the provisioned sub-dsh face). They never appear on the inventory page and live or die with the family.

## Install

```sh
dsh plugin --profile web add @khorsheed/dsh-bundle-local-agent
```

Once mounted, every family row is in place: each provider's delegation tool sits at the profile root (any agent preset can delegate), and no provider process starts until a tool call or `/kimi`, `/codex`, `/claude-code` login. The dsh harness stays off until the Settings → 本地 Agent switch is flipped.

## Compatibility

- **npm release line (`@deepseek-ai/dsh@0.1.5`)**: ✅ full — pure composition; the floor is the members' highest (minHost `0.1.5-rc.1`). Per-member behavior differences on that line (e.g. token-granularity live mirroring) are documented in each member's own Compatibility section.
- **deepseek-harness master / npm 0.1.7-rc.1+**: ✅ full (verifiedHost `0.1.7-rc.1`).

**Version-line map**: `0.1.0` and later require host `0.1.5-rc.1` and up.
