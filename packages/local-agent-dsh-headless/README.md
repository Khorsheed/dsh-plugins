# dsh-local-agent-dsh-headless

English | [中文](README.zh.md)

A one-shot headless sub-dsh runner for the local-agent family: run one task in a dsh session — freshly created with exactly the id you pass (`--session-id`), or continued (`--resume`) — get the final assistant text on stdout, and the process exits. It is the sibling of the official `@deepseek-ai/dsh-headless` bundle, differing only in who owns the session id. You never install or mount it yourself: the parent `local-agent-dsh` provider auto-provisions it into its own sub-profile at runtime.

## Features

- **Caller-supplied session id** — `--session-id <id>` creates a fresh session with exactly that id; `--resume <id>` continues the existing session with that id. The id travels as an invocation flag, never through stdout, so sub-dsh output stays format-pure — no delimiter prefix, and no risk of a task answer that happens to contain an id-like string being misparsed.
- **One-shot semantics** — drives the task, flushes, prints the final assistant text, and exits 0 on a completed turn, 1 otherwise — mirroring the official headless runner.
- **Isolated session store** — sub-dsh sessions live under their own `$DSH_HOME` (the harness's scoped home) and never appear in the parent instance's session list.
- **Zero manual mounting** — composed only into the `headless-local-agent-dsh` sub-profile, which the parent provider provisions for you; there is nothing to mount by hand anywhere.

## Install

This bundle is never installed or mounted on its own. Installing the parent harness brings it in:

```sh
dsh plugin --profile web add @khorsheed/dsh-local-agent-dsh
```

The parent provider then auto-provisions this bundle into the `headless-local-agent-dsh` sub-profile under the dsh harness's scoped home. There is nothing to uninstall separately — the bundle has no presence in any interactive profile.

## Usage

Normally the parent provider spawns this bundle; direct invocation works too:

```sh
dsh --profile headless-local-agent-dsh --session-id 6ba7... "run the tests"   # fresh
dsh --profile headless-local-agent-dsh --resume 6ba7... "run the rest"       # resume
```

With neither flag, the runner generates its own `session-<uuid>` id (the official headless behavior), so the bundle is a drop-in replacement for one-shot use.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.1-rc.1`): ✅ full — the rc.8→0.1.1-rc.1 API audit (2026-08-21) confirms every surface this plugin consumes is unchanged or additive (the ProjectionDefinition restructure, cacheHitPercent return-type change, and the credentials/updated event rename do not touch this package); no source change was needed.
- source line (deepseek-harness master): ✅

## Known Limitations

- **Never add this bundle to an interactive profile's `bundles`.** Its patch carries sub-profile-only rows — a persona override, `hmr` disabled, a `tools` mode override, a `code-runtime` insert, and the member-bridge MCP row — that collide with an interactive composition (duplicate `code-runtime` id) and leak overrides into real user sessions. If a main-profile-safe variant is ever needed, split a separate patch instead of reusing this one.
- Sub-dsh sessions never appear in the parent instance's session list (separate scoped-home store).
- No `local-agent` family bundles belong in this composition: base's own in-process subagent tools stay, but nothing here spawns another dsh.
- Patch edits must be boot-verified before landing (`dsh preflight` against a profile composing this bundle, or one real sub-dsh launch): the `!!js` tag is scalar-only and a mistagged collection fails at profile boot, before any plugin code runs. `tests/patch.spec.ts` pins the shape in-repo, but the boot check is the authoritative gate.

## How it works

<details>
<summary>Internals (click to expand)</summary>

The local-agent family needs to continue the *same* dsh conversation across delegations. The parent provider generates one uuid and passes the same value on every round: the fresh round creates the sub-dsh session with it, and each resume round continues exactly that session.

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
```

The startup provider parses the task positional plus `--session-id` / `--resume` (mutually exclusive) and publishes the invocation; the runner creates (`agents.create({ sessionId })`) or resumes (`agents.resume({ resumeSessionId })`) that session, drives the task, flushes, prints the final assistant text, and exits.

The sub-profile is provisioned at runtime by the parent provider (`provisionDshSubProfile`) under the dsh harness's scoped home: its own `package.json`, patch layer, and bundle symlink are written there.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/local-agent-dsh-headless`). Issues and contributions welcome there.
