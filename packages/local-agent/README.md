# `@khorsheed/dsh-local-agent`

English | [中文](README.zh.md)

Run your locally installed coding-agent CLIs — Kimi Code, Codex, Claude Code — from the dsh web GUI. Each CLI registers as one **harness** and gets an isolated scoped home (its state never touches your native installation), a slash-command family for login, sessions, status and logout, and a settings section showing per-harness auth status, web-login device code, and sign-out.

<img src="docs/screenshots/08-local-agent.png" width="480" alt="Settings → 本地 Agent section with per-harness auth status">

## Features

- **Scoped homes per CLI** — each harness gets a home under a shared homes root, created 0700 because it holds credentials and sessions; your native CLI installation is never touched.
- **Slash-command family** — `/<harness> login|sessions|status|logout` per registered CLI, with the device-code login URL surfaced in the command reply.
- **Settings section** — Settings → 本地 Agent shows per-harness auth status, web-login device code, sign-out, and the delegation preset state; harness bundles can contribute their own settings rows and per-harness actions.
- **Subagent delegation** — harness bundles mount delegation providers on top of this core, so a session can hand work to a local CLI and resume it later, even across host restarts.

## Install

The core is its own bundle; install it together with at least one harness bundle (`@khorsheed/dsh-local-agent-kimi`, `-codex`, future claude) — `dsh plugin add` reconciles only *direct* dependencies into the profile's bundles layer, so the harness bundle's transitive dependency alone would not activate this patch:

```sh
dsh plugin --profile web add @khorsheed/dsh-local-agent
```

Then restart the web instance. Uninstall:

```sh
dsh plugin --profile web remove @khorsheed/dsh-local-agent
```

## Config

A custom composition mounts the core once:

```yaml
- id: local-agent
  name: '@khorsheed/dsh-local-agent'
  config:
    homesRoot: !!js dshHomePath('local-agent')
```

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.1-rc.1`): ✅ full — built and tested against the rc.8 type surface. This build REQUIRES rc.8: the `commands/execute` Remote gained a required `images` argument (rc.6/rc.7 hosts would receive shifted arguments) — stay on the previous build there. — also verified on 0.1.1-rc.1 (additive audit, 2026-08-21)
- source line (deepseek-harness master): ✅

## Known Limitations

- **Login is a captured prompt** — the web GUI has no interactive terminal surface, so the device-code URL is surfaced in the command reply while the CLI polls in the background; a terminal-backed login for CLI surfaces is deferred.
- **Homes root placement** — the default `$DSH_HOME/local-agent` predates a formal `var/state` layout; revisit when the harness home layout is standardized.
- **Delegation log growth** — each harness's `delegations.jsonl` is append-only with no rotation (the same growth class as session_index/rollout files); rotation/cleanup is deferred.
- **One-sample shape** — the harness contract is induced from Kimi; a Codex spike (records adapter + login probe) should precede freezing the shape.

## How it works

<details>
<summary>Internals (click to expand)</summary>

Each harness registers into `ctx.localAgent`: a scoped home, an optional device-code login command, a session-records adapter, and optional auth-status and sign-out probes. The glue provisions each scoped home and registers the `/<harness> login|sessions|status|logout` command family. This package owns harness identity and lifecycle only — the per-harness differences are `homeEnvVar`, the (optional) login invocation, the records adapter, the auth probe, and the sign-out path, nothing more.

**Delegation stays out of this seam.** Each harness bundle mounts its own subagent-provider row into the existing `subagent` capability (subagent-acp for a harness that speaks ACP over stdio, a Codex app-server provider for Codex), reading the scoped home through `localAgent.homeDir(name)`.

**Program queries ride a read-only Remote channel.** A `LocalAgentGateway` (service key `localAgentGateway`, generated `./remote`) exposes roster, per-harness status, and scoped sessions to the browser through Typert Gateway. It emits no session events, so UI polls never leave command nodes in the session log; login and logout stay on the slash-command channel, where a visible command node is the expected feedback for a user-initiated action.

**Browser half ships in this package.** The `./client` export (a `dsh.client` row) is the roster-driven settings section, mounted automatically from this package's `dsh.client` manifest — no separate UI package, because the UI is provider-neutral (it consumes only the `/<harness>` command family and the read-only gateway) and has no independent consumer. The section declares provider-neutral contribution seats (`local-agent.settings.row` below the harness list and `local-agent.settings.row-action` inside each harness row's action area) so harness bundles can contribute their own settings rows and per-harness actions (e.g. the dsh enable/disable toggle) without the section knowing them.

### Adding a harness

A harness bundle registers into the core and mounts its own delegation row:

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { LocalAgentSessionRecord } from '@khorsheed/dsh-local-agent'

const listCodexSessions = async (homeDir: string): Promise<readonly LocalAgentSessionRecord[]> => []

/** Register the Codex harness into the local-agent registry. */
export function registerCodex(ctx: Context): void {
  ctx.localAgent.register({
    name: 'codex',                 // command prefix + scoped-home dir
    displayName: 'Codex',
    homeEnvVar: 'CODEX_HOME',
    delegationProvider: 'codex',  // subagent provider name; cross-checked at load
    login: { command: 'codex', args: ['login'] },
    records: { listSessions: listCodexSessions },
    // Optional: report auth from the scoped home and sign out of it, so
    // /codex status|logout work and the settings tab can switch accounts.
    isAuthenticated: async () => false,
    logout: async () => {},
  })
}
```

`login` is optional: a harness without one (e.g. dsh itself, which authenticates through the host instance's `DEEPSEEK_API_KEY` rather than a device-code flow) omits it, and `/dsh login` answers that the harness has no login flow instead of spawning a CLI. Such harnesses still report `status` through `isAuthenticated` and list sessions normally. The status snapshot carries explicit `loginable`/`logoutable` capability flags derived from the harness definition, so surfaces (the settings section) never offer a login or logout action the harness would answer with an error.

### Delegation registry (resume carrier)

Beyond harness identity, the registry owns the family's **delegation registry**: a per-child-session record of which provider and CLI session a delegation used, plus a per-(parent, provider) FIFO of delegation intents. The family tool (`@khorsheed/dsh-local-agent-tool-subagent`, mounted by each harness bundle's patch) stages exactly one intent per call before `ctx.subagents.start()`, and the owning provider consumes exactly one per start — so fresh and resume rounds stay paired even under parallel delegation. A resume round's handle (the dsh child session id) resolves through the registry, which rejects a handle naming an unknown child, another parent's session, or the wrong provider. The subagent request descriptor cannot carry the target (its schema rejects unknown fields), so this service is the family-internal carrier; the same records will feed a future stop registry. The mappings persist per harness in an append-only `delegations.jsonl` under the harness's scoped home (last line per child session wins, and the kimi mirror offset rides the record), so a resume handle survives a host restart.

### Model Experience

**What the model sees** — the registry itself submits nothing. `/<harness> login|sessions|status` replies and the `/local-agent list` roster text are user-visible command text, never model prompts. Model-visible effects start only when a delegation mounts a subagent provider — the harness bundle's job — and the parent then sees the child's final answer through the subagent tool result.

**Token effect** — command discovery, execution, and reply text add no model tokens. Delegation tokens belong to the harness bundle's provider, which pays for an independent child context.

**KV Cache effect** — registry metadata and command replies never enter a model request and do not affect its cache; a delegated child owns its cache independently.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/local-agent`). Issues and contributions welcome there.
