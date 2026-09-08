# `@khorsheed/dsh-local-agent`

English | [中文](README.md)

Run locally installed coding-agent CLIs — Kimi Code, Codex, Claude Code — from the dsh web GUI. Each CLI gets an isolated home, slash commands for login/sessions/status/logout, and an auth section in Settings.

<img src="../../docs/screenshots/08-local-agent.png" width="480" alt="The Local Agent cards under Settings → Plugins, header dots showing each provider's auth state">

## Features

- **Scoped homes per CLI** — isolated credential/session home under a shared root, created 0700; your native CLI installation is never touched.
- **Slash commands** — `/<harness> login|sessions|status|logout`, with the device-code login URL in the reply.
- **A settings card per provider** — Settings → Plugins → 可配置插件: the auth status dot (visible on the collapsed header), web login/sign-out, and the hot-swappable resident-mode (live) toggle with mirror granularity; cards compose this package's shared `ProviderAuthBlock`.
- **Subagent delegation** — hand work to a local CLI and resume it later, even across host restarts.

## Install

Install the core together with at least one harness bundle (`@khorsheed/dsh-local-agent-kimi`, `-codex`): `dsh plugin add` activates only *direct* dependencies, so the harness bundle's transitive dependency alone will not mount this core.

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

- npm release line (`@deepseek-ai/dsh@0.1.1-rc.2`): ✅ full — built and tested against the rc.8 type surface. This build REQUIRES rc.8: the `commands/execute` Remote gained a required `images` argument (rc.6/rc.7 hosts would receive shifted arguments) — stay on the previous build there. — also verified on 0.1.1-rc.1 (additive audit, 2026-08-21); re-audited for rc.2 (2026-08-22): consumed surface unchanged, full build+test green
- source line (deepseek-harness master): ✅

## Known Limitations

- **Login is a captured prompt or a manual handoff** — the web GUI has no interactive terminal: device-code harnesses (kimi/codex) surface the URL in the command reply while the CLI polls in the background; a harness whose auth is TTY-only (claude ≥2.1) declares the manual variant — `/login` replies with the exact command to run in the user's own terminal, and the registry watches the scoped home for the credential.
- **Homes root placement** — defaults to `$DSH_HOME/local-agent`, pending a standardized `var/state` layout.
- **Delegation log growth** — each harness's `delegations.jsonl` is append-only with no rotation.
- **One-sample shape** — the harness contract is induced from Kimi alone; not yet frozen.

## How it works

<details>
<summary>Internals (click to expand)</summary>

Each harness registers into `ctx.localAgent`: a scoped home, an optional login declaration (a device-code command, or the manual-handoff variant for a TTY-only CLI), a session-records adapter, and optional auth-status and sign-out probes. The glue provisions each home and registers the `/<harness> login|sessions|status|logout` command family; per-harness differences are just `homeEnvVar`, the login invocation, the records adapter, and the auth/sign-out probes.

**Delegation stays out of this seam.** Each harness bundle mounts its own subagent-provider row into the existing `subagent` capability (subagent-acp for ACP-over-stdio harnesses, an app-server provider for Codex), reading the scoped home through `localAgent.homeDir(name)`.

**Program queries ride a read-only Remote channel.** A `LocalAgentGateway` (service key `localAgentGateway`, generated `./remote`) exposes roster, per-harness status, and scoped sessions to the browser. It emits no session events, so UI polls leave no command nodes in the session log; login and logout stay on the slash-command channel, where a visible command node is the expected feedback.

**Evaluation snapshot (`effectiveSettings`).** Every harness may declare a snapshot of the fairness-relevant settings currently in force: drive (exec/live), the sandbox or permission boundary (in each harness's own vocabulary — codex reports its sandbox policy, claude-code its permission mode, kimi its auto-approve state; a harness with no such knob omits the field, and the absence is itself the honest condition-hash input), the reasoning effort, the configured model (each harness reads its own configuration surface — kimi's `default_model`, codex's `model`, claude-code's scoped `settings.json`, dsh's inherited host selection; unreadable means the field drops out, never a guessed default), whether a non-default endpoint is pinned (hostname only, never the full URL), and the CLI version (asked of the CLI itself: `probeCliVersion` runs one `<cli> --version`, cached against the executable's resolved path + mtime + size, so an upgrade re-probes by itself while a missing CLI, a timeout, a non-zero exit, or output with no version-shaped token all just leave the field out). The snapshot is a live read — a person-edited scoped config reports the edited values — pure JSON, never credentials. `registry.effectiveSettings(name)` serves the evaluator's condition hash, and the same snapshot rides `/<harness> status` and the `LocalAgentStatus` Remote (additive fields; existing clients are unaffected).

