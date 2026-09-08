# Dataset Authoring Protocol

**Version: v1-rev4** · [中文](dataset-authoring-protocol.md)

This protocol defines what a dataset looks like inside a git repository. It is toolchain-independent: the `@khorsheed/dsh-datasets` plugin's validator, the bind form's prefill, and the `dataset-authoring` skill all derive from it. Every JSON example in this protocol feeds the validator's test fixtures directly (drift-proof by construction).

## 0. Mental model

A dataset = one `datasets/<dataset-id>/` directory in a git repository; a repository may hold many datasets. Version = git commit; an evaluation run pins `{repo, commit, datasetId}` through a snapshot.

Your files keep their names and their homes: roles are declared by the registration file (§2's `register`); the directory layout is merely the zero-configuration default.

## 1. Layout (the default form; free-form when using register)

```
datasets/<id>/
  dataset.json              # the registration file, see §2
  <any other top-level files/dirs>   # passthrough zone: readable by every bound session, unvalidated, outside the whitelist
  <layer>/…                 # dataset-level shared layer (the directory name must be declared in layers)
  items/<item-id>/
    item.json               # item metadata. ★ Same footing as the passthrough zone: unprotected, undeclared fields pass through — never put sensitive content here
    <layer>/<files…>        # item-level layers
```

## 2. dataset.json

```json
{
  "id": "harness-comparison",
  "name": "Harness comparison suite",
  "canary": "dsh-canary:harness-comparison:6f2a13c8-5d4b-4e77-9a10-2c8be5d4f031",
  "layers": [
    { "name": "visible", "modelFacing": true },
    { "name": "verify", "modelFacing": false },
    { "name": "grading", "modelFacing": false }
  ],
  "itemMetaSchema": {
    "type": "object",
    "properties": { "difficulty": { "type": "string" } }
  },
  "register": [
    { "item": "P0-placeholder", "layer": "visible", "files": ["task.md", "docs/*.md"] },
    { "item": "P0-placeholder", "layer": "grading", "files": ["answers/*", "answers/oracle/*"] }
  ]
}
```

- `id` must equal the directory name; `name` is optional; `layers` is non-empty, each with a segment-safe `name` (alphanumerics plus `._-`, no leading dot) and an optional `modelFacing` (default `true`).
- `canary` is optional: one globally unique string, recommended shape `dsh-canary:<dataset-id>:<uuid>`. Once declared, every text file of a visible layer (`modelFacing: true`, at both levels; a register-mapped file counts under its role layer) must contain it verbatim, and `validate` reports each file that does not as `CANARY_MISSING` (see §5). Its purpose is leak forensics: finding the string in some model's output later proves this dataset entered that model's training data. The plugin only checks — it never generates or injects a canary; the author mints it and embeds it.
- `itemMetaSchema` is optional and shape-checked as an object only (the plugin never runs full JSON-Schema validation).
- `register` is optional: explicitly maps free-form files inside an item's directory onto an `item`/layer role. **v1 constraints**: paths are item-relative and must stay inside the item directory (no absolute paths, no `..` segments); globs are single-level only (`*` never crosses `/`, no `**`); `item.json` may not be re-registered; a conflict with the layout form (the same display path covered by both the convention layer directory and a register entry of the same role) or a dangling exact path fails loud. A zero-match glob is allowed (content may arrive later).
- Discipline: every layer declares `modelFacing` explicitly; in a mixed-sensitivity dataset, a layer missing the key is warned (see §5).

## 3. Visibility discipline (the protocol's core; violating it leaks answers)

- `modelFacing` semantics: whether the layer may enter the model-visible surface (materialized into the execution environment, shipped to participants, readable by agent tools).
- **Safe by default**: when a session binding does not list layers explicitly, `modelFacing:false` layers are unreadable to the agent; reading a sensitive layer requires listing it deliberately — when you forget, the mechanism stops you. Datasets declaring no sensitive layer are unaffected (everything visible).
- **Consumer split**: the whitelist bounds the agent (tools + worktree materialization), never the human — in the UI a person always sees everything in their own repository (sensitive layers carry a `· sensitive` marker). The genuinely unprotected areas are the passthrough zone and item.json — they must be conspicuous in the interface, not hidden.
- Judging content → `modelFacing:false` layers, mounted by the orchestrator at judging time, invisible while working.
- Grading/answer content → `modelFacing:false` layers, never shipped; exporting or sharing them goes through a human confirmation gate.
- item.json and the passthrough zone are not whitelist-protected (mechanically outside layer filtering) — treat them as always visible; never put sensitive content there.
- Positive example: an item's sensitive annotations (hints carrying technical paths) live in the grading layer keyed by item id, e.g. `items/F1/grading/standards-notes.yml`.

## 4. Shared content

Content shared across items that carries visibility requirements (e.g. judging helpers) goes into a dataset-level layer `datasets/<id>/<layer>/` — never copied per item (strictness drifts).

## 5. Self-verification

When done, run `dsh-datasets validate` (or call the `datasets_validate` tool). Shape errors and a non-zero exit must be fixed until clean; warnings deserve a response, not silence. The warnings:

- `MODELFACING_UNDECLARED`: a layer that left modelFacing undeclared in a mixed-sensitivity dataset;
- `FIELD_NAME_SENSITIVE`: an item.json key containing a note / hint / answer / rubric / grading root (a cheap literal heuristic that catches "sensitive note written in the wrong place");
- `CANARY_MISSING`: in a dataset that declares a `canary`, a text file of a visible layer that does not contain the string. Text is decided by an extension whitelist — `.md` / `.txt` / `.yml` / `.yaml` / `.json` and extensionless files; everything else (images, archives) is skipped, as are `modelFacing: false` layers and item.json. A dataset with no `canary` is not checked at all. This is the one rule that reads file content, so it runs on `validate` only and never on the list/show summary.
- `UNREGISTERED_FILES`: files covered by no layer directory or register entry (they silently fall into the passthrough zone and become always-visible; single-level globs not covering subdirectories is the common trap).
- The eval contract directories (§6.1's `conditions/`, `plans/`, `schemas/`, `templates/`) are reported as UNREGISTERED_FILES by design: they live in the dataset-level passthrough zone and are outside the layer/register vocabulary.

## 6. Eval contracts (condition / plan / verdict)

This chapter brings the web-eval contract schemas into the protocol, alongside `dataseek.verify/1` and `dataseek.rubric/2`. They are validated and hashed by `@khorsheed/dsh-eval` (`dsh-eval validate` / `dsh-eval conditions hash`); the execution semantics belong to web-eval's orchestrator, and `dsh-datasets` does not interpret them. Every JSON example here is a validator fixture, and the schema documents are pinned against the code constants (`packages/eval/src/schema.ts`) by tests — **editing a schema here is editing the contract**.

### 6.1 Location: the dataset-level passthrough zone

The contract files live in four directories under the dataset directory (§1's passthrough semantics; `dsh-datasets validate` reporting them as UNREGISTERED_FILES is expected):

```text
datasets/<id>/
  conditions/<id>.json        # condition declaration (agent drafts, human reviews)
  conditions/<id>.lock.json   # the material record of a condition hash and its scoped home (tool-written)
  plans/<plan>.json           # run plan (agent drafts, human approves)
  schemas/<stage>.json        # stage structured schema (authoritative, see §6.6)
  templates/<name>.json       # run template (generated from the manifest from I2 on, never hand-written)
```

### 6.2 dataseek.condition/1 — the subject under test

One condition = one harness + a model declaration + a permission word + one scoped home + env key names; the hash of the whole is the condition's identity.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "dataseek.condition/1",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema",
    "harness",
    "model",
    "reasoning",
    "permissions",
    "instructions",
    "preset",
    "skills",
    "home",
    "env"
  ],
  "properties": {
    "schema": {
      "const": "dataseek.condition/1"
    },
    "harness": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "name",
        "version",
        "drive"
      ],
      "description": "The harness under test. version: null while undetected; drive: exec only (frozen decision 2).",
      "properties": {
        "name": {
          "type": "string"
        },
        "version": {
          "type": [
            "string",
            "null"
          ]
        },
        "drive": {
          "enum": [
            "exec"
          ]
        }
      }
    },
    "model": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "declared",
        "endpoint"
      ],
      "description": "The declared model and endpoint. null while unresolved; the orchestrator reads back what actually served (frozen decision 5).",
      "properties": {
        "declared": {
          "type": [
            "string",
            "null"
          ]
        },
        "endpoint": {
          "type": [
            "string",
            "null"
          ]
        }
      }
    },
    "reasoning": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "effort"
      ],
      "description": "Reasoning effort, pinned explicitly per harness (frozen decision 4).",
      "properties": {
        "effort": {
          "type": "string"
        }
      }
    },
    "permissions": {
      "enum": [
        "auto-approve",
        "danger-full-access",
        "normal",
        "read-only",
        "skip",
        "unrestricted",
        "workspace-write"
      ],
      "description": "The harness permission word; each harness accepts a subset of this union (protocol §6.2)."
    },
    "instructions": {
      "type": "string",
      "description": "System-instruction posture; \"none\" keeps the harness default."
    },
    "preset": {
      "type": [
        "string",
        "null"
      ],
      "description": "A named preset the condition runs under, or null for none."
    },
    "skills": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "pack"
      ],
      "description": "The skill pack materialized into the condition's environment, or null for none.",
      "properties": {
        "pack": {
          "type": [
            "string",
            "null"
          ]
        }
      }
    },
    "home": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "sha"
      ],
      "description": "sha of the scoped home's config content (see the protocol hash rules); null while not provisioned.",
      "properties": {
        "sha": {
          "type": [
            "string",
            "null"
          ]
        }
      }
    },
    "env": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "keys"
      ],
      "description": "Environment variable NAMES the condition injects — never values.",
      "properties": {
        "keys": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      }
    },
    "notes": {
      "type": "string",
      "description": "Review commentary; excluded from the condition hash (a comment edit is not a new factor)."
    }
  }
}
```

- `null` in the nullable fields (`harness.version`, `model.declared`, `model.endpoint`, `home.sha`) reads as "**unresolved**": validate lists it as a warning, and the pre-run readiness gate refuses it. `null` means "not known yet", not "none".
- The `permissions` vocabulary is given per harness: `dsh` → `unrestricted`; `claude-code` → `skip` or `normal`; `codex` → `danger-full-access`, `workspace-write`, `read-only`; `kimi` → `auto-approve`. The schema enum is the union; an out-of-vocabulary value for a known harness (e.g. dsh with `skip`) is a validator error.
- `env.keys` carries variable NAMES only. No values — especially credentials — ever enter a contract file.
- Example (fully resolved; the in-progress I1 hand-walked shape lives in the dataset repo's `conditions/dsh-exec.json`, its four null fields listed as warnings):

```json
{
  "schema": "dataseek.condition/1",
  "harness": { "name": "claude-code", "version": "2.1.236", "drive": "exec" },
  "model": { "declared": "claude-opus-5", "endpoint": "proxy" },
  "reasoning": { "effort": "default" },
  "permissions": "skip",
  "instructions": "none",
  "preset": null,
  "skills": { "pack": null },
  "home": { "sha": "4b329f9ebe6c7aa19339da9ac46cd90506af3e92d73713c8339966be071b4a74" },
  "env": { "keys": ["ANTHROPIC_BASE_URL"] }
}
```

### 6.3 dataseek.condition-lock/1 — the material record

`sha` is the condition hash (§6.5), recomputed by `dsh-eval conditions hash`; `home.sha` is the scoped-home content hash provision (I4) produced. A plan never writes shas — it writes condition ids (§6.4) and resolves them from this file; a missing lock means "not ready". Declaration vs reality mismatches (a lock lagging the condition file, a `home.sha` that no longer matches) come back as validate warnings and are refused by the readiness gate.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "dataseek.condition-lock/1",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema",
    "condition",
    "sha"
  ],
  "properties": {
    "schema": {
      "const": "dataseek.condition-lock/1"
    },
    "condition": {
      "type": "string",
      "description": "The condition id this lock was computed from."
    },
    "sha": {
      "type": "string",
      "description": "The condition hash at lock time; plans resolve their shas here."
    },
    "home": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "sha"
      ],
      "description": "Present once provision has materialized the scoped home.",
      "properties": {
        "sha": {
          "type": "string"
        }
      }
    }
  }
}
```

