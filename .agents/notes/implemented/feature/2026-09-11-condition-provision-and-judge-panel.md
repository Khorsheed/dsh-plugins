# Agent Note: provisioning a condition, and letting the judge be a player

Status: implemented

English | [中文](2026-09-11-condition-provision-and-judge-panel.zh.md)

## Problem

Two gaps, both of them "the contract says something nobody enforces".

**The condition lock had no writer.** T8b defined `conditions/<id>.lock.json`
(`dataseek.condition-lock/1`) and both of its readers: validate reports
`LOCK_STALE` / `HOME_NOT_PROVISIONED` / `HOME_MISMATCH` off it, and the run loop
refuses a stale lock outright. Nothing in the repository ever WROTE one. Both
`read.ts` and `service.ts` carried a comment pointing at "`dsh-eval conditions
provision` (I4)"; the CLI had `conditions hash` and nothing else. Every lock in
the dataset repository was therefore hand-made, which means every
`HOME_NOT_PROVISIONED` the validator has ever printed was true in a way nobody
could fix.

**And what the lock anchors was never the thing that mattered.** `home.sha`
hashes a scoped home's config CONTENT. It proves two homes are byte-identical
and says nothing about whether either one is configured the way the condition
says it is. A condition could declare `permissions: "read-only"` against a
scope running `danger-full-access`, or `model.endpoint` against a scope routed
somewhere else entirely, and hash, lock, and run without a word. The readiness
probe (T23) checks one thing — that the model reads back — and nothing else.

**Decision 9 made "evaluate every model" and "judge with a model" mutually
exclusive.** `run.ts` refused any judge condition sharing `(harness.name,
model.declared)` with a player; validate refused an id on both lists. That is
unsatisfiable as soon as the field under test includes the model you would
judge with, and it was not theoretical: at T22 step 5 the judge declared dsh
v4-pro, the sub-dsh ran the instance default v4-flash, the readiness probe
caught the mismatch and refused — and re-declaring the judge as v4-flash made
it collide with the dsh PLAYER. Neither declaration could be run.

## Decision

### `conditions provision` — five steps, each a stop

The verb takes a declaration and the dataset-repository WORKING COPY it may
write into:

```
/eval conditions provision <condition.json> --repo <working copy>
```

1. resolve the condition's `(harness, scope)` to a scoped home through
   `localAgent.homeDir` — reading it materializes it;
2. grade the credential through `localAgent.statusOf`. Anything but
   `present-unverified` / `verified` stops here and prints the login command,
   `/<harness> login [--scope <name>]`;
3. read that scope's `effectiveSettings` and check the declaration field by
   field;
4. hash the scoped home (`home.sha`);
5. write the lock.

It is the ONLY writer, deliberately: a hand-written lock claims the scoped home
was checked when nobody checked it. It writes one file, into the copy `--repo`
names, and commits nothing.

**Provision never logs in and never copies a credential.** A verb that could
fix a missing credential by copying one from a sibling scope would make two
conditions that differ by `scope` — two accounts, which is the entire point of
T29 — silently the same subject. So the answer to an absent credential is a
sentence telling the human which command to run.

### The field-by-field check, and why two fields are errors

`effective.ts` holds the comparison as a pure function over two JSON shapes,
and BOTH readers call it — provision before it writes, validate against the
snapshot the lock recorded. One rule in one place, the same discipline
`resolveConditionReadiness` already holds for the word "ready".

| Condition field | Compared against | Grade |
|---|---|---|
| `harness.version` | the CLI's self-reported version | warning; a `null` declaration is back-filled INTO THE LOCK |
| `model.declared` | the harness's configured default | warning |
| `reasoning.effort` | `reasoningEffort` | warning |
| `permissions` | codex `sandbox` / claude-code `permissionMode` / kimi `autoApprove` | **error, no lock** |
| `model.endpoint` | `"default"`, else the endpoint hostname | **error, no lock** |

`permissions` is the approval boundary (frozen decision 3) and `model.endpoint`
is the upstream route (frozen decision 5). Those two ARE the subject under
test: a run whose subjects differ on either is not the experiment the condition
describes, so it does not get an anchor.

The warnings are warnings for reasons, not out of leniency. A declared model
differing from the harness default is NORMAL since T30b — the declaration is
the value requested per delegation, and the read-back still refuses a run that
served something else. A reasoning knob the harness does not have is an honest
absence (it is why the dsh permission word is `unrestricted`). A CLI version is
a fact to record rather than to enforce, which is why a null one is back-filled
into the lock and never into the condition document.

**`model.endpoint` gained a spelling.** The family reports a HOSTNAME and never
a URL — a path can carry tenant or project ids. So the checkable values are
`"default"` (no base URL in force) or the endpoint's URL/hostname, with a URL
reduced to its host before comparing. A label like the protocol's old
`"proxy"` example names no endpoint anyone can check; §6.2 now says so and the
published example carries `https://api.anthropic.com`, matching the real
`claude-exec` condition.

