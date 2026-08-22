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

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.1-rc.1`): ✅ full — the rc.8→0.1.1-rc.1 API audit (2026-08-21) confirms every surface this plugin consumes is unchanged or additive (the ProjectionDefinition restructure, cacheHitPercent return-type change, and the credentials/updated event rename do not touch this package); no source change was needed.
- source line (deepseek-harness master): ✅

## Known Limitations

- **Never add this bundle to an interactive profile's `bundles`** — its sub-profile-only patch rows (persona override, `hmr` off, `tools` mode, `code-runtime` insert, member-bridge MCP) collide with an interactive composition and leak overrides into real user sessions.
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

The startup provider parses the task positional plus the mutually exclusive `--session-id` / `--resume` flags (or `--serve`) and publishes the invocation; in one-shot mode the runner creates or resumes that session via `agents.create` / `agents.resume`, drives the task, prints the final assistant text, and exits, while serve mode switches to the resident wire loop (`src/serve.ts`). The sub-profile itself is provisioned at runtime by the parent provider (`provisionDshSubProfile`) under the dsh harness's scoped home, with its own `package.json`, patch layer, and bundle symlink.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/local-agent-dsh-headless`). Issues and contributions welcome there.