```json
{
  "schema": "dataseek.condition-lock/1",
  "condition": "claude-exec",
  "sha": "fb2bd2b2417d2c2f52b7fb3b133765e1a439ed89e318d685d20a014fa4632671",
  "home": { "sha": "4b329f9ebe6c7aa19339da9ac46cd90506af3e92d73713c8339966be071b4a74" }
}
```

### 6.4 dataseek.plan/1 — all inputs of one run

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "dataseek.plan/1",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema",
    "dataset",
    "conditions",
    "reps",
    "stages",
    "order",
    "budget",
    "expectedNs"
  ],
  "properties": {
    "schema": {
      "const": "dataseek.plan/1"
    },
    "dataset": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "repo",
        "commit",
        "id",
        "items"
      ],
      "description": "What is being tested against. commit: null means the snapshot pins it at run start.",
      "properties": {
        "repo": {
          "type": "string"
        },
        "commit": {
          "type": [
            "string",
            "null"
          ]
        },
        "id": {
          "type": "string"
        },
        "items": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      }
    },
    "conditions": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Condition IDs (file names), not hashes; hashes resolve from conditions/<id>.lock.json."
    },
    "reps": {
      "type": "integer",
      "description": "Independent samples per cell; each rep is its own mission."
    },
    "stages": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Stage names, each backed by schemas/<stage>.json."
    },
    "order": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "seed",
        "interleave"
      ],
      "description": "Execution order; the seed is recorded with the run (frozen decision 11).",
      "properties": {
        "seed": {
          "type": "integer"
        },
        "interleave": {
          "type": "boolean"
        }
      }
    },
    "budget": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "activeMinutes",
        "turns"
      ],
      "description": "Per-cell budget in active minutes (not wall clock) and delegation turns.",
      "properties": {
        "activeMinutes": {
          "type": "number"
        },
        "turns": {
          "type": "integer"
        }
      }
    },
    "judge": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "conditions",
        "samples"
      ],
      "description": "Optional. The judge is itself a condition; absent judge means no LLM judging this run.",
      "properties": {
        "conditions": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "samples": {
          "type": "integer"
        }
      }
    },
    "expectedNs": {
      "type": "array",
      "items": {
        "enum": [
          "script",
          "llm-draft",
          "human-final"
        ]
      },
      "description": "Verdict sources this run expects; the report marks the missing ones honestly."
    },
    "retry": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "infrastructure"
      ],
      "description": "Optional. Per-cell infrastructure-retry budget (spawn failures, facade errors, timeouts). Run-call options may override.",
      "properties": {
        "infrastructure": {
          "type": "integer",
          "description": "Maximum infrastructure retries per cell; 0 disables retrying. Default 1."
        }
      }
    },
    "exports": {
      "type": "string",
      "description": "Optional. Bundle export directory (~/… allowed); default <dataset repo>/exports. Run-call options may override."
    },
    "notes": {
      "type": "string",
      "description": "Review commentary; not part of any hash."
    }
  }
}
```

- `conditions` and `judge.conditions` carry **condition ids** (file names), never shas; the validator resolves shas from `conditions/<id>.lock.json` and run.meta records them.
- `judge` may be absent entirely: when it is, `expectedNs` must not contain `llm-draft` (validate cross-checks). A present judge with `samples: 0` legally means "no LLM judging in this run"; the report then marks llm-draft honestly missing.
- The judge must not be a contestant: `judge.conditions` and `conditions` must be disjoint (validate errors).
- `retry.infrastructure` and `exports` are both optional: the first is the per-cell infrastructure-retry budget (spawn failures, facade errors, timeouts), default 1, `0` disabling retries; the second is the bundle export directory (`~/…` allowed), default `<dataset repo>/exports`. Both are **reviewed defaults** — the run call options (`retryInfrastructure` / `exportsDir`) override them, so the plan is what review reads and the options are what a one-off run bends.
- A plan carries **no template field**: the run template is a deterministic function of the dataset manifest, generated and linted at validate time and reviewed alongside the plan (I2).
- `dataset.commit` of `null` means "pinned by the snapshot at run start"; run.meta records the actual commit.
- Example:

```json
{
  "schema": "dataseek.plan/1",
  "dataset": { "repo": "~/dataseek", "commit": null, "id": "harness-comparison", "items": ["F2-multi-agent-room", "F3-self-restart-report"] },
  "conditions": ["codex-exec", "claude-exec"],
  "reps": 3,
  "stages": ["stage1", "stage2"],
  "order": { "seed": 42, "interleave": true },
  "budget": { "activeMinutes": 60, "turns": 10 },
  "judge": { "conditions": ["judge-claude"], "samples": 2 },
  "expectedNs": ["script", "llm-draft", "human-final"],
  "retry": { "infrastructure": 1 },
  "exports": "~/dataseek/exports",
  "notes": "commit 在 run 启动时由 snapshot 钉入；conditions 与 judge.conditions 都写条件 id，sha 由 conditions/<id>.lock.json 解析。retry 与 exports 是 run 的默认值，run 调用选项可覆盖。"
}
```

### 6.5 dataseek.verdict/1 — the verdict output

Both probe scripts and judges emit this shape; the orchestrator writes it into the corresponding ns (`script` / `llm-draft` / `human-final`) and the report tabulates from it. `by` records where the verdict came from: a probe path, a judge condition, or the judge bench.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "dataseek.verdict/1",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema",
    "task",
    "criterion",
    "pass",
    "evidence",
    "by"
  ],
  "properties": {
    "schema": {
      "const": "dataseek.verdict/1"
    },
    "task": {
      "type": "string"
    },
    "criterion": {
      "type": "string"
    },
    "pass": {
      "type": "boolean"
    },
    "ratio": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "passed",
        "total"
      ],
      "description": "Optional partial credit for a proportional criterion (rubric 的「按比例给分」). pass stays the boolean fact — the criterion FULLY holds — and ratio refines it; a reader that ignores ratio degrades to the strict boolean, never upward.",
      "properties": {
        "passed": {
          "type": "integer"
        },
        "total": {
          "type": "integer"
        }
      }
    },
    "evidence": {
      "type": "string",
      "description": "A checkable fact, not an opinion."
    },
    "by": {
      "type": "string",
      "description": "Where the verdict came from: probe path, judge condition, or the judge bench."
    }
  }
}
```

