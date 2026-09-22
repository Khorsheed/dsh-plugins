# @khorsheed/dsh-typesafe-tool

English | [中文](README.md)

The **companion tool row** of [`@khorsheed/dsh-typesafe`](https://www.npmjs.com/package/@khorsheed/dsh-typesafe):
the model-facing `typesafe_judge` tool, its guidance section, and the `typesafe-decide` skill — **granted
per session**, so it appears only in the sessions of an agent preset that names this row. The service
(`ctx.typesafe`) stays in the core; this row mounts into presets, never at the profile root.

## Shape: a preset-composed companion (no patch of its own)

- **Registers tools, publishes no service** (`ctx.provide` is zero) — the preset-mount isolate-realm rule rejects
  service rows only; a tool row composes bare, exactly like the official `tool-bash` rows.
- **No `dsh.bundle` declaration**: installing it as a dependency only makes the module resolvable and mounts
  nothing. The grant is a preset's `agent.cordis.yml` naming the row:

  ```yaml
  - id: typesafe-tool
    name: '@khorsheed/dsh-typesafe-tool'
  ```

- **The sibling is named as data only**: the core package appears in this package's manifest `dsh.references` and
  is **never imported** nor listed as a dependency edge. At apply time this row probes `ctx.get('typesafe')`
  structurally, so the two packages cannot disturb each other's build order and `pnpm check:plugins` needs no new
  cross-package edge.
- **Degrade, don't explode**: with the core absent the row is a no-op plus one log line — the preset's composition
  still mounts, the model simply sees no tool. Tool registration goes through `ctx.inject(['tools'])` (the mount-order
  race learned the hard way).
- The tool attributes to **this** package (origin tag owner `@khorsheed/dsh-typesafe-tool`) and appears under
  插件 in 「工具与技能」.

**Config** (optional): with `tools: false` the row grants nothing at all — tool, guidance section and skill move
together, because guidance about an absent tool is a wrong instruction rather than a harmless one.

## What the grant contains

| Face | Content |
|---|---|
| Tool | `typesafe_judge`: `state` plus 1–32 narrow questions (`noul` / `choice` / `score`), all answered in one call |
| Prompt section | `typesafe:judge`: when to use it, how to batch, how to read answers, and **never build a CLI or wrapper process for TypeSafe** |
| Skill | `typesafe-decide`: question-design guidance and discipline; it also declares `metadata.credentials`, which gives the key a password field in 「工具与技能」 |

## Model-side usage

```jsonc
{
  "state": "The server is down again and the customer is chasing us",
  "questions": [
    { "id": "needs_reply", "type": "noul", "instructions": "Does this message need someone to reply?" },
    { "id": "urgency", "type": "score", "instructions": "How urgent is this", "levels": ["can wait", "this week", "today"] },
    { "id": "topic", "type": "choice", "instructions": "Which topic", "choices": { "infra": "Server or deployment", "billing": "Payments and invoices", "other": "None of these" } }
  ]
}
```

The tool returns compact text, one line per question: a probability for noul; answer plus `confidence` and the full
distribution for choice/score. On failure it returns an honest sentence instead of inventing an answer.

## Install

```sh
# core at the profile root (the service lives there)
dsh plugin --profile web add @khorsheed/dsh-typesafe
# the companion only needs to be resolvable in the profile's node_modules (it never self-mounts)
dsh plugin --profile web add @khorsheed/dsh-typesafe-tool
# then add the row above to the target preset's agent.cordis.yml
```

## The key

Before first use, fill `TYPESAFE_API_KEY` once under 「设置 → 工具与技能 → typesafe-decide → 凭据配置」 (or put it
in `$DSH_HOME/.env` and restart). The declaration rides this package's skill and writes the host credential store;
the core re-resolves it per call.

> Note: `metadata.credentials` is the capability-catalog convention, so the value is also injected into bash
> executions as `DSH_TYPESAFE_API_KEY` (hidden by default, but a model that echoes it would expose it). Prefer the
> `.env` path if that is not acceptable.

## Compatibility

- **npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`)**: ✅ complete — the tool registers into the host tools
  registry and contributes its prompt section and runtime skill; 0.1.5's plugin list shows this row under the
  per-preset session plugins. With the core absent the row still mounts and registers nothing (one log line).
- **Source line (deepseek-harness master)**: ✅ (verifiedHost: 0.1.5-rc.1) — `ctx.get` probing plus
  `ctx.inject(['tools'|'systemPrompt'|'skills'])` are long-standing seams and none has been renamed.
- Hosts below 0.1.5 are unverified; minHost is pinned at `0.1.5-rc.1`, the same tier as the worktrees-tool /
  room-tool / datasets-tool companion rows.
- **Publish order**: a pack referencing this row must have the companion published/installed first; an unresolvable
  row makes that preset composition report broken (the instance boot is unaffected) rather than degrading silently.

**Version lines**: `0.1.0` supports host `0.1.5-rc.1` and later.