**The credential status says only what is known (`credentialState`).** Beside the `authenticated` boolean, `LocalAgentStatus` carries a grade: `absent` (no credential record in the scoped home), `present-unverified` (a record exists, but nothing in this host process has exercised it — an expired, unrefreshable grant looks exactly like a working one, and saying so is the whole point of this grade), `verified` (a delegation round reached the endpoint and completed since the last login/logout), and `rejected` (a round's endpoint rejected the credential and no fresh login has rewritten the credential marker since). `authenticated` is unchanged and exactly equals `verified || present-unverified`, so the settings card and every existing client keep reading the boolean they always read. The grade is per host process: after a restart a present credential reports `present-unverified`, because that is what is actually known — an eager pre-run liveness probe is not this field's job. Providers call `reportAuthSuccess` when a round settles completed, the symmetric counterpart of the existing `reportAuthFailure`.

**Browser half ships in this package.** The `./client` export mounts automatically via the `dsh.client` manifest: the member composer (delegated child sessions stay writable) plus the shared settings-card building blocks (`ProviderAuthBlock`, the auth-status bus, `AuthStatusDot`) — each provider package's `settings.plugin.item` card composes them, keeping the UI provider-neutral (it consumes only the `/<harness>` command family and the read-only gateway).

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

`login` is optional: a harness without a device-code flow (e.g. dsh itself, which authenticates through the host instance's `DEEPSEEK_API_KEY`) omits it, and `/dsh login` answers that the harness has no login flow instead of spawning a CLI. Such harnesses still report `status` through `isAuthenticated` and list sessions normally; the status snapshot carries explicit `loginable`/`logoutable` capability flags so surfaces never offer an action the harness would reject.

### Delegation registry (resume carrier)

The registry also owns the family's **delegation registry**: a per-child-session record of which provider and CLI session a delegation used, plus a per-(parent, provider) FIFO of delegation intents. The family tool (`@khorsheed/dsh-local-agent-tool-subagent`, mounted by each harness bundle's patch) stages exactly one intent per call before `ctx.subagents.start()`, and the owning provider consumes exactly one per start — so fresh and resume rounds stay paired even under parallel delegation. A resume handle (the dsh child session id) resolves through the registry, which rejects a handle naming an unknown child, another parent's session, or the wrong provider; the subagent request descriptor cannot carry the target, so this service is the family-internal carrier. Mappings persist per harness in an append-only `delegations.jsonl` under the harness's scoped home (last line per child session wins), so a resume handle survives a host restart.

### Active-delegation registry and `/local-agent stop`

The registry also owns the **active-delegation registry**: an in-flight run table keyed by dsh child session id. Facade-started runs (`start`/`resume` — the member composer, room, and other programmatic entry points) and runs the family tool starts directly through `ctx.subagents.start()` (registered via `trackDelegationRun`) all land in the same table, and an entry clears itself when the run's result settles. `/local-agent stop <childSessionId>` cancels the in-flight delegation by this table — semantics aligned with the official `subagents.interrupt(targetSessionId)`: fire-and-return (the cancel signal goes out before the reply), and an absent target (unknown child or no in-flight run) is an explicitly-named accepted no-op, not an error. This gives surfaces like taskpilot a landing point for their stop buttons: for a one-shot subagent row with no live agent, the button dispatches `/local-agent stop <childSessionId>` instead, degrading to an explicit "cannot stop" error when the local-agent core is absent.

### Model Experience

**What the model sees** — nothing from the registry itself: `/<harness>` command replies and the `/local-agent list` roster text are user-visible command text, never model prompts. Model-visible effects start only when a harness bundle mounts a subagent provider; the parent then sees the child's final answer through the subagent tool result.

**Token effect** — command discovery, execution, and reply text add no model tokens. Delegation tokens belong to the harness bundle's provider, which pays for an independent child context.

**KV Cache effect** — registry metadata and command replies never enter a model request and do not affect its cache; a delegated child owns its cache independently.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/local-agent`). Issues and contributions welcome there.