```json
{
  "schema": "dataseek.verdict/1",
  "task": "F2-multi-agent-room",
  "criterion": "R3",
  "pass": true,
  "evidence": "quorum 在 12:04:11 达成：3/3 成员发出 arrival 事件（probes/dispatch-trace.mjs）",
  "by": "probes/dispatch-trace.mjs"
}
```

**`ratio` — criteria scored proportionally.** Some criteria are not binary by nature: F2 / F3's `C1` (core standards passed) and `C2` (bonus standards passed) say «scored proportionally» in the rubric itself. Such a verdict carries an optional `ratio: {passed, total}`:

```json
{
  "schema": "dataseek.verdict/1",
  "task": "F2-multi-agent-room",
  "criterion": "C1",
  "pass": false,
  "ratio": {
    "passed": 6,
    "total": 9
  },
  "evidence": "core 标准 R1 R2 R3 R5 R6 G1 通过，R4 R7 B2 未过（../verify/ 判定结果）",
  "by": "probes/standards-run.mjs"
}
```

Three rules:

- **`ratio` refines `pass`; it does not replace it.** `pass` remains the boolean fact — **the criterion fully holds**, i.e. `passed === total` for a proportional one. A consumer that does not understand `ratio` degrades to the strict boolean: it can only under-count, never over-count.
- **The proportion is a field, not a phrasing.** A verdict source **must not** encode the proportion in an `evidence` prefix (`通过 6/9 …` and the like) — that makes every consumer parse prose, and the parsing breaks silently the moment the prose is reworded. `evidence` still states the checkable fact (which ones passed, which did not, where to check); the proportion's *value* travels only in `ratio`.
- **The denominator is the one the verdict source saw.** `total` is the number of items actually judged this time: entries the rubric allows excluding (e.g. standards the contestant listed in `skipped_standards` with a reason) stay out of the denominator, and `ratio` records the figure after that deduction. Guarding against dilution is the verdict source's job; the report does not re-derive it.

