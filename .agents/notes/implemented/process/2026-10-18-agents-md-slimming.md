# Agent Note: AGENTS.md carries rules only; rationale lives in the owning docs

Status: implemented

## Problem

The repo-root AGENTS.md is injected verbatim into every session by the host's agent-instructions package (`Instructions from: …/AGENTS.md`), persists in session history, and rides every request until compaction — after which the host re-injects it by design. It had grown to 20,852 bytes of mixed rules, incident narratives, and mechanism explanations, so every session in this repo paid for the full text repeatedly (surfaced by the context-lens history view showing a ~20.7k plugin-injection entry per baseline). Much of the bulk duplicated what docs/development.md, docs/ops.md, docs/panel-design.md, docs/plugin-visibility.md, docs/publishing.md, and the checker scripts already own — the file pointed at those docs while restating their content.

## Decision

AGENTS.md keeps every operative rule and every section name (scripts and Agent Notes reference "Package conventions", 「推送与分支保护」, 「构建卫生」, etc.) but drops rationale, incident history, and mechanism prose. One fact per rule, one pointer per deep topic; the checkers (`check:plugins`, `check:panels`, `check:hygiene`) remain the mechanical enforcers, and the paired docs remain the authority for rationale. Cut content was verified to have a home before removal: incident narratives live in their Agent Notes (e.g. 2026-10-17-host-021-invariant-sweep, 2026-09-30-local-agent-tool-fold), enforcement detail in `scripts/check-plugin-independence.ts`, procedures in docs/. Result: 20,852 → 13,314 bytes (-36%).

## Alternatives considered

- **Shrink the host injection budget (`maxBytes`).** The host truncates by omitting the broadest instruction files first, which would drop the deployment-global `$DSH_HOME/AGENTS.md` before touching this file, and degrades every project uniformly. Rejected: the problem was this file's size, not the budget.
- **Split AGENTS.md into per-topic instruction files.** The host's discovery candidates are fixed (`AGENTS.md`/`CLAUDE.md` plus local overlays); split files would simply never be injected. The split that works is the one taken: rules here, rationale in docs/.
- **Do nothing and rely on compaction.** Compaction eventually shadows the baseline, but the host re-injects it by design, and every pre-compaction request pays full price regardless.

## Consequences

Every session in this repo carries ~7.5k fewer bytes of injected instructions, and the post-compaction re-injection gets proportionally cheaper. Cost: agents must follow the doc pointers for rationale, and the file is denser to read — acceptable, since its audience is agents executing rules. The deployment-global `$DSH_HOME/AGENTS.md` (~4k) is a separate, smaller target and was left alone. The context-lens log-reconstruction lane not applying compaction shadowing (making the re-injected baseline display as a ×2 duplicate) is a viewer-side gap, unrelated to this change and still open.

## Related

- [Development base is the latest local HEAD, not origin/main](2026-10-12-base-on-latest-head.md)
