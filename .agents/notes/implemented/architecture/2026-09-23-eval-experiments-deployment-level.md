# Agent Note: Experiments as deployment-level objects

Status: implemented

English | [中文](2026-09-23-eval-experiments-deployment-level.zh.md)

## Problem

Before T73 an evaluation experiment was a plan file inside a dataset repository's working copy: `datasets/<set>/plans/<name>.json`, its conditions in `datasets/<set>/conditions/`, and its analysis written by `eval_repo_write` somewhere under the same checkout. The repository reached eval through the per-session binding. The [dataset registry](2026-09-23-dataset-registry.md) (T73 branch 1) replaced the binding for agents with a registry of read-only references. Eval still had four problems:

- **Its records lived in someone else's checkout.** Drafting wrote plans and conditions into a working copy that several agents share. Every analysis draft was a write into that tree, and the write door (a whitelist of four prefixes) had to be right about a directory it did not own.
- **An experiment did not pin its input.** A draft left `dataset.commit` null, and the run pinned whatever the working copy held that day. «Run it again» silently became a different experiment whenever the dataset moved, and two experiments were comparable only if someone checked by hand.
- **Which repository was a session fact.** `resolveRepoScope` read the session's binding. A new session had none, and a session with the wrong one pointed eval at the wrong tree.
- **Runs could not say which experiment they belonged to.** A run recorded `planPath` and `planSha`, so moving or editing a plan broke the link. The lab list could only group runs by path.

## Decision

### The experiment directory

Everything the evaluation produces lives under the deployment's state root. The dataset repository is read-only input.

```
$DSH_HOME/state/eval/
  experiments/<expId>/plan.json    the plan, byte for byte as drafted or imported
                     /meta.json    {schema: dsh.eval.experiment/1, experimentId, name,
                                    originSession, createdAt, dataset: {registry, set, commit},
                                    source?: {from, path}}
                     /analysis/    eval_analysis_write's only door
                     /exports/     the default bundle location
  conditions/<id>.json             the condition library
  conditions/<id>.lock.json
```

`packages/eval/src/experiment-store.ts` owns the layout. The library sits at `<stateRoot>/conditions/` on purpose. Every condition reader already resolves `<root>/conditions/<id>.json`, so the state root is the library's root and readiness keeps a single implementation. `plan.exports` and the caller's `exportsDir` still override `exports/`. The state root is `$DSH_HOME/state/eval/`. An instance without `DSH_HOME` has no state root: the lab's list is empty and says so (`noStateRoot`), and it never falls back to a path of its own.

**The id rule.** An experiment id is `<slug>-<yyyymmdd>-<4hex>`:

- the slug is the name lower-cased, with runs of anything outside `[a-z0-9]` collapsed to one `-`, cut to at most 40 characters with no dangling dash, and `experiment` when nothing is left;
- the date is UTC, so one instant gives the same id on every machine;
- the four hex digits are random.

`EXPERIMENT_ID_RE` is checked on every read, so an id can never be a path. Creation is atomic. Everything is written into a hidden `.tmp-<pid>-<hex>` directory under `experiments/`. That directory is renamed to a freshly minted id, re-minting on a collision. `plan.json` is then read back and compared byte for byte, and a mismatch is an error, not a silent half-experiment. The lister skips dot-directories and reports a broken `meta.json` as a problem without emptying the list.

### The version pin

`eval_plan_draft` takes `dataset: "<registration id>/<set>"` and an optional `commit`. The draft always pins a full commit, chosen in `src/dataset-version.ts`. There are two kinds of candidate:

- the tracked branch's latest commit;
- every commit that an existing experiment on the same `<registry>/<set>` pins, when that experiment shares at least one condition with the draft. Those are the experiments a reader will compare this one against.

If every candidate holds identical `items/` and `schemas/` trees (compared by git tree id), the choice cannot change a result, and the latest commit wins silently. Otherwise the draft is refused with this text:

```
version is ambiguous for ${registry}/${set}: these commits hold different items/ or schemas/, and results pinned to different ones do not compare:
${listing}
Ask the person which version this experiment should pin with ask_user_question, then draft again with that `commit`. If they skip the question, stop — do not pick one yourself.
```

An explicit `commit` that is not a candidate is refused with the same listing, so a typo or a stray ref cannot slip past the question.

### Validation reads the materialized view