`dsh-eval report` scores accordingly: a criterion carrying `ratio` contributes `passed / total` rather than 1/0 (a negative criterion contributes `1 − passed / total`), and the weighted score multiplies `weight` by the same fraction. A ratio with `total <= 0` or a `passed` out of range is treated as absent and falls back to the boolean — bad data must not quietly become a score.

**Polarity is not in the verdict; it is in the rubric.** `pass` always means **the criterion holds**, exactly as the criterion is worded, and never "this went well". A negative criterion words a DEFECT ("the tradeoff says worth-the-cost", "the design pushes protocol knowledge onto the user"), so its holding means the defect is present. Polarity is therefore a property **of the criterion**, and its single source is the leaf in that item's grading-layer rubric: `negative: true` (a negative `weight` is the equivalent statement; a disagreement between the two is an error from `dsh-eval validate`).

The boundary is deliberate, for three reasons:

- **Verdict sources do not interpret.** A probe and a judge answer one question — does this criterion hold — and it is checkable on the spot. Letting them invert buries the scoring policy in two independent implementations that are also replaceable; the same criterion would then come back with opposite `pass` values from the probe and the judge, each side honestly reporting.
- **The contract must not move when the scoring does.** A verdict is a RECORD of a judgement, not a score. Adding a field (`negative`, `score`, `polarity`) gives one fact two statements, and annotations are append-only — change the scoring rule once and every historical verdict is void.
- **Polarity is the dataset author's editorial call.** Whether a criterion rewards or penalizes is written in the rubric and does not depend on how often it was judged; the rubric freezes with the run's commit, so every historical verdict can still recover the polarity it was judged under.

