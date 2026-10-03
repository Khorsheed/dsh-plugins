---
name: dataset-authoring
description: Turn a person's dataset (a local directory, a public benchmark, or data already in the protocol layout) into a versioned git repository in the Dataset Authoring Protocol layout, then file a registration proposal for the person to confirm on the Datasets tab. Load at the start of every 「题集整理」 session and whenever you are asked to add, convert, or update a dataset. Covers the git check, the one round of questions, the never-touch-the-original rule, whole-dataset conversion, per-file and per-field dispositions, batch commits, the dry-run check, and conversion references for SWE-bench, Terminal-Bench, and jsonl QA.
---

# Dataset authoring

You organize a dataset for a person so that it can be registered and used in evaluations. The person will not
read git or JSON; they confirm a proposal on the Datasets tab that shows where every file came from. Your job
ends at filing that proposal. **You never register anything yourself** — only the person writes the registry.

Speak the person's language. Keep messages short and concrete. Derived from the Dataset Authoring Protocol
(§0–§5); where this skill and the protocol disagree, the protocol wins.

## The protocol ships with this skill

The full protocol is installed next to this skill. Read it with the `read` tool at exactly these paths — they
are the only copy you need, so never look for another:

- `{{skillDir}}/protocol.en.md` — English
- `{{skillDir}}/protocol.zh.md` — Chinese (same content)

Read only the sections you need (§1 layout, §2 layers and `register`, §3 `item.json`, §5 validate).

## Ground rules

- **Read only three places**: the original (source) directory, the target repository, and the protocol at the
  paths above. Nothing else on the machine is input to this job.
- **Rules come from the tools, not from code.** To learn what is wrong, run the check and work through its list:
  - `datasets_propose_registration` with `dryRun: true` — any repository you have committed to (registered or
    not); returns `problems` and `warnings`, the same checks the person's confirmation runs.
  - `datasets_validate` — a dataset that is already registered (`<id>/<set>`).
  - `node {{packageDir}}/lib/cli.js validate --repo <target repository>` — the protocol's full validate report
    (every error and warning, per item) for a repository that is not registered yet.

  Fix what they report, one entry at a time, then run them again.
- **Never search the disk**: no `find /`, `find ~`, `locate`, `mdfind`, or recursive `grep` outside the source
  and target directories. **Never read any plugin's source code or `lib/`** (this one included) to reverse-engineer
  a rule, and **never read another dsh instance's directories** (`~/.dsh*`, other `profiles/`, `state/`). When a
  tool result is unclear, ask the person instead.
- **Bounded commands**: `find` runs only inside the source or target directory and always with `-maxdepth`
  (`find <source> -maxdepth 3 -type f | head -50`); prefer `ls`, `du -sh`, `wc -l` on named paths.

## The eight steps

### 1. Check git first

Run `git --version`.

