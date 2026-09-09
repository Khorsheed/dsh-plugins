# dsh-local-agent-tool-subagent

> Delegation that remembers — resume a subagent's CLI conversation instead of starting cold.

English | [中文](README.md)

The [local-agent family](../local-agent/README.md)'s own delegation tool: each harness bundle mounts it in place of the official `@deepseek-ai/dsh-tool-subagent` row, keeping the same `toolName` (`subagent_kimi`, `subagent_codex`, `subagent_claude_code`) while adding resumable delegation.

## Features

- **Drop-in replacement** — same `toolName` as the official subagent tool; presets and prompts are unchanged.
- **Resumable delegation** — one optional `resume` parameter continues the same CLI conversation in a later round, in the same dsh child session.
- **Secure by construction** — the resume handle travels only as a parameter; one smuggled into the prompt is ignored, a forged one is rejected.
- **Scope isolation inherited** — the tool spawns nothing; the CLI runs under the harness bundle's scoped home.
- **Registration switch** — `tools: none` mounts the row without its model-visible tool; the provider and its slash verbs stay.

## Install

Not installed directly: each harness bundle declares this package as a dependency and mounts its tool row. Install any harness bundle:

```sh
dsh plugin --profile web add @khorsheed/dsh-local-agent-kimi
```

Removing the harness bundle unregisters the tool row:

```sh
dsh plugin --profile web remove @khorsheed/dsh-local-agent-kimi
```

Removing this package alone is not supported — the harness bundles require it.

## Configuration

| Key | Values | Default | Meaning |
|---|---|---|---|
| `provider` | string (required) | — | the `ctx.subagents` provider to start runs on (e.g. `kimi-cli`) |
| `toolName` | string | `subagent` | the model-visible tool name; distinct per loaded row |
| `tools` | `all` \| `none` | `all` | whether this row registers its model-visible tool |

`tools: none` trims that one model-visible tool and nothing else. The provider row still
mounts, and `/codex login`, `/kimi status` and the `ctx.localAgent` service face all live in
the provider package — so an orchestrator that drives the CLIs through the service face is
untouched by this switch; only the model in a session is.

Two values rather than a group list: each loaded row registers exactly **one** tool, so there
is nothing to group (`datasets` and `mission` have graded `tools` groups because they register
a dozen each).

The switch has to live here rather than in an agent preset: this row mounts at the **profile
root**, and a preset selects among registered tools without being able to subtract one. That
is how an evaluation composition takes the host-CLI execution path away from the model while
keeping those same CLIs available to the orchestrator through the service face (see
`profiles/web-eval`'s «工具按域开放»).

```yaml
- id: tool-subagent-kimi
  name: '@khorsheed/dsh-local-agent-tool-subagent'
  config:
    provider: kimi-cli
    toolName: subagent_kimi
    tools: none
```

A patch layer's `config` is a whole-value **replace**, not a deep merge, so an override of this
row restates `provider` and `toolName` alongside it — `provider` is required, and dropping it
fails the whole composition at schema validation.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.2-rc.1`): ✅ full — baseline moved to the 0.1.2-rc.1 API surface (single-arm 0.1.2 API consumption; the 0.1.1-rc.2 runtime arm is retired), full build+test green; minHost moves up to 0.1.2-rc.1 — older hosts stay on the previous release line.
- source line (deepseek-harness master): ✅ (verifiedHost: 0.1.2-rc.1)

## Known Limitations

- Not installable or removable standalone — it exists only as a dependency of the harness bundles, which mount its tool row.
- Requires the family core (`@khorsheed/dsh-local-agent`) to be installed alongside a harness bundle (see the bundle READMEs).

## How it works

<details>
<summary>Internals (click to expand)</summary>

**Tool schema.** The official subset (`description`/`prompt`) plus one optional parameter: `resume?: string` — the dsh child session id returned by the first delegation's result text.

**Fresh vs resumed calls.** A fresh call stages a fresh intent and starts a one-shot delegation exactly like the official tool. A resumed call resolves the handle through the `localAgent` service before any CLI starts, then runs the provider's resume command (`kimi -S session_<id> -p`, `claude -p --resume <id>`, `codex exec --json resume <thread_id>`) inside the same dsh child session, appending a round with its own `turn/start`/`turn/end` pair and usage. Continuation rounds still go through `ctx.subagents.start()`, so lifecycle events and the standard 子代理 surface are unchanged.

**Security.** Task text is untrusted: the tool only reads the `resume` parameter, and the registry resolves a handle only for the parent session and provider that recorded the delegation — a smuggled handle is ignored, a forged one rejected. The handle cannot ride the `subagent/descriptor` either (its schema is strict; unknown fields throw), so the resolved target travels through the `localAgent` service's delegation registry and per-(parent, provider) intent queue.

**Scope isolation.** The tool spawns nothing; it resolves and stages through the `localAgent` service and delegates to the harness provider, which runs the CLI under the harness's scoped home (`KIMI_CODE_HOME` / `CODEX_HOME` / `CLAUDE_CONFIG_DIR`).

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/local-agent-tool-subagent`). Issues and contributions welcome there.
