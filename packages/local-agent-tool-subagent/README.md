# dsh-local-agent-tool-subagent

> Delegation that remembers — resume a subagent's CLI conversation instead of starting cold.

English | [中文](README.zh.md)

The family-owned delegation tool of the [local-agent family](../local-agent/README.md). Each harness bundle mounts this tool in place of the official `@deepseek-ai/dsh-tool-subagent` row, keeping the same model-facing `toolName` (`subagent_kimi`, `subagent_codex_local`, `subagent_claude_code_local`) so presets and prompts keep working — while adding the family's own continuation: a delegated CLI conversation can be picked up again in a later round, in the same dsh child session.

## Features

- **Drop-in replacement** — same `toolName` as the official subagent tool, so presets, prompts, and the standard 子代理 surface are unchanged.
- **Resumable delegation** — one optional `resume` parameter continues the same CLI conversation in a later round, inside the same dsh child session, with its own turn and usage accounting.
- **Secure by construction** — the resume handle travels only as a parameter, never inside task text; a handle smuggled into the prompt is ignored and a forged one is rejected by the delegation registry.
- **Scope isolation inherited** — the tool spawns nothing itself; the CLI runs under the harness bundle's scoped home.

## Install

Not installed directly: each harness bundle (`@khorsheed/dsh-local-agent-kimi`, `-codex`, `-claude-code`) declares this package as a dependency and mounts its tool row in its own patch. Install a harness bundle and this tool row comes along:

```sh
dsh plugin --profile web add @khorsheed/dsh-local-agent-kimi
```

The family core (`@khorsheed/dsh-local-agent`) must also be installed (see that bundle's README).

Removing the harness bundles unregisters their tool rows:

```sh
dsh plugin --profile web remove @khorsheed/dsh-local-agent-kimi
```

Removing this package alone is not a supported configuration — the harness bundles require it.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.1-rc.1`): ✅ full — the rc.8→0.1.1-rc.1 API audit (2026-08-21) confirms every surface this plugin consumes is unchanged or additive (the ProjectionDefinition restructure, cacheHitPercent return-type change, and the credentials/updated event rename do not touch this package); no source change was needed.
- source line (deepseek-harness master): ✅

## Known Limitations

- Not installable or removable standalone — it exists only as a dependency of the harness bundles, which mount its tool row.
- Requires the family core (`@khorsheed/dsh-local-agent`) to be installed alongside a harness bundle (see the bundle READMEs).

## How it works

<details>
<summary>Internals (click to expand)</summary>

**Tool schema.** The official subset (`description`/`prompt`) plus one optional parameter: `resume?: string` — the dsh child session id returned by the **first delegation's result text**, used to continue the same CLI conversation in a later round.

**Fresh vs resumed calls.** A fresh call stages a fresh intent and starts a one-shot delegation exactly like the official tool. A resumed call (with `resume`) resolves the handle through the `localAgent` service before any CLI process starts, then runs the provider's resume command (`kimi -S session_<id> -p`, `claude -p --resume <id>`, `codex exec --json resume <thread_id>`) inside the **same** dsh child session, appending the new round with its own turn (`turn/start`/`turn/end` pair, usage on that round's assistant message). Continuation rounds still go through `ctx.subagents.start()`, so `subagent/start`/`subagent/end` lifecycle events and the standard 子代理 surface are unchanged.

**Security: the handle never rides the prompt.** Task text is untrusted: a model that smuggles a handle into the prompt is ignored (the tool only reads the `resume` parameter), and a forged `resume` value is rejected by the registry, which resolves the handle only for the same parent session and provider that recorded the delegation. Embedding the handle in the prompt would let task text hijack another conversation's context; the tool refuses that shape by construction.

**Carrier: the `localAgent` service, not the descriptor.** The subagent request descriptor schema (`subagent/descriptor`) is strict — one-shot keys are `version`/`mode`/`provider`/`label`, and unknown fields throw — so the resume target cannot ride the descriptor. The family instead passes the resolved target through the `localAgent` service's delegation registry (child session id → CLI session id) and its per-(parent, provider) intent queue — the same infra a future stop registry will share.

**Scope isolation.** The tool spawns nothing itself; it resolves and stages through the `localAgent` service and delegates to the harness provider, which runs the CLI under the harness's scoped home. The tool therefore inherits the harness bundle's `KIMI_CODE_HOME` / `CODEX_HOME` / `CLAUDE_CONFIG_DIR` isolation.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/local-agent-tool-subagent`). Issues and contributions welcome there.
