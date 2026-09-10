# dsh-local-agent-dsh-headless

English | [中文](README.md)

A headless sub-dsh runner for the local-agent family, in two modes: one-shot (default) runs one task in a caller-named dsh session, prints the final assistant text on stdout, and exits; resident (`--serve`) stays alive, takes turns over the family-internal stdio JSON-RPC wire, and pushes session events back — backing the parent `local-agent-dsh` provider's live driver (`live: true`). The sibling of the official `@deepseek-ai/dsh-headless` bundle, differing only in who owns the session id — you never install or mount it yourself; the parent `local-agent-dsh` provider auto-provisions it.

## Features

- **Caller-supplied session id** — `--session-id <id>` creates a fresh session with exactly that id, `--resume <id>` continues it; the id travels as a flag, never through stdout.
- **One-shot semantics** — drives the task, prints the final assistant text, exits 0 on a completed turn and 1 otherwise.
- **Resident serve mode** — `--serve` switches the runner to a long-lived loop: `turn/start` drives one round, `session/event` streams events as they happen, `session/idle` closes the round (after the log flush), `turn/interrupt` lands as an in-process `Agent.cancel` graceful interrupt (the process survives, the session stays continuable), and `shutdown` / stdin EOF exit gracefully. The wire contract lives in `src/wire.ts`.
- **Isolated session store** — sub-dsh sessions live under their own scoped `$DSH_HOME` and never appear in the parent instance's session list.
- **Zero manual mounting** — the parent provider provisions the `headless-local-agent-dsh` sub-profile for you; nothing to mount by hand.

## Install

This bundle is never installed or mounted on its own — installing the parent harness brings it in:

```sh
dsh plugin --profile web add @khorsheed/dsh-local-agent-dsh
```

There is nothing to uninstall separately; the bundle has no presence in any interactive profile.

## Usage

Normally the parent provider spawns this bundle; direct invocation works too:

```sh
dsh --profile headless-local-agent-dsh --session-id 6ba7... "run the tests"   # fresh
dsh --profile headless-local-agent-dsh --resume 6ba7... "run the rest"       # resume
dsh --profile headless-local-agent-dsh --serve                              # resident live-driver mode (stdio wire)
```

With neither flag the runner generates its own `session-<uuid>` id (the official headless behavior), so it stays a drop-in replacement for one-shot use. `--serve` takes neither a task nor session flags — turns and session ids all travel over the wire.

### `--model <provider/model>`

Overrides this launch's model selection:

```bash
dsh --profile headless-local-agent-dsh --model deepseek-official/deepseek-v4-pro --session-id 6ba7... "run the tests"
```

- Absent means the sub-instance's own `agentDefaultModel` selection — byte for byte the behavior before the flag existed.
- It splits at the FIRST `/` into provider and model, so a model id containing one survives; a bare id (no `/`) names the model only and keeps the instance's provider. A leading or trailing slash is not a split point — that would produce an empty half the agent cannot route — so the whole value is the model.
- Everything else on the selection is carried through (the reasoning effort in particular): a model swap is not a config reset.
- It is orthogonal to both modes: a one-shot launch binds that round, and `--serve` binds EVERY session the resident process hosts — a runtime's model is a process fact, which is exactly why the parent refuses a per-delegation model on the live path.

The parent `local-agent-dsh` provider supplies it automatically: the harness's `model` plugin-config key, or one delegation's own `DelegationCallOptions.model`, both land as this flag.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.2-rc.1`): ✅ full — baseline moved to the 0.1.2-rc.1 API surface (single-arm 0.1.2 API consumption; the 0.1.1-rc.2 runtime arm is retired), full build+test green; minHost moves up to 0.1.2-rc.1 — older hosts stay on the previous release line.
- source line (deepseek-harness master): ✅ (verifiedHost: 0.1.2-rc.1)

## Known Limitations

- **Never add this bundle to an interactive profile's `bundles`** — its sub-profile-only patch rows (persona override, `hmr` off, `tools` mode, `code-runtime` insert, member-bridge MCP) collide with an interactive composition and leak overrides into real user sessions. The package **declares no `dsh.bundle`**, so a hand-added bundles row fails loud at boot in `loadProfile` ("declares no dsh.bundle") — that is the gate.
- **`dsh plugin add` cannot auto-mount it, and need not** — the package used to declare `dsh.bundle`, and reconcilePlugins auto-mounts every `dsh.bundle`-declaring direct dependency into the composition's layer stack: both the 2026-08-23 P0 (duplicate `code-runtime` in the prod web profile) and its 2026-09-03 G3 recurrence were exactly that mount. The declaration is gone (T6); installing the package directly now earns only a "plain dependency" warning and mounts nothing — but it is also unnecessary: a **transitive** install through `@khorsheed/dsh-local-agent-dsh` suffices, and the parent provider auto-provisions. The package's own invariant still fails loud when it detects a web composition (the `webStartup` service).
- Sub-dsh sessions never appear in the parent instance's session list (separate scoped-home store).
- No other `local-agent` family bundles belong in this composition — nothing here spawns another dsh.
- Patch edits must be boot-verified before landing (`dsh preflight` or one real sub-dsh launch): the `!!js` tag is scalar-only, and a mistagged collection fails at profile boot.

## How it works

<details>
<summary>Internals (click to expand)</summary>

The local-agent family needs to continue the *same* dsh conversation across delegations: the parent provider generates one uuid and passes it on every round — the fresh round creates the sub-dsh session with it, each resume round continues exactly that session.

The bundle's patch rides over `dsh-base` in its own profile (e.g. `headless-local-agent-dsh`):

```yaml
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
```

The startup provider parses the task positional plus the mutually exclusive `--session-id` / `--resume` flags (or `--serve`) and publishes the invocation; in one-shot mode the runner creates or resumes that session via `agents.create` / `agents.resume`, drives the task, prints the final assistant text, and exits, while serve mode switches to the resident wire loop (`src/serve.ts`). The sub-profile itself is provisioned at runtime by the parent provider (`provisionDshSubProfile`) under the dsh harness's scoped home: the manifest lists only `@deepseek-ai/dsh-base`, and this bundle's patch is copied byte-for-byte from the package's `cordis.patch.yml` into that profile's own patch layer (the bundle declares no `dsh.bundle`, see Known Limitations), plus one symlink resolving this bundle for the loader's insert rows.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/local-agent-dsh-headless`). Issues and contributions welcome there.
