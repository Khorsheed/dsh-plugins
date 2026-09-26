# @khorsheed/dsh-local-agent-dsh-headless

English | [中文](README.md)

A headless dsh at the caller's beck and call: the session id is yours to name, it runs the task, prints the final answer on stdout, and exits — or, with `--serve`, stays resident and takes turn after turn.

The local-agent family delegates tasks to a standalone dsh process and needs to continue the *same* sub-session across rounds — which requires the session id to belong to the caller, not to a runner that generates its own. This bundle is the sibling of the official `@deepseek-ai/dsh-headless`: the same direct-Agent composition over `dsh-base`, differing only in who owns the id — here it arrives as `--session-id` / `--resume`, and stdout never carries a parseable session marker. You never install or mount it yourself: the parent `@khorsheed/dsh-local-agent-dsh` provider auto-provisions its sub-profile at runtime.

## Features

- **Caller-supplied session id** — `--session-id <id>` creates a fresh session with exactly that id, `--resume <id>` continues it; the id travels as a launch flag, never parsed out of stdout.
- **One-shot semantics** — drives the task to quiescence, flushes the log, prints the final assistant text on stdout; exit 0 on a `completed` turn, exit 1 otherwise (the error summary goes to stderr).
- **Resident serve mode** — `--serve` switches the runner into a long-lived loop: `turn/start` takes a round, `session/event` streams every event as it lands, `session/assistant-stream` forwards the native assistant frames, `session/idle` closes the round after the log flush, `turn/interrupt` lands as an in-process `Agent.cancel` graceful interrupt (the process survives, the session stays continuable), and `shutdown` or stdin EOF exits gracefully. The wire contract lives in `src/wire.ts`.
- **Per-launch model and reasoning effort** — `--model <provider/model>` overrides this launch's model selection and `--effort <value>` pins the native reasoning effort (validated against what the model advertises — an unrecognized value fails loud); absent either flag, the instance's own selection carries over byte for byte.
- **Isolated session store** — sub-dsh sessions live under their own scoped `$DSH_HOME` and never appear in the parent instance's session list.
- **Zero manual mounting** — the parent provider provisions the `headless-local-agent-dsh` sub-profile for you; nothing to mount by hand.

## Install

This bundle is never installed or mounted on its own — it comes in transitively with the parent harness, and the parent provider provisions the sub-profile at runtime:

```sh
dsh plugin --profile web add @khorsheed/dsh-local-agent @khorsheed/dsh-local-agent-dsh
```

Restart the web instance to activate. Uninstalling goes through the parent package, and this bundle leaves with it:

```sh
dsh plugin --profile web remove @khorsheed/dsh-local-agent-dsh
```

There is nothing to uninstall separately — this package has no row in any interactive profile, and must never have one (see Known Limitations).

## Usage

Normally the parent provider spawns this bundle; direct invocation works too:

```sh
dsh --profile headless-local-agent-dsh --session-id 6ba7... "run the tests"   # fresh
dsh --profile headless-local-agent-dsh --resume 6ba7... "run the rest"       # resume
dsh --profile headless-local-agent-dsh --serve                              # resident live-driver mode (stdio wire)
```

With neither flag the runner generates its own `session-<uuid>` id (the official headless behavior), so it stays a drop-in replacement for one-shot use. `--serve` takes neither a task nor session flags — turns and session ids all travel over the wire.

### `--model <provider/model>` and `--effort <value>`

Overrides this launch's model selection:

```sh
dsh --profile headless-local-agent-dsh --model deepseek-official/deepseek-v4-pro --session-id 6ba7... "run the tests"
```

- No `--model` means the sub-instance's own `agentDefaultModel` selection — byte for byte the behavior before the flag existed.
- The value splits at the FIRST `/` into provider and model, so a model id containing one survives; a bare id (no `/`) names the model only and keeps the instance's provider. A leading or trailing slash is not a split point — that would produce an empty half the agent cannot route — so the whole value is the model.
- Everything else on the selection is carried through: a model swap is not a config reset.
- `--effort <value>` pins this launch's native reasoning effort: the value is validated against the effort list the selected model advertises, an unrecognized value fails loud, and an empty one is a usage error.
- Both flags are orthogonal to both modes: a one-shot launch binds that round, and `--serve` binds EVERY session the resident process hosts — a runtime's model is a process fact, which is exactly why the parent refuses a per-delegation model on the live path.