`dsh-eval report` scores accordingly. The main axis is the **scored-criterion count**: a positive criterion scores 1 when it holds, a negative one scores 0 when it holds and 1 when it does not. The weighted score is the sum of `weight` over the criteria that HOLD — a negative weight subtracts on its own, with no second rule. The summary carries a separate «negative criteria that held» table (which cell, which criterion, what evidence); that list, not the count, is what a reader comes for.

**The weight table rides with the bundle.** A rubric lives in the `modelFacing: false` grading layer and a run's automatic export includes visible layers only (§3 — the leak gate is right), so a self-contained bundle can read neither polarity nor weights. The export therefore DERIVES a weight table from the grading layer and writes it into the bundle as `report/rubric-weights.json`:

```text
{ "schema": "dataseek.rubric-weights/1",
  "dataset": <dataset id>, "commit": <frozen commit>,
  "tasks": [<tasks that ship a rubric>],
  "criteria": [ { "task", "id", "weight", "negative", "kind", "axis" }, … ] }
```

Identifiers and numbers only: **no criterion text, no evidence, no notes**, which is why it does not pass through the leak gate; the executable probes and the rubric itself still stay out of the bundle. With the table absent the report behaves as before (counts only) but prints plainly that the polarity is unknown and the counting assumes every criterion positive, and reports the negative-criterion count as unknown — **"cannot tell" is never rendered as "no defects"**.

