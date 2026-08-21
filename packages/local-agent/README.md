# `@khorsheed/dsh-local-agent`

English | [中文](README.zh.md)

The local code-agent harness family core. Each locally-installed coding-agent CLI — Kimi Code, Codex, Claude Code — registers itself as one **harness** into `ctx.localAgent`: a scoped home under the shared homes root (its state never touches the user's native installation, and the home is created 0700 because it holds credentials and sessions), an optional device-code login command, a session-records adapter, and optional auth-status and sign-out probes. The glue provisions each scoped home and registers the `/<harness> login|sessions|status|logout` command family.

**Delegation stays out of this seam.** Each harness bundle mounts its own subagent-provider row into the existing `subagent` capability (subagent-acp for a harness that speaks ACP over stdio, a Codex app-server provider for Codex), reading the scoped home through `localAgent.homeDir(name)`. This package owns harness identity and lifecycle only — the per-harness differences are `homeEnvVar`, the (optional) login invocation, the records adapter, the auth probe, and the sign-out path, nothing more.

**Program queries ride a read-only Remote channel.** A `LocalAgentGateway` (service key `localAgentGateway`, generated `./remote`) exposes roster, per-harness status, and scoped sessions to the browser through Typert Gateway. It emits no session events, so UI polls never leave command nodes in the session log; login and logout stay on the slash-command channel, where a visible command node is the expected feedback for a user-initiated action.

**Browser half ships in this package.** The `./client` export (a `dsh.client` row) is the roster-driven settings section (Settings → 本地 Agent): per-harness auth status, web-login device code, sign-out, and the delegation preset state. It is mounted automatically from this package's `dsh.client` manifest — no separate UI package, because the UI is provider-neutral (it consumes only the `/<harness>` command family and the read-only gateway) and has no independent consumer. The section also declares provider-neutral contribution seats (`local-agent.settings.row` below the harness list and `local-agent.settings.row-action` inside each harness row's action area) so harness bundles can contribute their own settings rows and per-harness actions (e.g. the dsh enable/disable toggle) without the section knowing them.

## Install

The core is its own bundle: this package's `cordis.patch.yml` inserts the `local-agent` row (shared scoped-homes root), and every harness bundle (`@khorsheed/dsh-local-agent-kimi`, `-codex`, future claude) declares this package as a dependency. Install the core and the harness bundle together — `dsh plugin add` reconciles only *direct* dependencies into the profile's bundles layer, so the harness bundle's transitive dependency alone would not activate this patch. A custom composition mounts the core once:

```yaml
- id: local-agent
  name: '@khorsheed/dsh-local-agent'
  config:
    homesRoot: !!js dshHomePath('local-agent')
```

## Adding a harness

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

## Delegation registry (resume carrier)

Beyond harness identity, the registry owns the family's **delegation registry**: a per-child-session record of which provider and CLI session a delegation used, plus a per-(parent, provider) FIFO of delegation intents. The family tool (`@khorsheed/dsh-local-agent-tool-subagent`, mounted by each harness bundle's patch) stages exactly one intent per call before `ctx.subagents.start()`, and the owning provider consumes exactly one per start — so fresh and resume rounds stay paired even under parallel delegation. A resume round's handle (the dsh child session id) resolves through the registry, which rejects a handle naming an unknown child, another parent's session, or the wrong provider. The subagent request descriptor cannot carry the target (its schema rejects unknown fields), so this service is the family-internal carrier; the same records will feed a future stop registry. The mappings persist per harness in an append-only `delegations.jsonl` under the harness's scoped home (last line per child session wins, and the kimi mirror offset rides the record), so a resume handle survives a host restart.

## Model Experience

### Harness command replies

#### What the model sees

The registry itself submits nothing. `/<harness> login|sessions|status` replies and the `/local-agent list` roster text are user-visible command text, never model prompts. Model-visible effects start only when a delegation mounts a subagent provider — the harness bundle's job — and the parent then sees the child's final answer through the subagent tool result.

#### Token effect

Command discovery, execution, and reply text add no model tokens. Delegation tokens belong to the harness bundle's provider, which pays for an independent child context.

#### KV Cache effect

Registry metadata and command replies never enter a model request and do not affect its cache; a delegated child owns its cache independently.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.1-rc.1`): ✅ full — built and tested against the rc.8 type surface. This build REQUIRES rc.8: the `commands/execute` Remote gained a required `images` argument (rc.6/rc.7 hosts would receive shifted arguments) — stay on the previous build there. — also verified on 0.1.1-rc.1 (additive audit, 2026-08-21)
- source line (deepseek-harness master): ✅

## Known Limitations and Deferred Work

- **Login is a captured prompt** — the web GUI has no interactive terminal surface, so the device-code URL is surfaced in the command reply while the CLI polls in the background; a terminal-backed login for CLI surfaces is deferred.
- **Homes root placement** — the default `$DSH_HOME/local-agent` predates a formal `var/state` layout; revisit when the harness home layout is standardized.
- **Delegation log growth** — each harness's `delegations.jsonl` is append-only with no rotation (the same growth class as session_index/rollout files); rotation/cleanup is deferred.
- **One-sample shape** — the harness contract is induced from Kimi; a Codex spike (records adapter + login probe) should precede freezing the shape.