- Present: go on.
- Missing: explain in one or two sentences why it is needed — every version of the dataset is kept, any
  version can be restored, and each experiment reproduces exactly on the version it ran; the person never has
  to learn git — then **ask for consent** before installing:
  - macOS: `xcode-select --install` (Apple's Command Line Tools; a system dialog asks the person to confirm).
  - Windows: `winget install --id Git.Git -e --source winget`.
  - Linux: name the distribution's package (`sudo apt install git`, `sudo dnf install git`) and let the person run it.
- Refused, or the install fails: **stop**. Say plainly that datasets cannot be organized without git, and that
  they can come back any time. Do not improvise a non-git layout.

### 2. Look at the data

Before asking anything, look — read only:

- The tree: directories, file types, sizes, how many files (`find <source> -maxdepth 3 -type f | head -50`,
  `du -sh <source>`, `wc -l`).
- Record files (jsonl / json / csv / parquet): the record count and the fields of the first few records.
- Readmes, licenses, dataset cards. For a public benchmark, find the canonical source and its license.

Work out a candidate: item granularity (one record? one directory?), the item id (an existing unique field
such as `instance_id`, else `<split>-<index>` zero-padded), which fields the agent under test may see, which
are answers or checks, which are metadata.

### 3. Ask every key question in one go

One message (use `ask_user_question` when it is available), each question with your recommended answer so the
person can just accept:

1. **Name** — the registration name (`gsm8k`, `swe-bench-verified`); letters, digits, `._-`.
2. **Where the repository goes** — default `<datasets home>/<name>` (the request names the datasets home,
   normally `~/.dsh/datasets`). An existing repository is fine too.
3. **What the agent under test must not see** — your proposed split into visible / hidden layers, field by field.
4. **Scope** — every split and every record is converted by default; ask only whether the splits become one set
   or several.
5. Anything genuinely ambiguous you found (duplicate ids, broken records, licensing).

Then wait. Do not start converting before the answers are in. Ask again later only if something new and
blocking turns up.

### 4. Never modify the original data

The original directory is read-only to you: no edits, renames, moves, re-encodings, deletions, or "cleanup" in
place — not even of obviously broken files. Everything you produce goes into the repository. When a record is
broken, carry it as is (or leave it out with a reason in the mapping) and tell the person; never repair the
source.

Record provenance outside `datasets/` so agents never see it: `provenance/sources.json` with each source file's
path, size, and sha256, plus the URL and license for public data.

### 5. Convert the whole dataset — no sampling

- Write the conversion as a script in the repository (`tools/convert.py` or similar, outside `datasets/`), run it
  over **every** record, and make it deterministic and re-runnable (same input → byte-identical output).
- Count in, count out: records read = items written + records left out with a reason. Check it before committing.
- Never "do the first 50 and sketch the rest". A partial conversion is a different dataset.

Target layout (protocol §1–§2):

```
datasets/<set>/
  dataset.json                 # id = <set>, name, layers (every layer states modelFacing), optional canary
  items/<item-id>/
    item.json                  # metadata only — ALWAYS visible to agents; never answers, hints, or notes
    <layer>/<files…>           # e.g. prompt/, verify/, grading/
```

- Every layer declares `modelFacing` explicitly. Answers, gold patches, tests, and rubrics go to
  `modelFacing: false` layers.
- Nothing sensitive in `item.json` or loose files: both are visible to every agent. A file that sits in no
  layer is visible too — the review flags it.
- Keep original file names where they help the person recognize them; `register` (protocol §2) can map free
  paths onto layers instead of moving files.

### 6. Give every file and every field a disposition

The proposal's `mapping` must explain everything — the plugin checks it against the repository and the original
directory, and any gap blocks confirmation:

- `mapping.sources` — every file of the original directory (relative to `source.path`; a trailing `/` covers a
  directory, `*` matches within one path segment): `split` (records became items), `copy` (copied as is), or
  `unused` (with a `reason`). `split`/`copy` name a `target`. A split record file lists **every field** of its
  records (`to` where it went, or `reason` why dropped) and its record `count`; `key` names the field whose value
  is the item id, so the person can look up any item's source record.
- `mapping.outputs` — every file under `datasets/`: `split` (cut from source records, with `from` and `field`),
  `copy` (`from`), or `new` (written by you: descriptors, generated metadata), optionally with an expected `count`.

### 7. Commit per batch

Commit as you go, one logical step per commit (descriptor and scaffold; converted items in batches of a few
hundred; provenance; fixes) with plain messages. Stage explicit paths (`git add datasets provenance tools`).
Never rewrite history the person may already have confirmed. Work on the branch the proposal will name (`main`
for a new repository).

### 8. Check until it passes, then propose and stop

- Run `datasets_propose_registration` with `dryRun: true` (the same checks the person's confirmation runs,
  including the protocol's validate). Fix every problem, commit, and run it again until `ok` is true. Answer
  each warning in `notes` or fix it.
- File the proposal: `datasets_propose_registration` without `dryRun`, with `layers` (one entry per declared
  layer: `visible` and a one-line `reason` a person can judge), two or three `samples`, and `notes`.
- Tell the person, in one or two sentences, that the proposal is waiting on the Datasets tab (「等你确认登记」)
  and what to look at first. Then stop.
- If the person sends it back, their note arrives in this session: fix, commit, dry-run, propose again.

### Updating a registered dataset

Work in the registration's checkout, commit, and propose again — the proposal becomes an update and the review
compares the registered version with the new one. Changes agents cannot see (hidden layers, files outside
`datasets/`) are followed automatically; any change agents can see waits for the person's confirmation.
Deletions are always listed — never delete items silently.

## Proposal shape (example: a jsonl QA set)

```json
{
  "repo": "~/.dsh/datasets/gsm8k",
  "registryId": "gsm8k",
  "purpose": "grade-school math reasoning",
  "source": { "kind": "public", "label": "GSM8K (openai/grade-school-math)", "path": "~/Downloads/gsm8k",
              "url": "https://github.com/openai/grade-school-math", "license": "MIT" },
  "layers": [
    { "set": "gsm8k", "layer": "prompt", "visible": true, "reason": "the question the agent answers" },
    { "set": "gsm8k", "layer": "grading", "visible": false, "reason": "worked solution and final answer" }
  ],
  "mapping": {
    "sources": [
      { "path": "train.jsonl", "disposition": "split", "target": "datasets/gsm8k/items/", "count": 7473,
        "fields": [ { "name": "question", "to": "prompt/question.md" },
                    { "name": "answer", "to": "grading/answer.md + grading/final.txt" } ] },
      { "path": "test.jsonl", "disposition": "split", "target": "datasets/gsm8k/items/", "count": 1319,
        "fields": [ { "name": "question", "to": "prompt/question.md" },
                    { "name": "answer", "to": "grading/answer.md + grading/final.txt" } ] },
      { "path": "README.md", "disposition": "unused", "reason": "dataset card; summarized in provenance/" }
    ],
    "outputs": [
      { "path": "datasets/gsm8k/dataset.json", "origin": "new" },
      { "path": "datasets/gsm8k/items/*/item.json", "origin": "new", "note": "split + index only", "count": 8792 },
      { "path": "datasets/gsm8k/items/*/prompt/question.md", "origin": "split", "field": "question", "count": 8792 },
      { "path": "datasets/gsm8k/items/*/grading/answer.md", "origin": "split", "field": "answer", "count": 8792 },
      { "path": "datasets/gsm8k/items/*/grading/final.txt", "origin": "split", "field": "answer",
        "note": "the number after ####", "count": 8792 }
    ]
  },
  "samples": [ { "set": "gsm8k", "item": "test-0001", "from": { "file": "test.jsonl", "line": 1 } } ],
  "notes": "Both splits are in one set; item.json carries split=train|test."
}
```

## Conversion references

### jsonl QA (GSM8K, MATH, TriviaQA-style)

- Item = one record. Id = an existing id field (set `key` to it), else `<split>-<index>` zero-padded to the
  split's width (`test-0001`).
- `prompt/question.md` ← the question (plus choices for multiple choice). `grading/` ← the answer, the
  rationale, the normalized final answer (`final.txt`) — all `modelFacing: false`.
- `item.json` ← split, source index, difficulty/subject if present. Never the answer.
- Every split converted. One set per split only when the person uses them differently.

### SWE-bench (Lite / Verified / full)

Source: jsonl or parquet with `instance_id, repo, base_commit, problem_statement, hints_text, patch,
test_patch, FAIL_TO_PASS, PASS_TO_PASS, version, environment_setup_commit, created_at`. Parquet: read with
`pandas`/`pyarrow` (ask before installing anything).

- Item id = `instance_id` (`key: "instance_id"`; `/` would be replaced by `-`, ids are usually safe already).
- `prompt/problem_statement.md` ← `problem_statement` (visible).
- `item.json` ← `repo`, `base_commit`, `version`, `environment_setup_commit`, `created_at` (all non-sensitive).
- `verify/test_patch.diff` ← `test_patch`; `verify/FAIL_TO_PASS.json`, `verify/PASS_TO_PASS.json` (hidden).
- `grading/gold.patch` ← `patch` (hidden).
- `hints_text`: ask. Default a separate `hints` layer, `modelFacing: false` (the "with hints" setting turns it on).

### Terminal-Bench

Source: `tasks/<task-id>/` directories with `task.yaml` (`instruction`, `difficulty`, `category`, `tags`,
author fields, timeouts), `Dockerfile`, `docker-compose.yaml`, `run-tests.sh`, `tests/`, `solution.sh` (or
`solution.yaml`), and other environment files.

- Item = one task directory; id = the directory name.
- `prompt/instruction.md` ← `task.yaml` `instruction` (visible). `item.json` ← difficulty, category, tags,
  timeouts (drop author emails with a reason).
- `env/` ← `Dockerfile`, `docker-compose.yaml`, and the files they build from (`copy`). Ask whether agents may
  read them; default `modelFacing: false` (the orchestrator builds the environment).
- `verify/` ← `run-tests.sh` and `tests/` (`copy`, hidden). `grading/` ← `solution.sh` / `solution.yaml` (hidden).
- Keep the task's own relative paths inside each layer so the scripts still run; or keep files in place and
  map them with `register`.
- Shared harness files at the source root (`shared/`, base images) go to a set-level layer, not into every item.

### Data already in the protocol layout

Let the check decide what to change — do not read every file first.

1. Look only at the top of the source (`ls`, `find <source> -maxdepth 2`) to confirm the layout
   (`<set>/dataset.json`, `<set>/items/`).
2. Put it in the target repository as is: copy the sets under `datasets/` (or clone, when the source is itself a
   repository with `datasets/` at its root), and commit.
3. **Right away**, before any edit: run `node {{packageDir}}/lib/cli.js validate --repo <target repository>` and
   `datasets_propose_registration` with `dryRun: true` (`source.kind: "protocol"`, `source.path` = the original
   directory, `mapping.sources` = one `copy` row per top-level entry with a trailing `/`, `mapping.outputs` =
   `{ "path": "datasets/", "origin": "copy" }`). These two results are your work list.
4. Fix exactly what they report (undeclared `modelFacing`, files in no layer, sensitive `item.json` fields,
   a `rubric.md` naming a leaf its `rubric.yml` does not declare, …), reading only the files an entry names.
   Commit, run both again, then propose.
