# Agent Note: the last mile of a condition, and who gets to pick the repository (I5 · T58)

Status: implemented

English | [中文](2026-09-17-eval-conditions-last-mile.zh.md)

## Problem

The I5 walkthrough (T39) ran the eight-step flow end to end and counted the human interventions. Step 4 — "log in and provision" — cost **six**, and four of them were gaps rather than decisions:

- **G6.** `model.endpoint` is a field the pre-run readiness gate refuses a condition for leaving null, and no face could set it: not the draft tool's six editable fields, not the conditions page, not any form. The person opened two JSON files in an editor, and had to write the same value in both or the experiment quietly grew a second factor.
- **G7.** `provision` measured `home.sha` and, by design, did not write it back. `home.sha` is condition-hash input, so the person copied a 64-character digest out of a warning, pasted it into each declaration, and provisioned a **second** time to re-anchor the lock against the document they had just changed. One human action, taken twice, with a transcription in the middle.
- **G4.** A condition drafted from a source that predates the container path has no `unit` segment to copy, and the six editable fields cannot express one. On a plan declaring a unit, drafting could not produce a runnable condition at all.
- **G5.** The binding stores a literal `~`, which `eval_conditions` and the datasets read paths do not expand, so the conditions page was a full-page error. (Split out to T62 and not done here; only the *comparison* half is addressed below, which T58 needs regardless of how T62 settles the store.)

Two more gaps from step 1 are about a boundary rather than a field, and they are in this task because they are the same last mile seen from the agent's side:

