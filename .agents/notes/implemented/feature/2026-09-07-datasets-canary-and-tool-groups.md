# Agent Note: datasets canary field and tool-group registration

Status: implemented

English | [中文](2026-09-07-datasets-canary-and-tool-groups.zh.md)

## Problem

Two eval-domain needs that the dev domain must not notice.

**Leak forensics.** A benchmark dataset's usefulness ends the moment it enters a model's training corpus, and today nothing tells the authors when that happened. Terminal-Bench's answer is a canary: bury one globally unique string in every visible file of the suite, then search model output for it later. The mechanism costs almost nothing — the expensive part is the discipline of never letting a visible file miss the string, which is exactly what an author cannot verify by hand across a growing suite.

**Tool boundaries per domain.** In [dsh-web-eval](../../../../profiles/web-eval/README.md) an agent exists only during planning and analysis: it reads the suite, it drafts items, and everything that executes is the orchestrator's. It must therefore not hold `datasets_worktree_path` — materializing a whole layer is a step the orchestrator owns. A preset cannot express that: presets narrow what a scope may reach, but a tool the profile registered exists for every agent in that profile. The only place that can decide is the registration itself, which means the plugin.

## Decision

Both land in `@khorsheed/dsh-datasets` with `all`-tier behavior byte-identical to before.

**`canary`** is an optional `dataset.json` string, shape-checked as non-empty (the recommended shape, `dsh-canary:<dataset-id>:<uuid>`, is protocol advice, not a validated pattern). Declaring it turns on one new `validate` warning, `CANARY_MISSING`: every text file of a `modelFacing: true` layer must contain the string verbatim, and each file that does not gets its own warning naming the file and the layer that made it visible. The scope is deliberately narrow in four directions — a dataset that declares no canary is never checked; sensitive layers and `item.json` are out of scope (they never reach a model through this plugin); "text" is an extension whitelist (`md` / `txt` / `yml` / `yaml` / `json`, plus extensionless files) rather than content sniffing; and a register-mapped file is judged by its **role** layer, not by where it physically sits, so the register's decoupling of location from role holds here too.

This is the only rule in the plugin that reads file content, so it runs on the `validate` path alone — `descriptorWarnings` (the shape-level rule that rides every `list`/`show` summary) stays synchronous and cheap. `canaryWarnings` lives in `dataset.ts` next to the other warning rules and reads through the same git-object path as everything else; nothing materializes.

**`tools: 'all' | 'read' | 'authoring' | 'none'`** (default `all`) is a containment chain: `read` = the six read verbs, `authoring` = read + `datasets_put_item`, `all` = authoring + `datasets_worktree_path`, `none` = nothing. Definitions stay unconditional and origin-tagged; only `ctx.tools.register` is gated, by a `registerTool` helper reading the group's name set. The `datasets:tools` prompt section is built from the same set — it names `datasets_worktree_path` and `datasets_put_item` only when they exist, and is not contributed at all under `none`, because guidance about an absent tool is a wrong instruction rather than a harmless one. At `all` the assembled text is byte-identical to the previous fixed string.

The service, the `dsh-datasets` CLI, `/datasets` and the session tab are outside the grouping by construction: they are the human's faces, and the boundary being drawn is the agent's. The eval domain's recommended setting is `authoring`.

## Alternatives considered

- **Generating or injecting the canary from the plugin** (a `datasets canary init` verb writing the string into every visible file) — rejected: the plugin never interprets dataset semantics and never writes content it was not handed. Minting a token and embedding it are authoring acts with git review attached; checking is the part a machine does better, and the check alone already makes the discipline enforceable.
- **Sniffing text vs. binary by content** (a NUL-byte or UTF-8 probe instead of an extension whitelist) — rejected: it would read every file in the suite to classify it, and its failure mode is the bad one — a fixture that happens to look textual gets a warning the author cannot act on. The whitelist can only under-cover, and under-coverage is visible to the author who chose the extension.
- **Warning when a dataset declares no canary at all** — rejected: it would fire on every existing dataset, which is precisely the "zero new warnings on the current suite" bar this change had to clear. The field is opt-in and its absence is a legitimate choice.
- **Checking `item.json` too** (it is always visible) — rejected: it is metadata under a declared schema, not suite content; requiring a canary in it would push authors to pad a structured document with a comment field it has no place for. `FIELD_NAME_SENSITIVE` already owns the item.json hygiene rule.
- **An explicit list of tool names in the config** (`tools: ['datasets_list', …]`) — rejected: it makes every profile re-derive the read/write boundary, and it silently rots on a rename or a new tool. Named groups mean a new tool joins a tier once, in the package that knows which tier it belongs to.
- **A `readOnly: boolean` flag** — rejected: two of the three interesting boundaries here are not "does it write" (`put_item` writes the working tree yet belongs in an authoring domain; `worktree_path` writes only a cache yet is the orchestrator's action). A boolean would have to lie about one of them.
- **Leaving the prompt section fixed across tiers** — rejected: telling a model to consume whole layers through a tool it does not have produces a failed call and a confused recovery, and the section is cheap to assemble from the same set that gated registration.

## Consequences

- Default deployments are unchanged: eight tools, the same prompt text, and no canary check until a descriptor opts in. `pnpm check:plugins` and the existing suites confirm the shape.
- `validate` on a canary-declaring dataset costs one `git show` per visible-layer text file. That is the price of a content-level check; it stays off the summary path, so `list`/`show` remain as cheap as before.
- The authoring protocol moves to **v1-rev3** in both languages: §2 gains the `canary` field (with the example descriptor now declaring one, so the doc's own example is the validator's fixture) and §5 gains the `CANARY_MISSING` entry.
- A profile that sets `tools: 'none'` keeps a fully working human surface — the plugin degrades to CLI/tab/slash rather than to nothing, which is what makes the tier safe to set.
- Composing `tools: 'authoring'` into the web-eval profile is a separate change; this one only makes the setting exist and documents the recommendation.

## Testing

`packages/datasets/tests/` — 99 tests over 14 files green. New: `tools-group.spec.ts` (the default's eight tools plus the prompt naming both write verbs; `read` / `authoring` / `none` tool sets and the clauses their prompts drop; `none` contributing no section while the service and slash command survive; the containment chain over `toolsOfGroup`), and a canary block in `validate.spec.ts` over a fixture holding one file of every case the check must separate — dataset-level and item-level visible layers, a register-mapped file at the item root, an extensionless file, a hidden layer, `item.json`, and two non-text files: no canary declared → never checked, all present → silent, two files stripped (one layer file, one register-mapped) → exactly those two reported with the visible layer named, hidden layer and `item.json` stripped → still silent. `protocol.spec.ts` now pins the doc example's canary shape, so the field cannot fall out of the protocol document unnoticed.

## Cross-references

- [datasets governance and authoring](2026-08-24-datasets-governance-and-authoring.md) — owns `validate`, the three existing warnings, the register role model and the protocol document this change extends.
- [dsh-web-eval](../../../../profiles/web-eval/README.md) — the "tools per domain" table this grouping implements for datasets.