### 6.6 Hash rules and stage schemas

- **Condition hash** = sha256 (lowercase hex) of the canonical JSON (all keys sorted, no whitespace). `notes` is review commentary and **never a hash input** — editing a comment is not a new condition; any other field change mints a new hash. The same input always yields the same digest.
- **home.sha** = the scoped home's content hash. Only config-suffixed files (`.json .jsonc .yml .yaml .toml .ini .cfg .conf .xml .properties`) qualify, fed to sha256 as `<relPath>\0<content>\0` in byte-sorted relative-path order. **Deny list**: files named `auth.json` or `.env*`; file names containing `token` / `key` / `credential` / `secret` / `password` / `auth` (case-insensitive); the `credentials/`, `oauth/`, `sessions/`, `keys/`, `secrets/` directories whole; symlinks, non-regular files, and oversize files (> 1 MiB). File content feeds the digest only — it is **never logged and never printed**.
- **Stage schemas**: a stage's structured schema is authoritative at the dataset level as `schemas/<stage>.json` (the JSON Schema subset: `type` / `required` / `properties` / `items` / `if` / `then` / `const` / `enum` / `additionalProperties`). Both mission's schema-check guard and `dsh-eval validate` accept exactly this subset — anything outside it is an error. The dataset manifest's `output_schema` becomes a **file-name reference** instead of an inline schema; the ad-hoc `type: enum` notation and the markdown notation are retired. Migrating the dataset repos is later work.

### 6.7 The probe contract — how `script` verdicts are produced

`script` is the one deterministic source of the three, and only probes write it. A probe is an executable the item ships **under any `probes/` segment of that item's verify layer**, suffixed `.mjs` or `.sh` (`probes/room-identity.mjs` counts, and so does a register-rehomed `checks/probes/x.sh`).

**The invocation** (the orchestrator runs each probe once the cell has finished its stages and entered `judged`):

```text
<probe> --cell <cell directory> --rubric <rubric path> --out <verdicts.json>
```