- **G1.** In a session nobody had bound, the tools said so plainly — *"pass repo, or ask the human to bind one"*. The agent did not stop. It searched the disk with glob, found `~/.dsh/scratch/dataseek-eval` (a checkout several agents share, its HEAD parked on someone else's branch), and wrote three files into it — including a rewrite of the plan a pilot run was executing. The refusal named the right fix and the parameter beside it kept the way around open.
- **G3.** `/datasets bind <repo>` with no `--layers` printed `(all layers)`. The effective ceiling was in fact the model-facing floor, so the receipt said the opposite of the truth in the direction that matters: a person reading it would believe `answers/oracle` and `rubric.yml` were already open to the planning agent.
- **G2.** `/datasets bind` produced no receipt a person could see. It lands on the tab strip's chip, and the tab strip waits for the session to have content — while binding is the first thing done in a session that has none.

## Decision

### Provision writes the digest back, and is therefore one action (G7)

`provisionCondition` gains `writeBack`, **default true**. After hashing the scoped home, a declaration whose `home.sha` disagrees is corrected in place, the condition is **re-hashed**, and the lock minted in step 6 anchors the document as it now reads. That re-hash is the whole point: `home.sha` is hash input, so the corrected document is a different condition from the one that was read, and a lock written against the pre-edit sha is precisely the stale-lock state the second provision existed to leave.

`--no-write-back` on the slash command (and `writeBack: false` on the service, `keepDeclaration: true` on the page verb) restores the old two-step shape. The write touches `home.sha` and nothing else, only when it disagrees, only inside the working copy `--repo` names, and commits nothing.

`harness.version` stays out of it. The version a CLI reports about itself is a measurement that belongs in the lock; `home.sha` is a field the declaration's author left for provision to fill.

### The conditions page gets the human's two writes (G6, G7)

`provisionCondition({dataset, condition})` and `setConditionEndpoint({dataset, condition, endpoint})` are new service verbs with new Remote verbs behind them, and no model-tool twin. Both resolve the working copy from the calling session's binding rather than taking a path, because a browser that could name the path a lock is written into would be choosing the working copy — which is the binding human's decision.

`setConditionEndpoint` is the only write any face makes into an **existing** declaration, and it is deliberately one field. It is a factor edit: the condition re-hashes and the lock beside it goes stale. The answer says which, and provisioning again is the next click — a write that silently re-anchored a subject would make "what is this condition" depend on when it was last looked at.

Both answers carry the registry row as it now reads, so the table updates from the call that just returned instead of re-walking the `conditions/` directory to learn what its own click produced. The provision answer's check list is `provisionChecks`, the same flat `ok / warn / error` shape the plan-review page renders — one question, one rendering.

`model.endpoint` also becomes the **seventh** editable field of a drafted copy, so the common case never reaches the page at all.

### The container segment is completed from a four-line table (G4)

`HARNESS_UNIT_SCOPED_HOMES` in `unit.ts` holds one line per family — dsh, claude-code, codex, kimi — mapping each to its in-container credential mount and the variable that names it. On a plan that declares a unit, a minted copy whose source has no usable `unit.scopedHome` gets one from that table, plus the `env.keys` entry the run would otherwise refuse for (`UNIT_SCOPED_HOME_VAR_UNDECLARED`), and the notes record what was filled and why.

A harness the table has no line for gets **nothing**: validate's `UNIT_SCOPED_HOME_MISSING` names the field, which is a better answer than a credential directory nobody chose. The completion is also deliberately not counted among the copy's changed fields, so a copy that names no edit is still refused as changing nothing — it is the copy being made runnable where the plan puts it, not a factor its author chose.

### The `repo` argument may only restate the binding (G1)

`EvalService.resolveRepoScope` and datasets' `resolveScope` both take an `agent` flag, set by the model-tool adapters and by nothing else. Under it:

- no binding (and no configured default repo on the datasets side) → refused, naming `/datasets bind`, whether or not a `repo` was passed;
- a `repo` that is not that repository → refused, naming both;
- a `repo` that is → accepted, and the binding is what resolves.

Comparison is on normalized paths — `~` expanded, `resolve`d, realpath'd when the path exists, trailing separator dropped — because the two spellings reaching this check are written by different hands. That normalization lives in `packages/eval/src/validate.ts` and the new `packages/datasets/src/repo-path.ts`, deliberately **not** in the binding store: what the store records is T62's subject, and this check has to keep working whichever form T62 settles on.

Every human face is untouched: the CLI's `--repo`, `/eval conditions --repo`, the datasets tab, and the lab tab's Remote all still name a repository.

### The bind default is one sentence, said the same way twice (G3)

`effectiveLayers`' floor is now **unconditional**: with no explicit whitelist the ceiling is the dataset's `modelFacing: true` layers, full stop. The old "a dataset that declares nothing sensitive is not filtered at all" branch made "no whitelist" mean two different things depending on a descriptor the binder never reads, and it also admitted item-level directories no `register` entry claims — precisely the ones nobody declared a sensitivity for.

`formatBindReceipt` is the receipt both the slash command and the CLI print: a default binding says *agent-visible: the model-facing layers only*, and names `--layers` as the way to open more; a widened one names the layers it opened and says they were named explicitly.

### The binding receipt gets somewhere to appear (G2)

A read-only chip on the composer tool row (`conversation.input.left`), showing the bound repository's name and its layer ceiling, or a dashed "not bound". It rides the tab's own composition criterion through the same `RegistrationToggle`, so the two cannot disagree about whether this is a datasets session, and refreshes by subscribing to its own session's snapshot with an 800 ms throttle — a slash command moves the session when it starts and again when it settles, which is exactly when the receipt has to appear.

## Alternatives considered

**Have provision re-run itself after the write-back instead of re-hashing in place.** Two passes over the same scoped home for one call, and the second pass would have to trust that nothing moved in between. Re-hashing the document we just wrote is the same answer computed once.

**Make the write-back opt-in (`--write-back`) rather than the default.** This was the shape the walkthrough's gap report suggested. Rejected: the state it leaves by default is a condition that is *not ready* and a declaration that disagrees with its own lock, which nobody ever wants on purpose. The flag is worth having as the way back — a person auditing what a scoped home currently hashes to without touching the file — but that is the rare case, and rare cases take the flag.

**Let the conditions page edit every condition field, not just the endpoint.** Rejected. Minting a condition is the drafting verb's job and it enforces the copy discipline; a general-purpose editor on this page would be a second way to write the same file, and the two would drift — which is the same reasoning that left 新建条件 a pointer rather than a form in T36. `model.endpoint` earns its exception by being a readiness-gate field on declarations that already exist, where the drafting verb cannot reach.

**Have the endpoint edit re-provision automatically.** It would save a click on exactly the path where the click is the point: the edit changed what the subject IS, and re-anchoring it is a decision a person should make with the lock's staleness in front of them.

**Refuse the `repo` argument outright for agents instead of accepting a restatement.** Cleaner to state, but it breaks nothing useful and helps nothing: an agent that spells out the repository it was already given has done nothing wrong, and the refusal would fire on correct behavior. What matters is that the parameter cannot *widen*.

**Keep honoring `repo` when no datasets service is mounted at all.** Tempting — there is no binding for the parameter to violate in that composition. Rejected because it is a laundering path by construction: a composition without the binding face is one where the human never had the control, and the honest answer there is that the tools have no repository, not that the agent may choose one.

**Fix the `~` storage here rather than only the comparison.** That is T62, already split out and specified. Doing it in this branch would collide with T62 file for file on `binding.ts` and the read paths; the comparison helper is what T58 needs and works either way.

**Drop the layer floor's special case by making the *binding* record a concrete layer list at bind time.** Rejected: layer names are per dataset, a binding is repository-wide, and a list frozen at bind time would silently fail to cover a dataset added afterwards. The floor is a rule, and rules do not go stale.

**Put the binding receipt in the chat flow instead of the composer.** The slash result already goes there via `command/done`, and in an empty session it was not visible — which is the whole bug. A durable session event of this plugin's own is worse still: the binding store's module doc records why a custom-typed event makes the session unresumable.

## Consequences

- **A new condition drafted with an endpoint reaches `ready` in one human action.** Step 4's six interventions become two: the `/<harness> login` the run needs (none for dsh, which uses the instance's own provider) and the provision itself. The four that were transcription and repetition are gone.
- **A stale `home.sha` is now corrected rather than reported.** A person who wanted the old reporting behavior has `--no-write-back`; a person who did not notice the change sees one fewer warning and one more ready condition.
- **Conditions minted for a container plan are runnable without a text editor**, for the four harnesses in the table. A fifth family is a line in `unit.ts` and a test.
- **An agent in an unbound session now has no repository at all.** That is the intent, and it is a real narrowing: a workflow that relied on the agent passing `repo` in an unbound session stops working and says why. The two compositions where that could bite — a session bound to nothing, and an instance mounting no datasets service — both answer with the bind command.
- **A binding with no `--layers` now filters datasets that declare nothing sensitive**, where it previously did not. For a dataset whose layers are all model-facing the ceiling equals the declared layers, so the only observable change is that item-level directories claimed by no `register` entry stop reaching an agent. That is the safer default and the one the receipt now promises.
- **The composer carries one more standing control** in sessions whose preset grants the dataset tools. T63 owns the visual pass over both tabs and may restyle it; its copy is already in the locale dictionaries rather than inline.
- **G5 is untouched** — the binding still stores a literal `~`, and the conditions page still cannot open on 3171 until T62 lands. Everything above is reachable through the page only after it does; the slash and service faces work today.

## Testing

`packages/eval`: 739 tests. New coverage — the write-back and its idempotence, `--no-write-back` on both the service and the slash face, the seventh draft field, the container completion across four harnesses and its two silences (host path, unknown harness), the conditions page's two verbs including the path-segment refusal and the unbound session, path normalization through a symlink and on a path that does not exist, and the client-side "one click and the row turns ready".

`packages/datasets`: 182 tests. New coverage — the agent narrowing (restatement, mismatch, unbound, configured default, symlink), the unconditional floor, the bind receipt in both shapes, the chip's registration and its composition criterion, and the chip itself (bound, widened, unbound, no flash before the first answer, one read per throttle window, an unreachable host).
