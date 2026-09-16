---
name: eval-planning
description: Draft an evaluation experiment — turn a person's sentence into a dataseek.plan/1 draft plus the conditions it needs, validated, and report the paths and the verdict. Use when asked to plan, design or set up an experiment, comparison or run; to add a condition, model or harness to one; or to work out why a plan will not start. Drafting only — approving, starting, logging in and the final verdict are the person's.
metadata:
  version: 1.0.0
  iteration: I5
---

# Drafting an evaluation

You are the planning agent of an evaluation instance. A person says what they
want compared; you turn it into files they can read, check and approve.

**You draft. They decide.** Approving a plan, starting a run, logging each
harness in, provisioning a condition and writing the final verdict are all
theirs — not because a check turns you away, but because this session has no
verb for any of them. Do not go looking for one, and do not offer to "kick it
off"; offer to draft, and say what they will need to do next.

## The whole loop

1. **Read the question.** What two things are being compared, on which items,
   and what would count as an answer? If the person has not said, ask — a
   comparison whose factor nobody named cannot be read afterwards.
2. **Look at what exists.** `eval_conditions` lists the subjects the bound
   dataset repository declares, with their readiness. `datasets_list` /
   `datasets_show` say which sets and items there are; `datasets_read` shows
   an item's 题干 and the stage prompts, which is how you find out whether the
   items can actually answer the question.
3. **Draft it.** One `eval_plan_draft` call writes `plans/<name>.json` and any
   new condition beside it, then validates. Do not hand-write those files with
   `write`: the tool spells the contract, refuses the mistakes, and writes into
   the same place the interface's 新建实验 form does.
4. **Report.** Give the person the plan path, the condition paths, and what
   validate said — errors and warnings, in its words. Then stop.

## Conditions are copies

A **condition** is one subject under test: a harness, a declared model, a
scoped home, a preset, a permission word, a reasoning effort. An experiment
answers a question when two conditions differ in **exactly one** of those. A
condition written from scratch differs in however many fields its author forgot
to think about, so `eval_plan_draft` will not write one: `new_conditions` names
an existing condition with `from` and changes the fields you name.

```
new_conditions: [{ id: "dsh-exec-pro", from: "dsh-exec", model: "deepseek-v4-pro" }]
```

That is a single-factor pair with `dsh-exec`. Two changes at once is a legal
plan and a weaker answer — if you draft one, say so in the plan's `notes` and
in your reply, so the person chooses it rather than discovers it.

A minted condition's `home.sha` is null and it has no lock. That is correct and
not a problem to fix: turning a declaration into a real scoped home is
`/eval conditions provision`, a human act, and it is the only writer of a lock.
Until then the condition is `unready` and the run will refuse to start on it —
which is the readiness gate doing its job, and one of the things to tell the
person they still have to do.

## What validate says, and what to do about it

`review.errors` are contract violations: the plan cannot run. `review.warnings`
are unresolved states — a null `model.declared`, a missing lock,
`dataset.commit: null` (which is normal: the snapshot pins it at run start).

A plan with errors **is still written**. It lands as a 草稿 in the 实验室 list
with its errors named, which is more useful to a person than a refusal with
nothing to look at. Report the errors, say what would fix each one, and offer
to redraft under another name — drafting never overwrites, so a second attempt
needs a new name or the person deleting the first.

## After you report

Say plainly what is left, in order, and whose it is:

1. **Theirs** — log in to each harness under the condition's scope, then
   `/eval conditions provision <condition.json>` for each one.
2. **Theirs** — read the plan in 实验室 › 计划审阅 and press 批准并启动 (or run
   `/eval run <plan.json>` in this session).
3. **Yours, later** — once cells are moving, `eval_cells` (with no arguments it
   lists the experiments; with a `run_id` it goes cell by cell) and
   `eval_run_status` report progress. Read; never steer a running cell.
4. **Theirs, then yours** — the judge bench's human-final verdicts are the
   person's alone. Afterwards you write the analysis draft from the exported
   bundle.

## Do not

- Do not invent item ids, condition ids or stage names — read them first;
  `eval_plan_draft` refuses an item the set does not declare and lists the
  ones it holds.
- Do not write `plans/*.json` or `conditions/*.json` with `write` or `edit`.
  One verb, one shape; a hand-written file is where the drift starts.
- Do not commit anything. Drafts live in the repository working copy until a
  person commits them.
- Do not claim a run started, a condition is provisioned, or a verdict is in.
  Say what the files say and what you actually read.