**Provision never rewrites the condition document.** `home.sha` is part of the
condition hash, so writing the measured value in is changing the condition —
the human's call. Provision reports the measured sha verbatim and stops there.

### `provisioned`, additive in `/1`

```json
"provisioned": {
  "at": 1757500000000,
  "cliVersion": "2.1.236",
  "effective": { "model": "…", "reasoningEffort": null, "permissions": "skip", "endpoint": "api.anthropic.com" }
}
```

`null` inside `effective` means the harness has no such knob — the honest input,
never a substituted default. A lock WITHOUT the block was written before
provision existed; validate reads that as `PROVISION_RECORD_MISSING` ("nobody
ever checked") rather than as a violation, so no existing lock breaks.

Validate re-checks the block against the declaration and makes the condition
`unready` when an error-grade field disagrees. With the sha still matching that
can only mean the lock was not written by provision — which is exactly the
forgery worth seeing, and the reason the block is worth carrying at all.

### `conditions list` and `conditions diff` — show, never choose

`list` gains the provisioned column. `diff` answers which FIELDS two
declarations differ on and what each side says: canonical deep compare, arrays
as leaves (`env.keys` is one fact a reader wants whole), an absent field
reported as a difference (`scope` absent versus `scope: "eval-b"` IS the
two-subjects case), `notes` listed but excluded from `identical` exactly as it
is excluded from the hash.

It stops at the facts on purpose. Two conditions differing in exactly one field
are a single-factor pair — the shape an experiment wants — but whether that
pair is worth RUNNING depends on things no file knows, and a tool that guessed
would be believed.

`eval_conditions` gains a `diff` parameter and stays read-only. Provision is
not a tool and will not become one: it is the act that makes a declaration
real, and it needs a human.

### Decision 9 relaxed: a panel, and disclosure instead of exclusion

The `(harness, model)` refusal in `run.ts` and the `JUDGE_IS_PLAYER` check in
`validate.ts` are gone. In their place:

- **a judge must pin its model** (`model.declared: null` is a validate error and
  a run refusal). Without it "was this cell self-judged" is undecidable, and
  the report would be quietly wrong rather than loudly incomplete;
- **`plan.judge.conditions` may name several** — the judging loop already
  iterated judges, so a panel needed no new mechanism;
- **every `llm-draft` sample carries its judge**: the annotation envelope gains
  `judgeModel` and `selfJudged`, results.jsonl rows gain `judge` (condition,
  model, `selfJudged`, sample), summary.md lists per cell who judged it and
  marks the self-judged ones, and the consistency section gains a cross-judge
  line beside the per-judge κ;
- **still refused**: the same id on both lists (a bookkeeping mistake, not a
  panel — it would make a condition its own cell's judge and double every
  count keyed by condition id), and one judge id listed twice.

**Why not a global exclusion.** When the thing being evaluated IS every model,
the judge necessarily overlaps one of the players — the constraint is not
strict, it is unsatisfiable. The public leaderboards that judge with models
(MT-Bench, AlpacaEval, Arena-Hard) all let contestant models judge and record
the self-preference they measure; the remedy there is a panel plus disclosure,
not exclusion. A benchmark that wants neither uses deterministic graders
(SWE-bench). And the report already refuses to rank on thin evidence, so the
place to put a self-judged verdict is in front of the reader, marked.

The per-judge κ is a real consequence, not bookkeeping: with a panel, two
judges answering once each is a disagreement between raters, and pooling them
into the repeated-sample κ would report the panel's spread as one judge's
noise. Each judge is now keyed separately, and a bundle that records no judge
identity falls back to the single bucket it always used — so older bundles
produce the same numbers.

### Byte-identity for older bundles

`judge` is emitted on a results.jsonl row only when the envelope carries BOTH
new fields. An envelope with `judgeCondition` alone came from a run where a
judge could not be a player, so `selfJudged` was not merely unrecorded but
impossible; reconstructing it would be inventing a fact. The key is absent
instead, and `results.jsonl` recomputed over pilot A's bundle is byte-identical
(verified — 133 rows, 78 of them llm-draft).

## Real-machine verification

Against the live web-eval instance's scoped homes (`~/.dsh-lab/local-agent`,
the DSH_HOME of the running 3171 instance), through the shipped codex harness,
writing into a detached worktree of the dataset repository:

