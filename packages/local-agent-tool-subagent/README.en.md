# dsh-local-agent-tool-subagent

> Delegation that remembers — resume a subagent's CLI conversation instead of starting cold.

English | [中文](README.md)

The [local-agent family](../local-agent/README.md)'s own delegation tool: each harness bundle mounts it in place of the official `@deepseek-ai/dsh-tool-subagent` row, keeping the same `toolName` (`subagent_kimi`, `subagent_codex_local`, `subagent_claude_code_local`) while adding resumable delegation.

## Features

- **Drop-in replacement** — same `toolName` as the official subagent tool; presets and prompts are unchanged.
- **Resumable delegation** — one optional `resume` parameter continues the same CLI conversation in a later round, in the same dsh child session.
- **Secure by construction** — the resume handle travels only as a parameter; one smuggled into the prompt is ignored, a forged one is rejected.
- **Scope isolation inherited** — the tool spawns nothing; the CLI runs under the harness bundle's scoped home.

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

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.1-rc.1`): ✅ full — the rc.8→0.1.1-rc.1 API audit (2026-08-21) confirms every surface this plugin consumes is unchanged or additive (the ProjectionDefinition restructure, cacheHitPercent return-type change, and the credentials/updated event rename do not touch this package); no source change was needed.
- source line (deepseek-harness master): ✅

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