`validateExperiment` and a plan in the experiment directory validate against the datasets registry's read-only materialized view of the set at the pinned commit (`datasetView`, the `_full` key). Conditions come from the library. The plan-sibling fallback (`plans/` beside `items/`, conditions beside the plan) remains only on the legacy path: a plan validated in place by file path, and the pre-import read of an old plan.

### Pairing runs with experiments

A run started from an experiment records `experimentId` in its `run.meta`. `pairRun` (`src/experiments.ts`) pairs a run with an experiment using three keys, strongest first:

1. `experimentId`;
2. `planSha`, the sha256 of the plan's canonical JSON. An old run whose plan was later imported hashes the same;
3. `planPath` ending in an imported experiment's `source.path`. This is the last resort for a run whose plan was edited after it ran.

A run that no experiment claims is still listed. It carries its name from its own `run.meta` and is labeled 「旧运行（未关联实验）」.

### Import

`dsh-eval import --from <id>@<ref> [--plan <name>] --instance <url>` and the `importExperiments` Remote live in `src/import.ts`. Import brings the old in-repo plans over as experiments:

- **Reading.** Everything is read with `git show` at the ref, through the registry face. Import never checks anything out.
- **Plan bytes.** The plan bytes are written verbatim, so `planSha` still matches what old runs recorded.
- **Pinned commit.** The experiment pins the plan's own `dataset.commit` when it has one, else the commit the ref resolves to.
- **Conditions.** Every condition the plan names, players and judges alike, goes into the library with its lock:
  - the same condition hash as the library copy (byte formatting aside) counts as the same condition and is left alone;
  - the same id with different content refuses the whole import. The refusal lists each differing field (`<path>: library X ≠ imported Y`) and says to rename one side.
- **No partial writes.** Every check runs before the first write, so a refused import writes nothing.
- **Re-import.** Importing the same plan at the same commit again is a no-op, and the report says so (`created: false`).

The report counts experiments created and already present, files skipped with a reason, and conditions added and identical.

### The analysis door

`eval_repo_write` is renamed `eval_analysis_write`. It takes `{experiment, path, content, overwrite?}` and writes only under `analysis/<path>` of that one experiment (`src/analysis-write.ts`):

- **The door.** String checks run before any disk access, then a realpath check on the parent refuses a symlinked escape. `plan.json`, `meta.json` and `exports/` are never writable.
- **Writing.** An existing file is replaced only when `overwrite` is set, and an empty body is refused.
- **The answer.** The confirmation names the experiment and says 「在结果对比页可看」.

The page side reads through the Remote verb `experimentArtifact({experimentId, path})` (`src/experiment-artifact.ts`), which applies the rules the cell-artifact reader uses:

- the path must stay inside that experiment's directory, checked lexically and then on real paths;
- text files only;
- anything past 256 KB comes back as the head of the file, marked as cut.

The report page's block ⑤ 「分析初稿」 lists the experiment's `analysis/` files by name, newest first:

- the block is collapsed by default, with the newest file expanded;
- it is hidden when the experiment has no analysis;
- it never shows a path.

### Starting a run

A run starts from an experiment:

- `/eval run <experimentId>`;
- `dsh-eval run --experiment <id> --instance <url>`;
- the lab's approve (`approve(experimentId, …)`).

The legacy `run <plan.json>` stays for a plan outside the state root.

### The binding tail

The following are deleted:

- `DatasetsBindingFace`;
- `resolveRepoScope`'s binding branch;
- the configured-repo fallback;
- every `repo` argument on the model tools;
- the lab's binding surfaces (the 「未绑定」 row, the bind fix, `normalizeRepoPath`).

The datasets side went in 1cdea3f4. Eval now reaches a dataset only through the registry face (`DatasetsRegistryFace`). The design page shows the dataset-version row as `<id>/<set> @ <short hash>`, and so does the lab list's column. Neither shows a path.

**Release note.** Old binding files are never deleted automatically. They stay at `$DSH_HOME/state/datasets/bindings/<session>.json`, where `importBindings` can still fold them into registrations. Nothing reads them otherwise, and a person may remove them once every registration they need exists.

### What this change does not touch

- **Out of scope.** The eval-planning SKILL and the presets (branch 3), and any agent-behavior pilot.
- **The lab instance.** 3171's runs directory is untouched.
- **The shared dataset checkout.** It is read only with `git show` / `archive` / `rev-parse`.
- **The 25 legacy managed worktrees.** They are still the coordinator's to clean, per the registry note.

## Alternatives considered