**Provision, success** — `codex-scope-a` against the default codex scope:

```
provision codex-scope-a: credential present-unverified
provision codex-scope-a: permissions match — declaration and scope agree on "workspace-write"
provision codex-scope-a: lock written → …/codex-scope-a.lock.json
  (condition 952272033e56…, home efa3184b55eb…, 59 config file(s) hashed, 130 skipped)
```

130 entries skipped is the deny list doing its job on a real scoped home.
`cliVersion` came back `null` (the CLI could not be asked here) and is recorded
as `null` rather than guessed.

**Provision, refused** — the same condition with `permissions` flipped to
`read-only`:

```
provision codex-scope-a: permissions mismatch (error) — the condition declares permissions "read-only"
  but the scope is configured "workspace-write" — the approval boundary IS part of the subject under test
provision codex-scope-a: REFUSED — 1 field(s) disagree with the scope; no lock written
```

The lock already on disk was left untouched.

**Two scopes, two homes.** Provisioning `codex-scope-a` and `codex-scope-b`
(identical but for `scope: "eval-b"`) hashed two different directories —
`7164bd65…` over 59 files and `a2f63a49…` over 892 — which is what makes them
two subjects rather than one.

**The full cycle closes.** Writing each measured `home.sha` into its
declaration and provisioning again took `codex-scope-b` to `ready` — the first
time a condition has been ready on real data. `codex-scope-a` came back
`HOME_MISMATCH`, correctly: the live instance is writing into that scoped home
underneath us, which is a real drift and not a bug in the check.

**The forged lock is caught.** Editing `codex-scope-b`'s declaration to
`read-only` and re-computing the lock's `sha` by hand (leaving `provisioned`
alone) yields, from validate:

```
[PROVISION_MISMATCH] condition codex-scope-b: permissions disagrees with the scope the lock was
  provisioned against — … ; re-run `dsh-eval conditions provision`
codex-scope-b -> unready
```

**`conditions diff`** on the T29 pair, one substantive field:

```
dsh-eval: codex-scope-a vs codex-scope-b — 1 field(s) differ: scope
"differences": [ { "path": "notes", "a": "…", "b": "…" }, { "path": "scope", "b": "eval-b" } ]
```

