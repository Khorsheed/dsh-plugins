# `@khorsheed/dsh-local-agent`

Model/effort controls, directories and visible member output share one member subscription per page, keeping multiple members and member-session navigation from multiplying HTTP/1 connections. Core queues busy selections for the next complete turn; frozen evaluation members reject changes.

Live member output uses a streaming Remote and public Conversation nodes. Browser updates are batched for at most 50ms, while incremental recovery checkpoints use an independent one-second cadence. Native final messages replace the transient presentation and retain usage, tools and session navigation. Reconnect obtains a fresh baseline; a host crash may lose the uncheckpointed tail, which remains visibly partial. Browser P95 acceptance remains part of the room coordinator proposal.

English | [中文](README.md)

Run locally installed coding-agent CLIs — Kimi Code, Codex, Claude Code — from the dsh web GUI. Each CLI gets an isolated home, slash commands for login/sessions/status/logout, and an auth section in Settings.

<img src="../../docs/screenshots/08-local-agent.png" width="480" alt="The Local Agent cards under Settings → Plugins, header dots showing each provider's auth state">

## Features

- **Scoped homes per CLI** — isolated credential/session home under a shared root, created 0700; your native CLI installation is never touched.
- **Slash commands** — `/<harness> login|sessions|status|logout`, with the device-code login URL in the reply.
- **A settings card per provider** — Settings → Plugins → 可配置插件: the auth status dot (visible on the collapsed header), web login/sign-out, and the hot-swappable resident-mode (live) toggle; cards compose this package's shared `ProviderAuthBlock`.
- **Subagent delegation** — hand work to a local CLI and resume it later, even across host restarts.
- **Several logins per harness (named scopes)** — `/<harness> login --scope <name>` opens a second scoped home at `<homesRoot>/<harness>@<name>`: its own login, its own session records, its own `delegations.jsonl`, and nothing copied from the default one. An evaluation can therefore compare two accounts of one harness in a single run.

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

- npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`): ✅ full — adapted to 0.1.5-rc.1 (format v2/v3; handle-based sessionPersistence), full build+test green; minHost moves up to 0.1.5-rc.1 — older hosts stay on the previous release line.
- source line (deepseek-harness master): ✅ (verifiedHost: 0.1.5-rc.1)

## Known Limitations

- **Login is a captured prompt or a manual handoff** — the web GUI has no interactive terminal: device-code harnesses (kimi/codex) surface the URL in the command reply while the CLI polls in the background; a harness whose auth is TTY-only (claude ≥2.1) declares the manual variant — `/login` replies with the exact command to run in the user's own terminal, and the registry watches the scoped home for the credential.
- **Homes root placement** — defaults to `$DSH_HOME/local-agent`, pending a standardized `var/state` layout.
- **Delegation log growth** — each scoped home's `delegations.jsonl` is append-only with no rotation.
- **One-sample shape** — the harness contract is induced from Kimi alone; not yet frozen.
- **The member channel authenticates on the per-run token alone** — the token is delivered through the CLI's scoped MCP config (the 0700 scoped home keeps other users out) and invalidated the moment the run settles; host 0.1.5 removed the child pid, so there is no second factor. **Residual exposure**: a same-host, same-user sibling member CLI (its model-driven bash) can read another member's token and replay it — the old pid check was a self-reported field and never stopped a deliberate forgery, so dropping it loses little; but a deliberately crafted cross-member call is now possible. Hardening (kernel-level socket peer credentials, or a spawn-time injected capability token) is tracked in `proposals/active/2026-09-10-member-channel-auth-hardening.md`.

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

### Delegation call options (facade)

The `options` argument of `registry.start(parent, provider, prompt, options)` and `registry.resume(…)` (`DelegationCallOptions`) — purely additive, every field absent meaning the behavior from before it existed:

| Field | What it does |
|---|---|
| `label` | Child display label; absent uses the harness's own display name |
| `signal` | The caller's own cancellation channel, fused with the facade's internal controller |
| `onProgress` | Per-call progress callback, the same payload the `localAgent/run-progress` event carries |
| `reattach` | `resume` only: restore a non-live child session from persistence (default true); `false` fails loud instead |
| `cwd` | The round's CLI working directory; a resume round must repeat the first round's, or it fails loud before any spawn |
| `exec` | Run this round inside an **already-acquired container**: `{ container, workdir, env? }` |
| `model` | The model THIS DELEGATION runs: accepted on `start` only — passing it to `resume` fails loud, because the first round's request is recorded and every later round re-requests it (none, when the first named none). Accepted for exec and live alike (the provider binds it when spawning the process/runtime). Order below |
| `scope` | Run this round against the harness's **named scoped home** (`<homesRoot>/<harness>@<scope>`); a resume round must repeat the first round's scope, absence included, or it fails loud |

**One settled observation per round.** A provider calls `recordRoundSettled` once its round's output stream is fully parsed, and the family turns it into one `settled` progress event: the round's `observedModel`, `cliVersion`, `usage`, and its `toolCalls` (`{ count, byName }`). Every field stays absent when the round did not yield it — never guessed, never zero-filled.

`toolCalls` is counted only from the transcript events the provider ALREADY parses — no new parse path and no second pass over the stream. `byName` keys are each CLI's own tool vocabulary (codex's `command_execution`, claude's `Bash`/`Read`, the tool names kimi's and dsh's own events carry), kept verbatim and **never normalized across harnesses**: cross-harness comparison is therefore `count` only, and `byName` is for a reader. Normalizing would invent an equivalence the CLIs never agreed to.

`observedModel` and `cliVersion` merge into the delegation record (which states the delegation's latest state); `toolCalls` rides the EVENT only — it belongs to one round, and merging it would silently overwrite the previous round's count with the newest one. A settle that lands before the record exists (the record point is each provider's own: a live round records at session/new, an exec round at the post-settle output parse) does not lose its observation either — the family stashes it and `recordDelegation` merges it when the record lands; both the exec and the live drive report.

**The model's five layers.** Which model a round starts its CLI with is the first of these that names one:

1. **the session-level override** (set through the member composer's model picker; in-memory, gone with a host restart)
2. **the delegation's own `model`** (the `start` call option; a resume round reads the same value back off the delegation record)
3. **the harness's `model` plugin-config key** (T30a, harness-wide)
4. **the harness's scoped configuration file** (codex's `model`, claude's `settings.json`, kimi's `default_model`; dsh inherits the host instance's default model selection)
5. **the CLI's own default**

All five absent means no model flag on the argv at all — byte for byte the behavior before any of these keys existed. Blank counts as absent.

**Why `resume` does not take a model.** A model belongs to the DELEGATION, not to one of its rounds: the first round records what it requested and every later round re-requests it. Switching mid-conversation is something the CLI would honour and the transcript would not show, so it is a caller error that fails loud rather than a silently ignored field. To switch models, use the member composer's picker (the session-level override below) — a layer the transcript can account for.

**Member model and reasoning configuration.** The member composer and Room coordinator share the core panel, showing current applied values, pending selections and preparation errors. Model and effort can inherit the member creation configuration, follow harness defaults or use explicit values; native candidates, configured candidates and history suggestions retain separate labels. Busy selections prepare after the current complete turn and tool continuations settle. Intent, revisions and pending state are durable and reconciled against native state after restart; users can cancel pending selections or retry failed preparation. Frozen evaluation members reject changes. Legacy `setMemberModel` uses the same controller instead of a separate busy-refusal path.

`effectiveSettings.model` still reports the answer from **the settings layer down** — "what would a round with no model of its own run", which is the harness-wide setting the condition snapshot is asking about; delegation records and session overrides never enter the snapshot.

**Container delegation (the `exec` target).** Given one, the provider spawns `docker exec -w <workdir> [-e NAME…] <container> <the same argv>`; stdio stays piped, and the stream parse, settle, readback and `delegations.jsonl` record are byte-for-byte the host path's. The family owns exactly one docker verb, `exec` — acquiring, mounting and destroying a container belong to the caller (lab).

- **Values never ride the argv.** Each forwarded variable appears only as `-e NAME`, and the docker CLI resolves it from its own environment — so a credential the provider resolved stays out of the host process table. What is forwarded: the defined entries of the provider's explicit env layer, overridden per key by `target.env`; the ambient allowlist (`PATH`, `HOME`, the proxy variables) is **not** forwarded — inside the container those belong to the image and the `docker run` that created it.
- **The caller must name the scoped home.** `target.env` must carry the in-container scoped-home variable (`CODEX_HOME` / `CLAUDE_CONFIG_DIR` / `KIMI_CODE_HOME` / `DSH_HOME`), or the round fails loud before spawning: the host path means nothing inside the unit, and forwarding it would start the CLI from an empty directory — no credentials, no rollout to read back, and nothing in the output naming the cause.
- **The scoped home is a HOST directory, bind-mounted read-write.** Readback (codex's rollout, kimi's wire log, the sub-dsh session log) reads it straight off the host filesystem, and credential refreshes land back on the host. **The caller stages what it mounts**: mount a live scoped home and its host-only settings ride along (measured: the `https_proxy` in claude's scoped `settings.json`, meant for the host daemon, points at nothing inside the unit and the round dies with `Connection refused`).
- **A container round is exec-only and carries no member channel.** The live drivers run resident processes on the HOST — the transport the target exists to replace; the member bridge is a host unix socket whose MCP declaration names a host node path. Both are given up on purpose, not missing by accident.
- **The caller repeats the target on resume.** The recorded anchor is the host `cwd`, which a swapped container leaves equal — that one the record cannot catch.

### Named scopes: several scoped homes per harness

The default scoped home is `<homesRoot>/<harness>` — byte for byte the directory it always was. Give a NAME (`[a-z0-9-]` only; a scope is a name, never a path) and you get a SIBLING of it: `<homesRoot>/<harness>@<name>`. Not a child, because that directory belongs to the harness's own CLI, and a second state tree inside it is something that CLI will eventually prune or misread.

- **Materialized lazily.** The directory is created the first time anything names the scope (`/<harness> login|status|sessions|logout --scope <name>`, a delegation carrying `scope`, the evaluation's mount source): `mkdir` 0700, then the harness's own provisioning (codex's `config.toml`, kimi's provider/model config and permission rules, claude's scoped home, dsh's sub-profile). The default scope's provisioning is unmoved — each harness bundle's `apply` still owns it.
- **Credentials are never copied.** A new scope is empty: `status` reports `credentialState: absent` and a delegation fails exactly as it does today, so using one starts with `/<harness> login --scope <name>`. claude's keychain item is keyed by the config directory's path, so a named scope gets its own item for free — the one part of this that is path-safe by nature.
- **Everything follows the directory.** That scope's session records, its `delegations.jsonl`, its effective-settings snapshot (the harness's `effectiveSettings(homeDir)` takes the directory as a parameter), its CLI-version probe, its credential grade and its delegation read-back all live in its own directory. The delegation record carries the `scope`, and a resume round is anchored to it: another scope — or none, when the first round had one — is refused before any process spawns. Continuing one CLI session under another account's credentials is not a mistake that can be repaired afterwards.
- **Boundaries (named absences, not gaps).** A scoped delegation is **exec-only**: the resident drivers (codex's app-server, claude's and kimi's ACP, the sub-dsh `serve`) are bound per member to the DEFAULT scoped home, so a scoped round meeting an active live driver is refused rather than quietly downgraded. kimi's member-bridge declaration is written INTO a scoped home's `mcp.json` and `member-bridge.sock` is a single homes-root socket, so a scoped kimi round carries no member channel. dsh's sub-profile follows the directory and needs nothing special.

### Active-delegation registry and `/local-agent stop`

The registry also owns the **active-delegation registry**: an in-flight run table keyed by dsh child session id. Facade-started runs (`start`/`resume` — the member composer, room, and other programmatic entry points) and runs the family tool starts directly through `ctx.subagents.start()` (registered via `trackDelegationRun`) all land in the same table, and an entry clears itself when the run's result settles. `/local-agent stop <childSessionId>` cancels the in-flight delegation by this table — semantics aligned with the official `subagents.interrupt(targetSessionId)`: fire-and-return (the cancel signal goes out before the reply), and an absent target (unknown child or no in-flight run) is an explicitly-named accepted no-op, not an error. This gives surfaces like taskpilot a landing point for their stop buttons: for a one-shot subagent row with no live agent, the button dispatches `/local-agent stop <childSessionId>` instead, degrading to an explicit "cannot stop" error when the local-agent core is absent.

### Model Experience

**What the model sees** — nothing from the registry itself: `/<harness>` command replies and the `/local-agent list` roster text are user-visible command text, never model prompts. Model-visible effects start only when a harness bundle mounts a subagent provider; the parent then sees the child's final answer through the subagent tool result.

**Token effect** — command discovery, execution, and reply text add no model tokens. Delegation tokens belong to the harness bundle's provider, which pays for an independent child context.

**KV Cache effect** — registry metadata and command replies never enter a model request and do not affect its cache; a delegated child owns its cache independently.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/local-agent`). Issues and contributions welcome there.
