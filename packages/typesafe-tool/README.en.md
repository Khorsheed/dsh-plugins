# @khorsheed/dsh-typesafe-tool

English | [中文](README.md)

"Does this need a reply? Whose desk is it on? How urgent?" — ask those semantic calls in one batched tool call and get typed, confidence-scored answers back, not prose you have to re-parse.

Every agent run hits judgements ordinary code cannot make, and until now the way out was either guessing or a fragile prompt-and-parse step written on the spot. This package wraps TypeSafe (System One / Jev) fast judgements as the model-facing `typesafe_judge` tool and grants it **per session**, together with its guidance and skill — only sessions of an agent preset whose composition names this row see it. It is the companion tool row of [`@khorsheed/dsh-typesafe`](https://www.npmjs.com/package/@khorsheed/dsh-typesafe): the service (`ctx.typesafe`) stays in the core; this row mounts into presets, never at the profile root.

## Features

- **Batch every question into one call** — `typesafe_judge` takes a piece of `state` plus 1–32 narrow questions: `noul` (a yes/no probability), `choice` (one option out of a defined set), `score` (a level on an ordered scale). It returns compact text, one line per question: a two-decimal probability for noul; the answer plus `confidence` and the full distribution for choice/score.
- **Tool, guidance and skill move together** — the prompt section `typesafe:judge` (when to use it, how to batch, how to read answers, **never build a CLI or wrapper process for TypeSafe**) and the `typesafe-decide` skill (question design and discipline) are granted alongside the tool.
- **Granted per session** — the grant is a preset's `agent.cordis.yml` naming this row; sessions of presets that do not name it are completely unaffected.
- **Degrade, don't explode** — with the core absent the row is a no-op plus one log line: the preset composition still mounts, the model simply sees no tool. Registration goes through deferred `ctx.inject`, so mount order can never strand the row.
- **Clear attribution** — the tool's origin tag names **this** package (owner `@khorsheed/dsh-typesafe-tool`) and appears under 插件 in 「工具与技能」.
- **The key has an input field** — the skill declares `metadata.credentials`, so `TYPESAFE_API_KEY` gets a password field in 「设置 → 工具与技能」 instead of a hand-edited config file.

### Model-side usage

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

On success the first line carries the model, latency, cache hit and token usage, then one line per question; on failure the tool returns an honest sentence (which credential or network dependency is missing) instead of inventing an answer.

## Install

The core installs globally as before (the service lives at the profile root); the companion only needs to be resolvable in the profile's node_modules — it **never self-mounts**:

```sh
dsh plugin --profile web add @khorsheed/dsh-typesafe
dsh plugin --profile web add @khorsheed/dsh-typesafe-tool
```

Then name the row in the target preset's `agent.cordis.yml`:

```yaml
- id: typesafe-tool
  name: '@khorsheed/dsh-typesafe-tool'
```

Composition changes take effect after restarting the web instance. To uninstall:

```sh
dsh plugin --profile web remove @khorsheed/dsh-typesafe-tool
```

Removing only breaks module resolution — remember to delete the referencing row from every preset's `agent.cordis.yml` at the same time, or those preset compositions report broken (the instance boot is unaffected, but this is not a silent degrade).

**Config** (optional, set on the preset row): with `tools: false` the row grants nothing at all — tool, guidance section and skill move together, because guidance about an absent tool is a wrong instruction rather than a harmless one.

## The key

Before first use, fill `TYPESAFE_API_KEY` once under 「设置 → 工具与技能 → typesafe-decide → 凭据配置」 (or put it in `$DSH_HOME/.env` and restart). The declaration rides this package's skill and writes the host credential store; the core re-resolves it per call.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/typesafe-tool-credentials.png" width="640" alt="the typesafe-decide credential entry under Settings → Tools &amp; Skills: the TYPESAFE_API_KEY password field">

> Note: `metadata.credentials` is the capability-catalog convention, so the value is also injected into bash executions as `DSH_TYPESAFE_API_KEY` (hidden by default, but a model that echoes it would expose it). Prefer the `.env` path if that is not acceptable.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`): ✅ complete — the tool registers into the host tools registry and contributes its prompt section and runtime skill; 0.1.5's plugin list shows this row under the per-preset session plugins. With the core absent the row still mounts and registers nothing (one log line).
- source line (deepseek-harness master): ✅ (verifiedHost: 0.1.5-rc.1) — `ctx.get` probing plus `ctx.inject(['tools'|'systemPrompt'|'skills'])` are long-standing seams and none has been renamed. Hosts below 0.1.5 are unverified; minHost is pinned at `0.1.5-rc.1`, the same tier as the worktrees-tool / room-tool / datasets-tool companion rows.

**Version line mapping**: `0.1.0` supports host `0.1.5-rc.1` and later.

## Known Limitations

- **Grants only, brings no service** — this row does not provide `ctx.typesafe`; without the core (`@khorsheed/dsh-typesafe`) the tool appears in no session, and the whole row is a no-op plus one log line.
- **Reference and install must move together** — a preset naming an unresolvable row reports that preset composition broken instead of degrading silently; install, uninstall and `agent.cordis.yml` edits go together.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**A companion that never self-mounts.** The row registers tools and publishes no service (`ctx.provide` is zero) — the preset-mount isolate-realm rule rejects service rows only, so a tool row composes bare, exactly like the official `tool-bash` rows. The package declares no `dsh.bundle`: installing it as a dependency only makes the module resolvable (a plain dependency) and mounts nothing. The core package is named as data only, in the manifest's `dsh.references` — never imported, never a dependency edge; at apply time the row probes `ctx.get('typesafe')` structurally. The two packages therefore cannot disturb each other's build order, and `pnpm check:plugins` needs no new cross-package edge.

**Every registration goes through deferred injection.** `ctx.inject(['tools'])` registers `typesafe_judge` — a direct `ctx.get('tools')` at apply time races the registry's own mount order and loses, silently never registering (the mount-order race learned the hard way); `ctx.inject(['systemPrompt'])` contributes the `typesafe:judge` section (order 152); `ctx.inject(['skills'])` registers the shipped `skills/typesafe-decide/SKILL.md` (source `runtime`, provider this package's name; a missing or malformed file warns once, never fails boot) and borrows the skill's `metadata.credentials` to give the key a password field in 「工具与技能」.

**Defensive input, compact rendering.** An empty question list, more than 32 questions, duplicate ids, a `choice` without `choices` or a `score` without `levels` are rejected with the reason before the service is ever called — anything on the wire is read as unknown input. Answers render as compact text the model can consume directly: a header line `model latencyMs [cached] [tokens=in/out]`, then one line per question (a two-decimal probability for noul; the answer — with the level label for score — plus `confidence=` and the full distribution for choice/score); a failure renders one sentence and explicitly tells the model not to retry blindly and not to fake the answer.

**Exports.** The entry exports `apply` / `inject` / `Config` / `name`, plus the pure functions `typesafeJudgeTool`, `formatResult`, `toSeamQuestions` and `parseJudgeArgs` (the test surface); there is no browser half.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/typesafe-tool`). Issues and contributions welcome there.
