# `@khorsheed/dsh-local-agent-tool-subagent`

English | [中文](README.zh.md)

The family-owned delegation tool of the [local-agent family](../../local-agent/local-agent/README.md). Each harness bundle's patch mounts this tool instead of the official `@deepseek-ai/dsh-tool-subagent` row, with the same model-facing `toolName` (`subagent_kimi`, `subagent_codex_local`, `subagent_claude_code_local`), so presets and prompts keep working while the tool adds the family's own continuation.

## What the tool does

The tool schema is the official subset (`description`/`prompt`) plus one optional parameter:

- `resume?: string` — the dsh child session id returned by the **first delegation's result text**, to continue the same CLI conversation in a later round.

A fresh call stages a fresh intent and starts a one-shot delegation exactly like the official tool. A resumed call (with `resume`) resolves the handle through the `localAgent` service before any CLI process starts, then runs the provider's resume command (`kimi -S session_<id> -p`, `claude -p --resume <id>`, `codex exec --json resume <thread_id>`) inside the **same** dsh child session, appending the new round with its own turn (`turn/start`/`turn/end` pair, usage on that round's assistant message). Continuation rounds still go through `ctx.subagents.start()`, so `subagent/start`/`subagent/end` lifecycle events and the standard 子代理 surface are unchanged.

## Security: the handle never rides the prompt

The resume handle travels only as the `resume` parameter — **never** inside `prompt`. Task text is untrusted: a model that smuggles a handle into the prompt is ignored (the tool only reads the parameter), and a forged `resume` value is rejected by the registry, which resolves the handle only for the same parent session and provider that recorded the delegation. Embedding the handle in the prompt would let task text hijack another conversation's context; the tool refuses that shape by construction.

## Carrier: localAgent service, not the descriptor

The subagent request descriptor schema (`subagent/descriptor`) is strict: one-shot keys are `version`/`mode`/`provider`/`label` and unknown fields throw, so the resume target cannot ride the descriptor. The family instead passes the resolved target through the `localAgent` service's delegation registry (child session id → CLI session id) and its per-(parent, provider) intent queue — the same infra a future stop registry will share.

## Install

Not installed directly: each harness bundle (`@khorsheed/dsh-local-agent-kimi`, `-codex`, `-claude-code`) declares this package as a dependency and mounts its tool row in its own patch. Install a harness bundle and this tool row comes along; the family core (`@khorsheed/dsh-local-agent`) must also be installed (see that bundle's README).

## Uninstall

Removing the harness bundles unregisters their tool rows. Removing this package alone is not a supported configuration — the harness bundles require it.

## Scope isolation

The tool itself spawns nothing; it resolves and stages through the `localAgent` service and delegates to the harness provider, which runs the CLI under the harness's scoped home. The tool therefore inherits the harness bundle's `KIMI_CODE_HOME` / `CODEX_HOME` / `CLAUDE_CONFIG_DIR` isolation.
