# `@khorsheed/dsh-local-agent-dsh`

English | [中文](README.zh.md)

The dsh harness of the local-agent family: delegate a task to dsh itself, running as a separate local CLI process — sibling to the kimi / codex / claude-code harnesses. The sub-dsh runs under its own scoped home, keeps its own session list, authenticates through the parent's API key, and can be resumed across rounds. By default it mounts nothing the model can see; a settings toggle turns the delegation tool on.

## Features

- **Delegate to dsh itself** — the parent spawns a sub-dsh headless process with the task, sibling to the other family harnesses (kimi / codex / claude-code).
- **Scoped home** — the sub-dsh runs with its own `DSH_HOME` (`$DSH_HOME/local-agent/dsh`): its own profile, sessions, and state, never mixed into the parent instance.
- **Resume across rounds** — a later round passes the child session id back and the SAME sub-dsh session continues.
- **No separate login** — the sub-dsh authenticates through the parent's resolved `DEEPSEEK_API_KEY`; no device-code flow.
- **DeepSeek toggle, default off** — nothing model-visible until you flip the switch in Settings → 本地 Agent; ON registers the `subagent_dsh` delegation tool alongside the official in-process subagent tools.

## Install

The family core and this bundle must be named in one command — `dsh plugin add` reconciles only *direct* dependencies into the profile's bundles layer:

```sh
dsh plugin --profile web add @khorsheed/dsh-local-agent @khorsheed/dsh-local-agent-dsh
```

Then restart the profile. No login step is needed; `/dsh status` reports whether the parent's `DEEPSEEK_API_KEY` credential resolves.

Uninstall:

```sh
dsh plugin --profile web remove @khorsheed/dsh-local-agent-dsh
```

Removing the bundle unregisters the harness and its `/dsh` command family. The scoped home (`$DSH_HOME/local-agent/dsh`) is left in place on purpose — it keeps the sub-dsh's own sessions; delete it to remove every trace.

## Config

| field | default | meaning |
| --- | --- | --- |
| `profileName` | `headless-local-agent-dsh` | sub-dsh profile under the scoped home |
| `apiKeyRef` | `DEEPSEEK_API_KEY` | credential reference the sub-dsh resolves |
| `cliLaunch` | parent's own launch | dsh launch argv prefix override |
| `headlessBundleDir` | resolved from installation | headless bundle directory for the sub-profile symlink |

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.1-rc.1`): ✅ full — the rc.8→0.1.1-rc.1 API audit (2026-08-21) confirms every surface this plugin consumes is unchanged or additive (the ProjectionDefinition restructure, cacheHitPercent return-type change, and the credentials/updated event rename do not touch this package); no source change was needed.
- source line (deepseek-harness master): ✅

## Known Limitations

- No interactive or device-code login flow — the sub-dsh authenticates only through the parent's `DEEPSEEK_API_KEY` credential; `/dsh login` reports the harness has no login flow.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**The DeepSeek toggle.** Unlike the other family harnesses, this one mounts **nothing model-visible by default**. A mutually-exclusive switch sits inside the dsh harness row's action area in Settings → 本地 Agent (namespace `local-agent-dsh`, default **off**):

- **OFF** (default): the instance keeps exactly the current behavior — delegation runs through the official in-process subagent tools. The model never sees a dsh delegation tool.
- **ON**: the controller registers the `dsh` harness, the `dsh-cli` delegation provider, and the family delegation tool (`subagent_dsh`). The switch flips the composition live via the settings watcher.

The official in-process subagent tools are base-bundle-owned and stay outside the switch: OFF leaves only them, ON adds `subagent_dsh` alongside them — two coexisting delegation shapes with different semantics (in-process continuable vs. separate CLI process), which the family tool description ('separate process, its own scoped home') makes distinguishable.

**Delegation.**

1. The provider generates one uuid (`session-<uuid>`), records the delegation (`childSessionId → cliSessionId` identity mapping), and spawns
   `dsh --profile headless-local-agent-dsh --session-id <uuid> "<task>"` with `env: { DSH_HOME: <scoped home>, DEEPSEEK_API_KEY: <resolved> }` and the parent session's cwd.
2. The sub-dsh headless bundle (`@khorsheed/dsh-local-agent-dsh-headless`) creates a session with exactly that id, runs the task, prints the final assistant text, and exits 0/1.
3. A later round passes the child session id as `resume`; the provider resolves the delegation and spawns `--resume <uuid>`; the sub-dsh resumes the same session via `agents.resume`.

The sub-dsh session id is caller-supplied, never parsed from stdout — sub-dsh stdout stays format-pure.

**Auth.** No device-code login: the sub-dsh authenticates through the parent's `DEEPSEEK_API_KEY` credential (the `apiKeyRef` config, default `DEEPSEEK_API_KEY`). `/dsh login` reports the harness has no login flow; `/dsh status` reports whether the credential resolves; `/dsh sessions` lists the sub-dsh's own sessions from its scoped-home store (never the parent's session list).

**Sub-profile provisioning.** The sub-dsh profile lives under the scoped home (`profiles/headless-local-agent-dsh`): a manifest (`@deepseek-ai/dsh-base` + the family headless bundle), an empty user layer, and one symlink resolving the headless bundle. Everything else (dsh-base and its whole dependency graph) resolves from the dsh installation anchor, so provisioning costs no pnpm install and is idempotent. The parent replicates its own launch (`node --import tsx … bin.ts`, or a configured `cliLaunch`) so the sub-dsh runs the same dsh build as its parent.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/local-agent-dsh`). Issues and contributions welcome there.
