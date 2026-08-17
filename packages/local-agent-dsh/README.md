# `@khorsheed/dsh-local-agent-dsh`

[English](README.md) | [中文](README.zh.md)

The **dsh harness** for the local-agent family: delegate to dsh itself as a local CLI, sibling to the kimi / codex / claude-code harnesses. The parent spawns a sub-dsh headless process under the harness scoped home (`$DSH_HOME/local-agent/dsh`, its own `DSH_HOME`), with the parent's resolved `DEEPSEEK_API_KEY` injected explicitly, and resumes the SAME sub-dsh session across rounds by a caller-supplied session id.

## The DeepSeek toggle

Unlike the other family harnesses, this one mounts **nothing model-visible by default**. A mutually-exclusive switch lives in Settings → 本地 Agent (namespace `local-agent-dsh`, default **off**):

- **OFF** (default): the instance keeps exactly the current behavior — delegation runs through the official in-process subagent tools. The model never sees a dsh delegation tool.
- **ON**: the controller registers the `dsh` harness, the `dsh-cli` delegation provider, and the family delegation tool (`subagent_dsh`). The switch flips the composition live via the settings watcher.

The official in-process subagent tools are base-bundle-owned and stay outside the switch: OFF leaves only them, ON adds `subagent_dsh` alongside them — two coexisting delegation shapes with different semantics (in-process continuable vs. separate CLI process), which the family tool description ('separate process, its own scoped home') makes distinguishable.

## How delegation works

1. The provider generates one uuid (`session-<uuid>`), records the delegation (`childSessionId → cliSessionId` identity mapping), and spawns
   `dsh --profile headless-local-agent-dsh --session-id <uuid> "<task>"` with `env: { DSH_HOME: <scoped home>, DEEPSEEK_API_KEY: <resolved> }` and the parent session's cwd.
2. The sub-dsh headless bundle (`@khorsheed/dsh-local-agent-dsh-headless`) creates a session with exactly that id, runs the task, prints the final assistant text, and exits 0/1.
3. A later round passes the child session id as `resume`; the provider resolves the delegation and spawns `--resume <uuid>`; the sub-dsh resumes the same session via `agents.resume`.

The sub-dsh session id is caller-supplied, never parsed from stdout — sub-dsh stdout stays format-pure.

## Auth

No device-code login: the sub-dsh authenticates through the parent's `DEEPSEEK_API_KEY` credential (the `apiKeyRef` config, default `DEEPSEEK_API_KEY`). `/dsh login` reports the harness has no login flow; `/dsh status` reports whether the credential resolves; `/dsh sessions` lists the sub-dsh's own sessions from its scoped-home store (never the parent's session list).

## Sub-profile provisioning

The sub-dsh profile lives under the scoped home (`profiles/headless-local-agent-dsh`): a manifest (`@deepseek-ai/dsh-base` + the family headless bundle), an empty user layer, and one symlink resolving the headless bundle. Everything else (dsh-base and its whole dependency graph) resolves from the dsh installation anchor, so provisioning costs no pnpm install and is idempotent. The parent replicates its own launch (`node --import tsx … bin.ts`, or a configured `cliLaunch`) so the sub-dsh runs the same dsh build as its parent.

## Config

| field | default | meaning |
| --- | --- | --- |
| `profileName` | `headless-local-agent-dsh` | sub-dsh profile under the scoped home |
| `apiKeyRef` | `DEEPSEEK_API_KEY` | credential reference the sub-dsh resolves |
| `cliLaunch` | parent's own launch | dsh launch argv prefix override |
| `headlessBundleDir` | resolved from installation | headless bundle directory for the sub-profile symlink |