**The judge panel, on the host path**, P0 × `codex-scope-a` × 1 rep, judged by
`t31-judge-twin` (codex, `gpt-5.6-sol` — the player's own model) and
`t31-judge-other` (claude-code, `claude-haiku-4-5-20251001`), two samples each.
All three conditions passed readiness reading back exactly what they declared.
20 llm-draft verdicts landed. The run said so before it started:

```
judge t31-judge-twin: model "gpt-5.6-sol" is also player condition codex-scope-a
  — that condition's cells will be marked selfJudged for this judge (decision 9, relaxed)
```

and summary.md:

```
- 双采样判据 10 条，完全一致 9 条（90%）
- Cohen κ（样本两两平均，判据为条目）: 0.615
- 跨判官（判官面板 2 位，每位先按自身多数定调）: 5 条判据被两位以上判官判过，全员一致 5 条（100%）；Cohen κ 1.000
- 自评判据 5 条：判官模型与该格选手模型相同（决策 9 放宽后允许并标注，不排除）

| 题 | 条件 | rep | 判官（模型 · 采样数） |
| P0-placeholder | codex-scope-a | 1 | t31-judge-other（claude-haiku-4-5-20251001 · 2 采样）；t31-judge-twin（gpt-5.6-sol · 2 采样） **自评** |
```

Every one of those rows would have been a refused run the day before.

## Alternatives considered

**Let provision log in, or copy a credential from a sibling scope.** Rejected:
it would make two conditions differing only by `scope` — two accounts, T29's
whole point — silently one subject. The refusal naming the login command is
the only safe answer, and it costs the human one command.

**Let provision write the measured `home.sha` back into the condition.**
Rejected: `home.sha` is part of the condition hash, so writing it is minting a
new condition. A tool that re-hashes the subject under test while "just
provisioning" is a tool that can change what an experiment is about between two
runs of the same plan.

**Grade every field mismatch an error.** Rejected: a declared model differing
from the harness default is the NORMAL state since T30b, and refusing it would
make every condition that pins a non-default model unprovisionable. The two
error-grade fields were picked because they are the two that define the subject
rather than describe it.

**Grade every field a warning and always write the lock.** Rejected in the
other direction: that is today's behavior, where a lock can attest to a scope
that contradicts the declaration. The anchor has to be able to refuse, or it
anchors nothing.

**Let `validate` re-check with its own copy of the rules.** Rejected — two
copies of a comparison drift the first time a field is added, and the drifted
half would be the one that silently passes. `effective.ts` exists so that
"provision would have refused this" and "validate calls it unready" cannot
disagree.

**Make `conditions diff` recommend a pair** ("these two differ in exactly one
field — a usable single-factor comparison"). Rejected: the recommendation would
be believed, and whether a pair is worth running depends on budget, credentials
and what the run is for — none of which is in the files. Showing the single
differing field already makes the pair obvious to a reader who knows those
things.

**Add `judge` to `dataseek.verdict/1` instead of to the annotation envelope.**
Rejected: the judge is blind by construction — it cannot write its own identity
— so the field would be orchestrator-stamped onto a document the judge
authored, and the verdict schema would gain a field no verdict writer may ever
set. The envelope already exists to carry exactly this kind of provenance.

**Keep decision 9 and require a judge outside the field.** Rejected: it is
unsatisfiable when the field is "every model we can run", and it had already
cost a real run (T22 step 5). Disclosure is what the leaderboards that face the
same problem actually do.

**Drop self-judged verdicts from the aggregate instead of marking them.**
Rejected: a run evaluating every model would then have cells with no llm-draft
verdict at all, which is a worse report than one that says who judged and warns
about the bias. The reader can discount a marked number; they cannot recover a
dropped one.

**Make a lock without `provisioned` unready.** Rejected: it would flip every
existing lock in the dataset repository to unready in one commit, for a fact
the warning already states. `PROVISION_RECORD_MISSING` says "nobody ever
checked this" without invalidating work that predates the checker.

## Consequences

A condition lock now means something it did not mean before: not just "these
bytes hashed to this" but "a scope with a credential was read, and it agrees
with the declaration on the two fields that define the subject". Every lock in
the dataset repository predates that and carries `PROVISION_RECORD_MISSING`
until it is re-provisioned — which is honest, and the warning says what to run.

`conditions provision` cannot run from the CLI. The scoped home, the credential
grade and the effective settings are all local-agent's, and eval imports
nothing from sibling packages, so outside a host there is nothing to ask. The
CLI verb exists and refuses by naming `/eval conditions provision`, the same
shape `run` has had since I2. `list` and `diff` are pure file reads and work
everywhere.

A judge may now be a player, which means a report can contain self-judged
numbers. They are marked in three places (the verdict row, the per-cell table,
a line in the consistency section) and the summary says plainly not to use them
to support a ranking that includes that model — but they are numbers a reader
can now misuse, where before they could not exist. That is the trade the
relaxation makes, and it is the trade the public leaderboards made first.

`validate` now resolves the plan's JUDGE conditions too, on `report.judges`
rather than `report.conditions` — a judge is a condition but never a cell. A
judge whose declaration violated the contract used to reach the run loop with
the plan already approved.

The protocol's published condition example changed its `model.endpoint` from
`"proxy"` to `https://api.anthropic.com`. A label was never checkable; now that
something checks the field, the example has to be something that passes.
