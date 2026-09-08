# Agent Note: datasets validate checks judgeability

Status: implemented

English | [中文](2026-09-08-datasets-judgeability-validate.zh.md)

## Problem

Pilot A ran F3 to `released` on three cells and produced no F3 judgement at all. The cause was in the suite, not the orchestrator: `items/F3-self-restart-report/grading/rubric.yml` carried an `axes:` block and nothing else. Its prose companion `rubric.md` referred to `A1-1`, `A2-1`, `A-N1` and a dozen other leaf ids one by one, but those ids had never been written as structured rows.

Every judgement source reads LEAVES. The probes read `kind: objective` rows, the blind LLM judge is handed exactly the `kind: llm-draft` rows, the human bench takes the `kind: human` ones. With no rows at all, all three produce nothing: the orchestrator honestly records `judge-skipped` for each cell, `verdicts/` stays empty, and the cell cannot clear the non-empty archive gate. The run discovers this one cell at a time, after the expensive part.

`dsh-datasets validate` passed the whole time, because every rule it had was about the descriptor's shape and the suite's visibility hygiene. Whether a question can be judged is a fact about the ITEM, knowable from the repository alone before anything runs — the same class of fact as the canary, and the same argument for making it mechanical.

## Decision

`validate` gains a judgeability pass over each item, in `packages/datasets/src/rubric.ts`. It is opt-in on the judging layout: an item whose `grading` layer carries no rubric is not checked, so a dataset outside the convention reports byte-identically to before.

**Selection mirrors the orchestrator.** The rubric is the `grading`-layer display path whose filename is `rubric.yml` / `rubric.yaml`, shortest path first; probes are `.mjs` / `.sh` files under any `probes/` segment of the `verify` layer. Both rules are the ones `@khorsheed/dsh-eval` already applies when it assembles a judge prompt and enumerates probes, and both cover the two item layouts — the convention form (`grading/rubric.yml`, `verify/probes/x.mjs`) and the register form (`answers/rubric.yml`, `checks/probes/x.sh`), resolved through the register role map rather than the physical directory. The two sides must agree or this check would be validating a file the run never reads.

**Three error rules** (they fail the dataset and exit 1):

- `RUBRIC_NO_ITEMS` — `items` missing or empty. This is the F3 case, and the message says what the silence downstream will look like.
- `RUBRIC_FIELD_MISSING` — a leaf missing `id`, `axis`, `weight`, `kind`, `criterion` or `evidence` (`weight` a number, the rest non-empty strings). One error per leaf naming every field it lacks; a row that is not a mapping at all is reported at its position.
- `RUBRIC_KIND_INVALID` — a `kind` outside `objective` / `llm-draft` / `human`, which routes to no source.
- `RUBRIC_POLARITY` — `negative: true` and the `weight` sign disagreeing, in either direction. The verdict contract has one field for "the criterion holds" and polarity is data, sourced once from the rubric leaf; a leaf that states it twice and differently leaves every consumer to pick.

`RUBRIC_UNREADABLE` covers a rubric that is not readable YAML or cannot be read at the commit.

**Two warning rules** (they never block):

- `OBJECTIVE_NO_PROBE` — the item has `kind: objective` leaves but no executable probe. A probe is the only writer of an objective verdict, so this is the leafless-rubric silence again, one kind at a time. An `llm-draft` leaf counts as sourced the moment it exists, because the judge comes from the plan and the dataset side cannot see it; `human` is not checked because the bench is a person.
- `RUBRIC_REF_DANGLING` — `rubric.md` refers to a leaf id `rubric.yml` does not declare. The id shape (`A1-1`, `A-N1`, `B2-3`) is matched by a loose regex over prose, so false positives are possible and the rule only ever warns.

Both warnings are skipped when the rubric yielded no leaves: every reference would then be trivially dangling, and thirteen warnings would bury the one error that matters.

**The boundary with `dsh-eval validate`.** This side stops at what the repository knows. Whether a plan supplies a judge at all, and whether its `expectedNs` matches the item's judgement sources, is the plan's business and is checked there.

## Dependency and layer names

Two things this change had to settle rather than inherit.

**`js-yaml` joins the dependency chain.** Rubrics are YAML — that is the suite's shape, not one this package chooses — and the leaf rules need a real parse: the suite's rubrics use multi-line flow mappings, block scalars, and quoted scalars carrying colons. The README's standing "no YAML parser is available on this package's dependency chain" line is now retired, and it is retired honestly: descriptors staying JSON is a shape decision from here on, not a consequence of having no parser. The browser half does not pull it in (the client bundle still reports only `zod`).

