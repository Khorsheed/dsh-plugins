# Dataset Authoring Protocol

**Version: v1-rev2** · [中文](dataset-authoring-protocol.md)

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
  "notes": "commit 在 run 启动时由 snapshot 钉入；conditions 与 judge.conditions 都写条件 id，sha 由 conditions/<id>.lock.json 解析。"
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

### 6.6 Hash rules and stage schemas

- **Condition hash** = sha256 (lowercase hex) of the canonical JSON (all keys sorted, no whitespace). `notes` is review commentary and **never a hash input** — editing a comment is not a new condition; any other field change mints a new hash. The same input always yields the same digest.
- **home.sha** = the scoped home's content hash. Only config-suffixed files (`.json .jsonc .yml .yaml .toml .ini .cfg .conf .xml .properties`) qualify, fed to sha256 as `<relPath>\0<content>\0` in byte-sorted relative-path order. **Deny list**: files named `auth.json` or `.env*`; file names containing `token` / `key` / `credential` / `secret` / `password` / `auth` (case-insensitive); the `credentials/`, `oauth/`, `sessions/`, `keys/`, `secrets/` directories whole; symlinks, non-regular files, and oversize files (> 1 MiB). File content feeds the digest only — it is **never logged and never printed**.
- **Stage schemas**: a stage's structured schema is authoritative at the dataset level as `schemas/<stage>.json` (the JSON Schema subset: `type` / `required` / `properties` / `items` / `if` / `then` / `const` / `enum` / `additionalProperties`). Both mission's schema-check guard and `dsh-eval validate` accept exactly this subset — anything outside it is an error. The dataset manifest's `output_schema` becomes a **file-name reference** instead of an inline schema; the ad-hoc `type: enum` notation and the markdown notation are retired. Migrating the dataset repos is later work.
