# Agent Note: making "默认" self-explanatory (catalog default + last-observed)

Status: implemented

English | [中文](2026-09-13-model-default-visibility.zh.md)

## Problem

On prod a codex member's composer chip showed a bare 默认 and the settings card couldn't say what the CLI default actually is; claude members would show 默认 forever (claude has no enumeration surface, deliberately). Two honest data sources were going unused: codex's `model/list` marks the account's built-in default with `isDefault` (verified live: gpt-5.6-sol), and every provider's delegation records carry `observedModel` — what actually ran last.

## Decision

**Core surface.** `LocalAgentModelInfo` gains `lastObserved` — the newest `observedModel` across the harness's in-memory delegation records (`latestObservedModel(provider)`, recency via an in-memory monotonic stamp rather than a schema change to `delegations.jsonl`). The gateway fills it: `memberModel` from the member's own record, `harnessModel` from the latest across the provider. The `cli-builtin` source doc now says: names nothing by itself, but a catalog may name it and records show what last ran.

**Codex.** The catalog probe keeps the first `isDefault` slug (hidden entries included — hidden means unlisted, not unrunnable); the broker's layer order becomes override → delegation → settings → scoped-config → catalogDefault, and when the catalog supplies the answer the source is `cli-builtin` WITH `effective` set (the one case that layer names a model). A 1.5s post-apply warmup (unref'd, cleared on dispose) kicks the probe so the first settings-card open usually hits a warm cache — the "codex takes a while to get its list" complaint.

**UI.** The composer chip shows effective when present (codex now names gpt-5.6-sol), else `默认（最近 <model>）` from lastObserved, else bare 默认. All four settings cards walk the same chain in BOTH the placeholder and the effective line: settings → scoped-config → catalog-named CLI default → last-observed builtin → bare builtin. Claude gets no list (no honest source exists) but after any run both surfaces say 默认（最近 …） — an empirical answer instead of a mystery.

## Alternatives considered

**Persist a timestamp on delegation records for recency.** Rejected: a `delegations.jsonl` schema change for a display nicety; the in-memory stamp preserves last-line-wins on boot replay.

**Give claude a catalog from binary-embedded constants.** Rejected (again): not a supported surface.

## Consequences

"默认" is self-explanatory on every surface that can know it. Costs: one background app-server spawn 1.5s after boot (codex), one monotonic map per registry. Tests: core +9 (delegation 4, gateway 5), codex +10 (catalog 3, broker 3, apply 1, card 3), composer +3, kimi card +1.