| Argument | Meaning |
|---|---|
| `--cell` | The player's cell working directory. The probe **reads** it — judging does not modify what is being judged |
| `--rubric` | Host-side copy of the item's grading-layer rubric. **Omitted entirely** when the item ships no rubric |
| `--out` | Where the probe writes its verdicts |

**The exit code is the contract**: `0` means **judged** — including `pass: false`, because "did it hold?" and "could the probe tell?" are different questions; non-zero means **the probe failed** and produces no verdict at all, with the reason recorded in the orchestrator ns. Exiting `0` without leaving a readable `--out` counts as a probe failure too: it claimed a judgement and then produced nothing checkable.

**The output** is an **array** of §6.5 `dataseek.verdict/1` documents (a lone object is accepted as a one-element array). A proportionally scored criterion carries `ratio: {passed, total}` and **never encodes the proportion in an `evidence` prefix** (§6.5). `task` and `by` are overwritten by the orchestrator (`by` = the probe's display path in the verify layer) whatever the probe wrote: those two are coordinates the orchestrator knows and the judging side only echoes — getting them wrong would corrupt every join the report performs.

**The execution environment**: the orchestrator materializes the item's **whole** verify layer into a host-side temporary directory and uses it as the cwd (so a probe can read the checklist and helpers beside it by relative path), runs `.mjs` under node and `.sh` under `/bin/sh` with a five-minute wall-clock cap each, and removes the directory afterwards — the verify layer is the answer key and does not stay overnight. From I3 this step is executed inside the container by `lab.verify`; **the contract is unchanged**.

**Where it lands**: verdicts go to mission's `script` ns and to `attempt-N/archive/verdicts/script.json`. An item with no probes writes nothing at all — no empty file, no empty annotation.

### 6.8 The judge contract — how `llm-draft` verdicts are produced

`llm-draft` is written by a **judge condition**. The judge is itself a `dataseek.condition/1` (§6.2), not a session with tools; the plan's `judge` block (§6.4) names it and says how many samples to take. Three methodological constraints are enforced by the orchestrator:

1. **The judge must not be a contestant.** The validator refuses an id that appears on both lists; before executing, the orchestrator compares `(harness.name, model.declared)` as well — two different ids naming the same subject is still a judge grading itself.
2. **De-fingerprint before judging.** In the judged material (`stage1.json` / `stage1.md` / `stage2.json` / `stage2.md`), harness names, CLI names and self-reported assistant names all become `<harness>`, and every model identifier the plan's conditions declare or the delegations read back becomes `<model>`. The replacement table and its counts go to the orchestrator ns; **the originals are never rewritten** — the judge always sees a copy.
3. **At least two samples.** Each judge condition runs `judge.samples` times independently (default 2), each a **fresh delegation** — a resumed judge would see its own previous answer and stop being an independent sample. The report turns these into an agreement rate and Cohen's κ.

**The judge prompt** is assembled by the orchestrator, never carried by the judge: the `kind: llm-draft` criteria of the item's grading-layer rubric (`objective` rows belong to the probes and `human` rows to the judge bench — neither is shown), plus the de-identified material, plus the output requirement. The rubric is selected as "the grading-layer display path whose file name is `rubric.yml` / `rubric.yaml`, shortest path wins", which covers both item layouts (the conventional `rubric.yml` and a register-rehomed `answers/rubric.yml`).

**The output** has the same shape as a probe's: the judge writes the §6.5 array into `verdicts.json` in its own cwd, and `task` and `by` (= the judge condition id) are backfilled by the orchestrator. An unreadable answer is recorded in the orchestrator ns and **retried exactly once**; a second failure drops that sample honestly rather than inventing one.

**Where it lands**: one `llm-draft` annotation per sample, shaped `{sample, judgeCondition, judgeSha, promptSha, verdicts}` — provenance beside the verdicts, with the report unwrapping the envelope for `verdicts` — plus `attempt-N/archive/verdicts/llm-draft-<judge condition>-<sample>.json`. The judge's usage and duration go to the orchestrator ns under `kind: judge` and are **kept out of the contestants' efficiency table**. The judge material directory (prompt + de-identified material + the judge's answer) is retained after the run for review.

The grading and verify layers are read through the datasets service face with an **explicit single-layer scope** (`layers: ['grading']` / `['verify']`) and materialized into host-side judge and probe directories — **never into a player's cell**.
