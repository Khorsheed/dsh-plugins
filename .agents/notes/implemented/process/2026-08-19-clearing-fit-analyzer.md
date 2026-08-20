# Agent Note: Clearing-fit analyzer — gate the clearing strategy on measured workload shape

Status: implemented

English | [中文](2026-08-19-clearing-fit-analyzer.zh.md)

## Problem

A continuous tool-result clearing plugin (Anthropic `clear_tool_uses`-style: replace old tool results with placeholders beyond a keep window) trades one KV-prefix invalidation per clearing event for a smaller prompt on every subsequent call. Whether that trade pays off depends entirely on the deployment's workload shape: how concentrated spend is in long sessions, how much of the context is tool results at all, and how many calls remain after the trigger crossing. Shipping the plugin with no admission check would push a cache-breaking strategy onto deployments where it is a pure loss, and there was no way to know which side of the line any given deployment sits on.

## Decision

`scripts/analyze-clearing-fit.ts` (spec alongside) reads a deployment's session logs (`session.jsonl[.zstd]`, decoded with the pure-JS `fzstd`, no native dependency) and reports the answer before anyone enables the strategy. Per session it replays surface ops to measure peak context size, tool-result share and count at that peak, the clearable volume given a `keep` window, and the measured calls after the trigger crossing (S). It then prices each session against the break-even model derived from the official post-2026-08-17 deepseek-v4-flash prices: one event costs the surviving prefix times (miss − hit), each later call saves the freed volume times hit, so payback needs `n* = C'(m−r)/(F·r)` calls; a session is net-positive when its measured S exceeds 2×n*. The aggregate verdict is ENABLE when net-positive sessions carry ≥30% of total cache-read spend, plus a suggested `clearAtLeast` floor computed from the median eligible context at a conservative S=100. Defaults: 1M window, 0.4 trigger ratio, keep 15, off-peak prices $0.007/$0.22 per 1M (peak prices share the miss/hit ratio, so the verdict is peak/off-peak invariant). The 2026-08-19 run against the production profile (`~/.dsh-official/sessions`, 165 sessions) returned ENABLE: 6 net-positive sessions carry 81% of cache-read spend, payback 44–112 calls against measured S of 130–5320, suggested clearAtLeast ≈ 153K tokens.

## Alternatives considered

- **Ship the plugin without an admission check** — rejected: the same mechanism that saves money on concentrated, tool-heavy workloads breaks caches for nothing on small or reasoning-dominated ones; a wrong-fit enable is a pure loss and hard for a user to diagnose after the fact.
- **Reuse the harness session/persistence packages for replay** — rejected: the script must run against any `$DSH_HOME/sessions` tree without a harness checkout, so it decodes the JSONL/zstd format directly and re-implements the twenty lines of surface replay it needs; the format is versioned and the script fails loudly per file rather than silently misreading.
- **Shell out to the `zstd` CLI** — rejected: not installed by default on macOS/Linux dev machines; `fzstd` is pure JS and verified against multi-frame production logs.

## Consequences

- The script is repo tooling today; when the clearing plugin ships, the analyzer ships with it (package `scripts/` or a documented `tsx` invocation) as the recommended pre-enable check, and this note's measured defaults seed the plugin's config documentation.
- Estimates are heuristics, not billing: context size is chars/4, event count is modeled as one per session, and S is measured from history — all three bias conservative (real savings grow with session length; a cold cache makes events free). The script prints its model so users can re-price with their own `--hit-price`/`--miss-price`.
- Reasoning content (the other ~60% of this deployment's wire context, locked by DeepSeek's thinking-mode passback rule) is outside the strategy's reach; the analyzer's tool-share column makes that ceiling visible per deployment instead of letting users expect savings it cannot deliver.