**`grading` and `verify` are spelled literally.** Layer names are free everywhere else in this plugin, but the judging convention (authoring protocol §6.7/§6.8) is written in these two names and the orchestrator mounts exactly them. Making them descriptor-declarable would be a protocol change, and this package does not settle the protocol alone.

## Alternatives considered

- **Hand-rolling a small YAML subset reader to avoid the dependency** — rejected. The suite's rubrics already use multi-line flow mappings, `>-` block scalars, comments, and quoted scalars containing colons; a subset reader that mis-parses one of them reports errors an author cannot act on, or worse, passes a rubric that cannot be judged. The failure mode of a wrong parser is exactly the failure mode this check exists to remove.
- **Putting the check in `dsh-eval` instead** — rejected. `dsh-eval validate` sees a plan and the items it names; a rubric with no leaves is broken whether or not any plan ever references it, and the authoring loop that fixes it is `dsh-datasets validate` in the suite repository. Layering also runs the wrong way: eval depends on datasets.
- **Making `OBJECTIVE_NO_PROBE` an error** — rejected. The current suite is in exactly that state until the probes land, and an error would make `validate` red for a condition the authors already know and have scheduled. The distinction the codes draw is "this rubric cannot be judged at all" (error) versus "one of its sources is not built yet" (warning).
- **Warning when an item ships no rubric at all** — rejected, for the reason the canary rule was made opt-in: it would fire on every dataset outside the judging convention, and "this item has no rubric" is a legitimate state during authoring.
- **Checking that a leaf's `axis` resolves against the rubric's `axes` block** — rejected for now. The suite's two real rubrics disagree on what `axes` even is (a list of `{id, name, weight}` in one, a nested stage→subtotal map in the other) and their leaves' `axis` values do not index either. Enforcing a relation the protocol does not pin would invent a contract; the field is required to be present, and nothing more.
- **Reporting one error per missing field instead of one per leaf** — rejected: a leaf written from the wrong template misses four fields at once, and four errors say nothing the one does not.
- **Adding `--commit` support to `validate` so a historical commit can be checked directly** — deliberately not done here. The flag is advertised by the CLI usage and the tool parameters and is currently ignored by the validate verb; that is a real gap, but it is orthogonal to this change and belongs to whoever owns `validate`'s ergonomics. Verifying this change against the pre-fix commit was done by checking out that commit in a throwaway clone.

## Consequences

- On the live suite at its current commit (`558ec30`), `validate` reports 0 errors and 6 new warnings: `OBJECTIVE_NO_PROBE` for `F2-multi-agent-room`, `F3-self-restart-report` and `P0-placeholder` (none has an executable probe yet), and three `RUBRIC_REF_DANGLING` on F3 (`B2-2`, `B2-3`, `B3-2` — stale ids from an earlier numbering that the leaf rows renamed). Exit code stays 0. The 26 pre-existing `UNREGISTERED_FILES` warnings are unchanged.
- At `6c3877b^` — the commit before F3's leaves were written — `validate` reports exactly one error, `RUBRIC_NO_ITEMS` on F3's rubric, and exits 1. That is the pilot-A failure, caught before a run.
- `validate` now costs one or two extra `git show` calls per item carrying a rubric. Like the canary check it stays off the summary path, so `list`/`show` remain as cheap as before.
- The plugin now interprets one file format it did not before. This is a deliberate narrowing of "the plugin never interprets dataset semantics": it reads the rubric's structure, never its content — no rule here looks at what a criterion says.

## Testing

`packages/datasets/tests/judgeable.spec.ts` — 15 tests. The selection helpers over both layouts (shortest-path rubric, probes under any `probes/` segment, and the loose id regex declining `UTF-8`, `R1-R6`, `X-no-patch` and a date); the leaf rules over a healthy rubric, an axes-only one, an unreadable one, missing fields, an unknown kind, and polarity in both directions plus the three shapes that are legitimately fine; and the service path end to end — silent on a healthy suite in both layouts, untouched on a dataset with no grading layer, exit 1 through the CLI on the leafless rubric with the two downstream warnings suppressed, and the probe and dangling-reference warnings including their register-form resolution. The whole package: 114 tests over 15 files green.

## Cross-references

- [datasets canary field and tool-group registration](2026-09-07-datasets-canary-and-tool-groups.md) — the precedent this follows: an opt-in, content-reading `validate` rule that exists because the discipline it enforces cannot be held by hand across a growing suite.
- [datasets governance and authoring](2026-08-24-datasets-governance-and-authoring.md) — owns `validate`, the register role model, and the authoring protocol this check reads §6.7/§6.8 of.