**Keep experiments in the dataset repository, just behind the registry.** This is the smallest diff: plans stay under `datasets/<set>/plans/` and only the lookup changes. But the registry made the repository read-only input on purpose. Drafting and analysis would still write into a checkout other agents work in, and the write door would still guard someone else's tree. Records that describe *this deployment's* experiments belong to the deployment.

**Key experiments by name, or by a content hash.** A name collides the second time someone runs «pilot-d» with a change. A content hash changes when the plan is edited, so the analysis and the runs would lose their experiment. The id is minted once and never derived again: it carries a readable slug, a UTC date, and enough randomness for two drafts in one day.

**Leave `dataset.commit` null and let the run pin it (the old behavior).** That is exactly the drift this change closes: the same experiment run twice could read two datasets. Pinning at draft time moves the decision to the moment a person can still be asked.

**Always pin the latest commit silently.** This is simpler, but a new experiment would quietly stop comparing with the ones it is meant to compare with once the set moved. The tree-hash comparison keeps the silent path for every case where the choice cannot matter, and asks only when it can.

**Let the agent choose among the candidates.** The refusal could list candidates and let the model pick. But which version an experiment belongs with is a research decision, and a model that guesses writes the silent drift back in. The text therefore says to ask, and to stop if the question is skipped.

**Import by copying the working tree, or re-serializing the plan.** A checkout-based copy reads whatever branch the shared checkout is on. Re-serializing would change `planSha` and orphan every old run. `git show` at an explicit ref plus verbatim bytes keeps the pairing.

**Let an import overwrite a conflicting condition, or keep both under one id.** Either would put two subjects under one name in a comparison. Refusing the whole import with the differing fields listed makes the person rename one side on purpose.

**Pair runs by `planPath` only.** Paths moved with the import, so every old run would show as 旧运行. `experimentId` is exact for new runs, and `planSha` recovers the imported ones without rewriting their ledgers.

**Keep `eval_repo_write` with a narrowed whitelist.** Its name and its argument (a repository path) describe the old shape, and any door into the dataset repository contradicts the registry's read-only rule. The rename makes the grant state what it is: one prefix of one experiment.

**Keep the binding as a fallback when no registry is present.** A fallback would keep a second source of repository identity alive indefinitely. That is the source that let an agent resolve the wrong tree. An instance with no registration now says so, and the fix is to register.

## Consequences

- **Bought:**
  - an experiment is reproducible by construction, because its dataset input is a pinned commit;
  - evaluation records never enter the shared dataset checkout;
  - runs keep their experiment across moves and imports, and old history pairs by hash after one import.
- **Cost:**
  - a deployment without `DSH_HOME` has no experiments at all;
  - moving experiments between deployments means copying directories, since there is no export verb for experiments;
  - the condition library is per deployment, so two deployments can disagree about what a condition id means until an import meets the conflict;
  - binding files linger until a person removes them.
- **Mechanism:** the version question and the condition-conflict refusal are the two places where eval now stops and asks. Both refusals name the next action rather than the failure.
- **Sequencing:** the protocol text (v1-rev13, `dataset: {registry, set, commit}`) lands in a separate commit. `protocol.spec` compares the doc's §6 schema blocks with the code constants, so it is green only once both commits are present.

## Testing

- **`packages/eval/tests/experiment-store.spec.ts`:**
  - the slug and UTC date rules;
  - the verbatim plan and the meta;
  - no temp directory left behind;
  - id-as-path refusal;
  - listing that survives a broken directory;
  - plan-path to experiment mapping.
- **`packages/eval/tests/import.spec.ts`:**
  - verbatim bytes;
  - the commit rule;
  - conditions and locks copied byte for byte;
  - re-import as a no-op;
  - identical hash despite different formatting;
  - the conflict refusal writing nothing;
  - a missing condition;
  - an unknown plan name or ref.
- **`packages/eval/tests/analysis-write.spec.ts`:**
  - the `analysis/` door at any depth;
  - `plan.json`, `meta.json` and `exports/` refused;
  - escapes, symlinks and overwrite;
  - the 「在结果对比页可看」 confirmation.
- **`packages/eval/tests/draft.spec.ts` and `validate.spec.ts`:**
  - the version decision, including the ambiguity and not-a-candidate refusals;
  - validation against the materialized root.
- **`packages/eval/tests/cli-experiment.spec.ts`:** `run --experiment` and `import`, both refusing offline.
- **Client specs:**
  - the dataset-version row;
  - the 旧运行 row;
  - block ⑤.