The parent `local-agent-dsh` provider supplies `--model` automatically: the harness's `model` plugin-config key, or one delegation's own `DelegationCallOptions.model`, both land as this flag.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`): ✅ full — the first release line (0.1.0-rc.6) is already based on the 0.1.5-rc.1 API surface, full build+test green; minHost is 0.1.5-rc.1, and older hosts have no earlier release line to fall back to.
- source line (deepseek-harness master): ✅ (verifiedHost: 0.1.5-rc.1)

## Known Limitations

- **Never add this bundle to an interactive profile's `bundles`** — its sub-profile-only patch rows (persona override, `hmr` off, `tools` mode, the `ptc-runtime` insert, the member-bridge MCP) collide with an interactive composition and leak overrides into real user sessions. The package **declares no `dsh.bundle`** (the manifest carries `dsh.composition.component: "sub-profile-patch"`), so a hand-added bundles row fails loud at boot in `loadProfile` — that is the gate.
- **`dsh plugin add` on this package mounts nothing, and need not** — the package used to declare `dsh.bundle`, and reconcilePlugins auto-mounts every `dsh.bundle`-declaring direct dependency into the composition's layer stack: both the 2026-08-23 P0 (duplicate `code-runtime` in the prod web profile) and its 2026-09-03 G3 recurrence were exactly that mount. The declaration is gone (T6); installing the package directly now earns only a "plain dependency" warning and mounts nothing — a **transitive** install through `@khorsheed/dsh-local-agent-dsh` suffices, and the parent provider auto-provisions. The package's own invariant (the `/invariant` subpath) still fails loud when it detects a web composition (the `webStartup` service).
- No other `local-agent` family bundles belong in this composition — nothing here spawns another dsh.
- Patch edits must be boot-verified before landing (`dsh preflight` or one real sub-dsh launch): the `!!js` tag is scalar-only, and a mistagged collection fails at profile boot.

## How it works

<details>
<summary>Internals (click to expand)</summary>

The local-agent family needs to continue the *same* dsh conversation across delegations: the parent provider generates one uuid and passes it on every round — the fresh round creates the sub-dsh session with it, each resume round continues exactly that session.

The bundle's patch rides over `dsh-base` in its own profile (e.g. `headless-local-agent-dsh`); at its core are two insert rows (excerpted from the package's `cordis.patch.yml`):

```yaml
- insert:
    - id: local-agent-dsh-headless-startup
      name: '@khorsheed/dsh-local-agent-dsh-headless/startup'

    - id: local-agent-dsh-headless-runner
      name: '@khorsheed/dsh-local-agent-dsh-headless'
      inject: [localAgentDshHeadlessStartup]
      config:
        task: !!js ctx.localAgentDshHeadlessStartup.task
        sessionId: !!js ctx.localAgentDshHeadlessStartup.sessionId
        resumeSessionId: !!js ctx.localAgentDshHeadlessStartup.resumeSessionId
        serve: !!js ctx.localAgentDshHeadlessStartup.serve ?? false
        model: !!js ctx.localAgentDshHeadlessStartup.model
        effort: !!js ctx.localAgentDshHeadlessStartup.effort
```

The startup provider parses the task positional plus the mutually exclusive `--session-id` / `--resume` flags (or `--serve`) and publishes the invocation; the runner waits for the whole loader tree to settle before touching an agent — one-shot mode creates or resumes the session via `agents.create` / `agents.resume`, drives the task, prints the final assistant text, and exits, while serve mode switches to the resident wire loop (`src/serve.ts`). The sub-profile itself is provisioned at runtime by the parent provider (`provisionDshSubProfile`) under the dsh harness's scoped home: the manifest lists only `@deepseek-ai/dsh-base`, this bundle's patch is copied byte-for-byte from the package's `cordis.patch.yml` into that profile's own patch layer (the bundle declares no `dsh.bundle`, see Known Limitations), plus one symlink resolving this bundle for the loader's insert rows.

**The wire contract (`src/wire.ts`).** A family-internal newline-delimited JSON-RPC 2.0 over stdio, framed exactly like the official `JsonRpcLineTransport` (`@deepseek-ai/dsh-sdk-protocol`), so a future swap to the official SDK server stays mechanical — the official server is not usable today: its wire has no turn-level interrupt (`initialize` / `session/prompt` / `shutdown` only), and graceful interrupt is the live driver's reason to exist (upstream seam registry: the SDK-wire-interrupt entry). Every request is a quick acknowledgement (`turn/start` answers "accepted"), and the round's events and terminal outcome flow back as notifications, so a long turn never holds a request open. `turn/start` carries the parent's round number and echoes it on every `session/event` / `session/idle` of that round, so the parent can drop a cancelled round's late unwind instead of letting it mis-settle the next round; `session/idle` fires only AFTER the session log is flushed, so a file-based reconciliation right after it sees the complete round. The handshake (`initialize`) reports the server name and protocol version (currently 1); `session/prepare` lets the parent validate the resident process's bound model and reasoning effort before starting a round — no session created, nothing generated. One resident process serves one member.

**Composition guard.** The `/invariant` subpath registers a composition invariant: detecting the `webStartup` service (the marker of a web composition) fails loud. The loader's duplicate-id failure is loud but cryptic, and only fires when ids collide — if upstream renamed a row id, the persona override would leak into real user sessions silently; the invariant is the CLEAR failure for the non-colliding case.

**Preset roster (optional).** When the sub-profile's patch carries an extra `@deepseek-ai/dsh-agent-presets` layer — written by the parent provider when the scope declares a preset — the agent loader joins it inside `setup`, before the agent is published, so the preset's tools and prompt sections exist before the first prompt assembly. Without the layer it does nothing: the model-facing rows stay in the host plane and the agent reads the global layer, byte for byte the behavior before this existed. A roster that REFUSES (unknown preset id, broken composition) is not degraded past: the mount rejects, the agent creation rolls back, and the launch fails naming the preset — a sub-dsh that silently ran the global layer after being told to run preset X would attribute the round to a capability face it never had.

**Exports.** `.` exports the runner plugin body (`apply` / `inject` / `Config`); `/startup` exports the command-line provider (the source of the `localAgentDshHeadlessStartup` service); `/wire` exports the wire contract types and protocol constants; `/invariant` exports the composition-guard companion.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/local-agent-dsh-headless`). Issues and contributions welcome there.
