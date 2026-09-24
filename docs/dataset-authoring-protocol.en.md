# Dataset Authoring Protocol

**Version: v1-rev13** · [中文](dataset-authoring-protocol.md)

This protocol defines what a dataset looks like inside a git repository. It is toolchain-independent: the `@khorsheed/dsh-datasets` plugin's validator and the bind form's prefill derive from it. The `dataset-authoring` skill is also planned to derive from this protocol, but remains planned and is not yet distributed with `@khorsheed/dsh-datasets`. Every JSON example in this protocol feeds the validator's test fixtures directly (drift-proof by construction).

## 0. Mental model

A dataset = one `datasets/<dataset-id>/` directory in a git repository; a repository may hold many datasets. Version = git commit; an evaluation experiment pins `{registry, set, commit}` (registration id, dataset set, commit), and run.meta records it (v1-rev13).

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
- The eval contract directories (§6.1's `schemas/`, `templates/`, and the `conditions/`, `plans/` left from before rev13) are reported as UNREGISTERED_FILES by design: they live in the dataset-level passthrough zone and are outside the layer/register vocabulary.

## 6. Eval contracts (condition / plan / verdict)

This chapter brings the web-eval contract schemas into the protocol, alongside `dataseek.verify/1` and `dataseek.rubric/2`. They are validated and hashed by `@khorsheed/dsh-eval` (`dsh-eval validate` / `dsh-eval conditions hash`); the execution semantics belong to web-eval's orchestrator, and `dsh-datasets` does not interpret them. Every JSON example here is a validator fixture, and the schema documents are pinned against the code constants (`packages/eval/src/schema.ts`) by tests — **editing a schema here is editing the contract**.

### 6.1 Location: the dataset repository is read-only; eval records live on the deployment (v1-rev13)

The dataset repository is the evaluation's **read-only input**: items and stage schemas live under the dataset directory, and eval reads them from the registered repository (an id in `/datasets registry`) at the commit the plan pins — it never writes back.

```text
datasets/<id>/
  schemas/<stage>.json        # stage structured schema (authoritative, see §6.6)
  templates/<name>.json       # run template (generated from the manifest from I2 on, never hand-written)
```

Conditions, plans and analyses are an evaluation's **own** records. They live on the deployment (`$DSH_HOME/state/eval/`), never in the dataset repository:

```text
$DSH_HOME/state/eval/
  conditions/<id>.json          # condition declaration (the deployment's condition library; agent drafts, human reviews)
  conditions/<id>.lock.json     # the material record of a condition hash and its scoped home (tool-written)
  experiments/<experimentId>/
    plan.json                   # run plan (agent drafts, human approves; kept byte for byte)
    meta.json                   # name, originSession, createdAt, dataset {registry, set, commit}, experimentId
    analysis/                   # analysis drafts (the only place eval_analysis_write may write)
    exports/                    # default bundle export directory
```

Up to rev12, `conditions/` and `plans/` (and `analysis/`) sat under the dataset directory. Those files in an older repository stay readable: `dsh-eval import --from <registration id>@<ref>` moves a plan byte for byte into a deployment experiment through `git show` and merges the conditions it names into the library (the same id with different content is refused); nothing writes them on the dataset side any more.

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
    "scope": {
      "type": "string",
      "description": "Optional. The harness scoped home this condition runs against, as a NAME (matching [a-z0-9-], never a path): the family resolves it to <homesRoot>/<harness>@<scope>, a sibling of the default scoped home with its own credentials, session records and delegation mappings. Absent means the harness's default scoped home — what every condition written before this field says. It IS part of the condition hash: two conditions differing only in scope are two subjects, because they log in as two accounts."
    },
    "unit": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "scopedHome"
      ],
      "description": "Optional. What this condition needs INSIDE a container unit. Required of every condition a plan with a unit segment names; absent on the host path. It IS part of the condition hash: where a subject reads its credentials from is a factor, not a comment.",
      "properties": {
        "scopedHome": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "container",
            "var"
          ],
          "description": "The condition's scoped credential directory as the UNIT sees it. The host side is never written here: the orchestrator mounts the evaluation instance's own scoped home for that harness — the directory /<harness> login writes into, and the one the delegation read-back reads.",
          "properties": {
            "container": {
              "type": "string",
              "description": "Absolute in-container mount point, e.g. /creds/codex."
            },
            "var": {
              "type": "string",
              "description": "The variable naming it inside the unit (CODEX_HOME / CLAUDE_CONFIG_DIR / KIMI_CODE_HOME / DSH_HOME); must also appear in env.keys."
            }
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
- `model.declared` is a REQUEST, not only a claim (T30b). When it is non-null the orchestrator passes it to local-agent as the delegation's `model`, which lands as each harness's own CLI model flag — the same in player rounds, judge delegations and the readiness probe. `null` still means "unresolved" and still passes no model flag at all, leaving the harness's own configuration to decide. The read-back comparison is unchanged after the request: ask for X, run Y, and it is still a MisattributedRun. The contract's SHAPE did not change; what changed is that this field went from "only compared" to "requested, then compared".
- The `permissions` vocabulary is given per harness: `dsh` → `unrestricted`; `claude-code` → `skip` or `normal`; `codex` → `danger-full-access`, `workspace-write`, `read-only`; `kimi` → `auto-approve`. The schema enum is the union; an out-of-vocabulary value for a known harness (e.g. dsh with `skip`) is a validator error.
- `model.endpoint` is the UPSTREAM ROUTE (frozen decision 5: the endpoint belongs to the subject under test). Only two spellings are checkable: `"default"` — no base URL in force, so the CLI's own endpoint — or the endpoint's URL or hostname, where `"https://api.anthropic.com"` and `"api.anthropic.com"` are equivalent (provision reduces a URL to its host before comparing: a path can carry tenant or project ids, so the harness family only ever reports a hostname). A label like `"proxy"` names no endpoint anyone can check; provision calls it a mismatch and writes no lock. `null` still means "unresolved".
- `env.keys` carries variable NAMES only. No values — especially credentials — ever enter a contract file.
- `scope` may be omitted, and omitting it means "run against this harness's default scoped home" — what every condition written before this field says. Naming one (a `[a-z0-9-]` NAME, never a path) runs the condition against `<homesRoot>/<harness>@<scope>` instead: a SIBLING of the default directory with its own login, its own session records and its own `delegations.jsonl`. Credentials are never copied into it. It IS part of the condition hash: two conditions differing only in `scope` are two SUBJECTS, because they log in as two accounts — which is how one run compares two logins of one harness (the factor I4's per-delegation model, per-condition provisioning and two-preset pilot all rest on). The readiness probe probes each condition's own scope, and a container cell mounts each condition's own directory. A scoped delegation is exec-only (the live drivers bind the default scoped home), and kimi's member bridge stays bound to the default scope too.
- `preset` is meaningful only for a subject THIS family composes. Today that is `dsh` alone: the sub-profile inside its scoped home is written by the evaluation instance, and the preset roster is a layer of that same patch. The three external CLIs run their vendor's own composition, which this family cannot compose — a `preset` for one of them is a claim with no counterpart, so validate refuses it (`PRESET_NOT_FOR_HARNESS`) and the only legal value is `null`. Their equivalent is `skills.pack` (a skill pack materialized into the scoped home), which this family does not provision yet either; that is I6.
- A non-null `preset` REQUIRES `capabilities` inside the lock's `provisioned` block: the CAPABILITY HASH capability-catalog computes over the provisioned environment (the canonical form keeps each skill's name/source/body-sha and each tool's name/channel/parameters — descriptions stay out, because rewording one must not mint a new subject). Without it the readiness gate refuses before spending a single delegation (`CAPABILITIES_NOT_PROVISIONED`): `preset` enters the condition hash, so two conditions differing only in preset are two subjects, and nobody measuring it leaves them two subjects on paper and one in fact. A record whose `preset` disagrees with the declaration is refused the same way — what was provisioned belongs to another subject.
- `capabilities.source` says WHICH preset directory was measured. `scope-snapshot`: the scoped home keeps its own byte-identical copy (`<scoped home>/.agent-presets/<id>`), which is the only arrangement a container round can use — a unit bind-mounts the scoped home and nothing else, so a roster pointed at the deployment's preset root names a path the unit does not have. `instance-root`: the scope defers to the deployment's root — measurable, and resolvable only on the host path.
- `scope-snapshot` also carries `capabilities.snapshot.sha`: the digest of EVERY file in that copy, `SKILL.md` included. It is not a second opinion about the capability face; it is the only evidence an OFFLINE reader has that the subject is still the one that was measured — `home.sha` hashes config-suffixed files by design and never moves when a skill body is edited, and the capability face needs a live catalog. The readiness gate and `validate` both re-check it and refuse a disagreement, naming `conditions provision`.
- A preset used as a factor may NOT name an absolute path in its `agent.cordis.yml`. The same preset is read from three directories (the deployment's preset root, the scope's copy, the unit's mount point), so an absolute path is wrong in at least two of them — and wrong silently, since `skill-filesystem` treats a root it cannot read as an empty one. The form that travels is the loader's own expression, as the shipped `cordis` preset writes it: `!!js "process.getBuiltinModule('node:url').fileURLToPath(new URL('skills/', baseUrl))"`, where `baseUrl` is the composition's own directory. A preset naming an absolute path is refused both where the copy is made and where it is measured.
- `unit` may be omitted, and omitting it means "this condition only ever runs on the host". A plan that declares a `unit` REQUIRES it: `unit.scopedHome` says where this condition's credential directory is mounted inside the unit and which variable names it (`CODEX_HOME` / `CLAUDE_CONFIG_DIR` / `KIMI_CODE_HOME` / `DSH_HOME`), and `var` must also appear in `env.keys` — the name that gets injected has to be a name the document admits to injecting, which validate enforces as an error. The HOST side of that directory is deliberately absent: the orchestrator mounts the evaluation instance's own scoped home for that harness — the one `/<harness> login` writes into, and the one the delegation read-back reads. Mounting a COPY fails silently: a containerized round writes its rollout into whatever was bound, while the read-back looks under `homeDir(<harness>)`, and two different directories produce no error at all — just a read-back that is empty forever.
- `unit` IS part of the condition hash (only `notes` is not): where a subject reads its credentials from is a factor, not a comment. Adding `unit` to an existing condition changes its hash and stales its lock, which is a re-provision.
- Example (fully resolved; the in-progress I1 hand-walked shape lives in the dataset repo's `conditions/dsh-exec.json`, its four null fields listed as warnings):

```json
{
  "schema": "dataseek.condition/1",
  "harness": {
    "name": "claude-code",
    "version": "2.1.236",
    "drive": "exec"
  },
  "model": {
    "declared": "claude-opus-5",
    "endpoint": "https://api.anthropic.com"
  },
  "reasoning": {
    "effort": "default"
  },
  "permissions": "skip",
  "instructions": "none",
  "preset": null,
  "skills": {
    "pack": null
  },
  "home": {
    "sha": "4b329f9ebe6c7aa19339da9ac46cd90506af3e92d73713c8339966be071b4a74"
  },
  "env": {
    "keys": [
      "ANTHROPIC_BASE_URL",
      "CLAUDE_CONFIG_DIR"
    ]
  },
  "unit": {
    "scopedHome": {
      "container": "/creds/claude",
      "var": "CLAUDE_CONFIG_DIR"
    }
  }
}
```

### 6.3 dataseek.condition-lock/1 — the material record

`sha` is the condition hash (§6.5), recomputed by `dsh-eval conditions hash`; `home.sha` is the scoped-home content hash `dsh-eval conditions provision` (I4, landed in T31) produced. A plan never writes shas — it writes condition ids (§6.4) and resolves them from this file; a missing lock means "not ready". Declaration vs reality mismatches (a lock lagging the condition file, a `home.sha` that no longer matches) come back as validate warnings and are refused by the readiness gate.

**Only provision writes this file.** A hand-written lock claims the scoped home was checked when nobody checked it, so provision is the sole writer: it resolves the condition's `(harness, scope)` to a scoped home (reading it materializes it), stops unless that scope's credential is present and prints the login command if it is not (`/<harness> login --scope <name>` — provision never logs in and never copies a credential), checks the declaration against that scope's effective settings field by field, then hashes the home and writes the lock.

`provisioned` records that check, and is ADDITIVE in `/1`: a lock without it was written before provision existed, and validate reads that as "nobody ever checked" rather than as a violation. `preset` and `capabilities` are in turn additive WITHIN `provisioned`, and `capabilities.source` and `capabilities.snapshot` are additive within `capabilities` (v1-rev12): a lock without them is a complete record of what provision checked at the time, not a broken one. `at` is when provision ran; `cliVersion` is the version the CLI reported then (back-filled into the lock when the condition declares `harness.version: null` — the condition document is never rewritten); `effective` is what that scope answered for the four fields, with `null` meaning the harness has no such knob at all (dsh has no permission knob, which is exactly why its permission word is `unrestricted`).

The grading split is not arbitrary: `permissions` is the approval boundary (frozen decision 3) and `model.endpoint` is the upstream route (frozen decision 5), so those two ARE the subject under test — a disagreement is an error and NO lock is written. `harness.version`, `model.declared` and `reasoning.effort` disagreeing are warnings: a declared model differing from the harness default is normal since T30b (the declaration is the value REQUESTED per delegation), a missing reasoning knob is an honest absence, and a CLI version is a fact to record rather than to enforce. The comparable spellings of `model.endpoint` are `"default"` (no base URL in force) or the endpoint's URL or hostname (a URL is reduced to its host before comparing — a path can carry tenant ids, so the family only ever reports a hostname); a label like `"proxy"` names no endpoint anyone can check and reads as a mismatch.

validate re-checks with the same function: when a lock's `provisioned.effective` disagrees with the condition file on those two fields, the condition is "not ready" and the field is named. With the sha still matching, that can only mean the lock was not written by provision — which is exactly the forgery worth seeing.

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
    },
    "provisioned": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "at",
        "effective"
      ],
      "description": "What `dsh-eval conditions provision` read back off the scope it provisioned. ADDITIVE in /1: a lock written before provision existed simply has no such key, and validate reads its absence as \"provision has not run\" rather than as a violation.",
      "properties": {
        "at": {
          "type": "integer",
          "description": "Epoch ms the provision ran."
        },
        "cliVersion": {
          "type": [
            "string",
            "null"
          ],
          "description": "The harness CLI's own version as the CLI reported it; null when it could not be asked."
        },
        "effective": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "model",
            "reasoningEffort",
            "permissions",
            "endpoint"
          ],
          "description": "The four condition fields as the scope's effective settings answered them. null means the harness declares no such knob — which is itself the honest input, never a substituted guess.",
          "properties": {
            "model": {
              "type": [
                "string",
                "null"
              ]
            },
            "reasoningEffort": {
              "type": [
                "string",
                "null"
              ]
            },
            "permissions": {
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
        "preset": {
          "type": [
            "string",
            "null"
          ],
          "description": "The preset the provisioned environment composes, read back from what was written — not copied from the declaration. null means the environment rosters none."
        },
        "capabilities": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "sha"
          ],
          "description": "The capability fingerprint of the provisioned environment: the hash capability-catalog computes over its canonical skill/tool face (the `caps:` tag without its prefix). It is what turns the condition's `preset` claim into a checkable fact; absent means nobody measured it, and the readiness gate refuses a preset claim without it.",
          "properties": {
            "sha": {
              "type": "string",
              "description": "64-hex sha256 of the canonical capability face."
            },
            "preset": {
              "type": [
                "string",
                "null"
              ],
              "description": "The preset the snapshot was taken under."
            },
            "skills": {
              "type": "integer",
              "description": "How many skills the face carries (a reader aid; the sha is the identity)."
            },
            "tools": {
              "type": "integer",
              "description": "How many tools the face carries (a reader aid; the sha is the identity)."
            },
            "source": {
              "enum": [
                "scope-snapshot",
                "instance-root"
              ],
              "description": "Where the measured preset directory lives relative to the scope. `scope-snapshot`: the scoped home keeps its own byte-identical copy, which is the arrangement a container round needs (a unit bind-mounts the scoped home and nothing else). `instance-root`: the scope defers to the deployment's preset root — measurable, and resolvable only on the host path."
            },
            "snapshot": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "sha"
              ],
              "description": "The digest of the scope's own copy of the preset — EVERY file of it, SKILL.md included. Present only with source `scope-snapshot`. It is not a second opinion about the capability face: it is what lets the readiness gate and validate see, offline, that the subject is still the one that was measured. `home.sha` cannot — it hashes config-suffixed files by design, and a skill body is not one.",
              "properties": {
                "sha": {
                  "type": "string",
                  "description": "64-hex sha256 over the copy's `<relPath>\\0<content>\\0` stream, sorted by relPath."
                }
              }
            }
          }
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
  "home": {
    "sha": "4b329f9ebe6c7aa19339da9ac46cd90506af3e92d73713c8339966be071b4a74"
  },
  "provisioned": {
    "at": 1757500000000,
    "cliVersion": "2.1.236",
    "effective": {
      "model": "claude-opus-5",
      "reasoningEffort": null,
      "permissions": "skip",
      "endpoint": "api.anthropic.com"
    }
  }
}
```

A sub-dsh condition carries a few more lines — `provisioned.preset` is read back from the sub-profile that was written, `capabilities.sha` is the `caps:` tag without its prefix, and `source` / `snapshot` say that the scope's own copy was the thing measured and what that copy hashed to:

```json
{
  "schema": "dataseek.condition-lock/1",
  "condition": "dsh-exec-lean",
  "sha": "6d2e4f1b8c9a0731e5b4d6a2c8f3097b1e4a5d6c7b8a9012f3e4d5c6b7a80912",
  "home": {
    "sha": "9a1c3e5b7d9f0246810a2c4e6081a3c5e709b1d3f507192a3c5e7091b3d5f709"
  },
  "provisioned": {
    "at": 1757600000000,
    "cliVersion": "0.1.5-rc.1",
    "effective": {
      "model": "deepseek-official/deepseek-v4-pro",
      "reasoningEffort": "high",
      "permissions": "unrestricted",
      "endpoint": "default"
    },
    "preset": "eval-lean",
    "capabilities": {
      "sha": "2f8b6d40c1a9573e08b2d4f6a8c0e2941b3d5f7092a4c6e80b1d3f5709a2c4e6",
      "preset": "eval-lean",
      "skills": 3,
      "tools": 11,
      "source": "scope-snapshot",
      "snapshot": {
        "sha": "4c6e80b1d3f5709a2c4e62f8b6d40c1a9573e08b2d4f6a8c0e2941b3d5f7092a"
      }
    }
  }
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
    "name": {
      "type": "string",
      "description": "Optional. The experiment's display name; the experiment id is minted from it. An imported plan without one takes its file stem."
    },
    "dataset": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "commit",
        "items"
      ],
      "description": "What is being tested against: {registry, set, commit} — a registry id, a set inside that repository, and the full commit every contract file is read at (required). The legacy {repo, id} form (commit may be null) is read-only: old plans still validate and import, nothing writes it.",
      "properties": {
        "registry": {
          "type": "string",
          "description": "The dataset registration id (/datasets registry)."
        },
        "set": {
          "type": "string",
          "description": "The dataset set inside the registered repository."
        },
        "commit": {
          "type": [
            "string",
            "null"
          ],
          "description": "The pinned commit; required and non-null in the registry form."
        },
        "items": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "repo": {
          "type": "string",
          "description": "Legacy, read-only: a repository path."
        },
        "id": {
          "type": "string",
          "description": "Legacy, read-only: the set, beside repo."
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
      "description": "Optional. Bundle export directory (~/… allowed); default the experiment directory's exports/. Run-call options may override."
    },
    "unit": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "image"
      ],
      "description": "Optional. Present, every cell of this run executes inside one lab unit built from this image; absent, the run takes the host path unchanged. validate does not probe the docker daemon (it need not be reachable to review a plan) — the first acquire is the check.",
      "properties": {
        "image": {
          "type": "string",
          "description": "Image tag or digest of the dataset suite's env/ layer."
        },
        "network": {
          "type": "string",
          "description": "Docker network the units join. Undeclared is docker's default bridge, which HAS egress — a sealed run must name its internal network."
        },
        "user": {
          "type": "string",
          "description": "In-container user (uid[:gid]); undeclared is the image's own USER."
        },
        "resources": {
          "type": "object",
          "additionalProperties": false,
          "description": "CPU and memory ceilings; applied to the unit and hashed into its environment fingerprint.",
          "properties": {
            "cpus": {
              "type": [
                "string",
                "number"
              ]
            },
            "memory": {
              "type": [
                "string",
                "number"
              ]
            }
          }
        },
        "egressCheck": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "command"
          ],
          "description": "Optional. One command run INSIDE each freshly acquired unit — the readiness probe's before it delegates, each cell's between acquire and populate. Exit 0 passes; anything else (including a timeout) refuses the whole run as EGRESS_UNAVAILABLE, before a single delegation is spent. Declare it on any run whose units sit on an internal network: a unit that cannot reach its proxy does not fail, it answers NOTHING, which reads exactly like a subject with nothing to say. The command and its target live here, beside the network they belong to — the orchestrator holds no address of its own.",
          "properties": {
            "command": {
              "type": "array",
              "items": {
                "type": "string"
              },
              "description": "argv, run through lab.verify inside the unit (name a shell explicitly if you want one). Must be non-empty and carry no empty word — the run refuses an empty one as EGRESS_CHECK_MALFORMED, since this subset cannot say minItems."
            },
            "timeoutMs": {
              "type": "number",
              "description": "Budget for the check; default 30000, and must be positive. A proxy that is up answers in milliseconds — this is sized for a TLS handshake, not for a model."
            }
          }
        }
      }
    },
    "notes": {
      "type": "string",
      "description": "Review commentary; not part of any hash."
    }
  }
}
```

- `conditions` and `judge.conditions` carry **condition ids** (file names), never shas; the validator resolves shas from the deployment condition library's `conditions/<id>.lock.json` and run.meta records them.
- `judge` may be absent entirely: when it is, `expectedNs` must not contain `llm-draft` (validate cross-checks). A present judge with `samples: 0` legally means "no LLM judging in this run"; the report then marks llm-draft honestly missing.
- The judge must not be a contestant: `judge.conditions` and `conditions` must be disjoint (validate errors).
- `retry.infrastructure` and `exports` are both optional: the first is the per-cell infrastructure-retry budget (spawn failures, facade errors, timeouts), default 1, `0` disabling retries; the second is the bundle export directory (`~/…` allowed), default the experiment directory's `exports/`. Both are **reviewed defaults** — the run call options (`retryInfrastructure` / `exportsDir`) override them, so the plan is what review reads and the options are what a one-off run bends.
- A plan carries **no template field**: the run template is a deterministic function of the dataset manifest, generated and linted at validate time and reviewed alongside the plan (I2).
- `dataset` is `{registry, set, commit}` (v1-rev13): `registry` is the dataset registration id, `set` the dataset set in that repository, and `commit` is **required** and a full hash — every contract file the plan uses is read at that commit. Drafting without a commit, `eval_plan_draft` takes the tracked branch's latest, and refuses with the candidates listed when that disagrees in content (the `items/` and `schemas/` tree hashes) with the version pinned by existing experiments on the same set and conditions. The legacy `{repo, id, commit}` form (`commit` may be `null`, meaning pinned at run start) is **read-only**: old plans still validate and import, and no tool writes it any more.
- `name` is optional: the experiment's display name, from which the experiment id `<slug>-<yyyymmdd>-<4hex>` is minted; an imported legacy plan without one takes its file stem.
- `unit` may be omitted. Omitted, the run takes the **host path**: per-cell directories under `$DSH_HOME/state/eval`, no containers, byte for byte what it was before this field existed. Present, it takes the **container path**: every cell of the run goes acquire → populate → one delegation round and one checkpoint per stage → probes (inside the unit, through `lab.verify`) → archive → release, in one lab unit built from `image`. An undeclared `network` is docker's default bridge, which HAS egress — a sealed run must name its internal network; an undeclared `user` is the image's own `USER`; `resources` is both applied to the container and hashed into the environment fingerprint.
- `unit.egressCheck` may be omitted, and omitted it is byte for byte what the run was before this field existed. Present, it is the **egress self-check**: every freshly acquired unit runs this command first — the readiness probe's unit before it delegates, each cell's between acquire and populate. Exit 0 passes; anything else, a timeout included, refuses the whole run as `EGRESS_UNAVAILABLE` without spending one delegation. **A run on an internal network should declare it**: a unit that cannot reach its proxy does not fail, it answers NOTHING, which reads exactly like a subject with nothing to say (measured: codex ran 230 seconds in a unit with no egress and returned `task_complete` with `last_agent_message: null`, and not one word about the network). The command and its target live here, beside the network they belong to — the orchestrator holds no address of its own. A declaration whose `command` is empty or carries an empty word is refused as `EGRESS_CHECK_MALFORMED` (the contract subset has no `minItems`, so the run loop is the only place that can catch it).
- validate does NOT check that the image exists: reviewing a plan must not require a reachable docker daemon. The first `acquire` is that check.
- Example:

```json
{
  "schema": "dataseek.plan/1",
  "name": "harness-comparison-effort",
  "dataset": {
    "registry": "dataseek-eval",
    "set": "harness-comparison",
    "commit": "3f2a9c0e1b7d4a6f8e2c5b1d9a0f7e3c6b8d2a41",
    "items": [
      "F2-multi-agent-room",
      "F3-self-restart-report"
    ]
  },
  "conditions": [
    "codex-exec",
    "claude-exec"
  ],
  "reps": 3,
  "stages": [
    "stage1",
    "stage2"
  ],
  "order": {
    "seed": 42,
    "interleave": true
  },
  "budget": {
    "activeMinutes": 60,
    "turns": 10
  },
  "unit": {
    "image": "eval-env:pinned",
    "network": "eval-net",
    "user": "1000",
    "resources": {
      "cpus": "2",
      "memory": "4g"
    }
  },
  "judge": {
    "conditions": [
      "judge-claude"
    ],
    "samples": 2
  },
  "expectedNs": [
    "script",
    "llm-draft",
    "human-final"
  ],
  "retry": {
    "infrastructure": 1
  },
  "notes": "dataset 钉 {registry, set, commit}，commit 必填，contract 文件全在这个 commit 上读；conditions 与 judge.conditions 都写条件 id，sha 由部署条件库里的 conditions/<id>.lock.json 解析。retry 是 run 的默认值，run 调用选项可覆盖；exports 缺省即实验目录的 exports/。unit 在场即容器路径：每格一个单元，挂的是评测实例自己的该家作用域目录，不写进本文件。"
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

`script` is the one deterministic source of the three, and only probes write it. A probe is an executable suffixed `.mjs` or `.sh` living **under any `probes/` segment** (`probes/room-identity.mjs` counts, and so does a register-rehomed `checks/probes/x.sh`). There are two sources:

- **the item's own probes** — under that item's verify layer, judging that item alone;
- **the dataset's shared probes** — under the DATASET-level verify layer (`verify/helpers/probes/no-patch.sh` and its kind), **run once for every item**. A criterion that holds in every item and should be judged identically in each ("the harness source was not modified", "an ordinary session stays uncontaminated") deserves exactly one ruler; a copy per item lets strictness drift apart silently.

**The invocation** (the orchestrator runs each probe once the cell has finished its stages and entered `judged`):

```text
<probe> --cell <cell directory> --rubric <rubric path> --out <verdicts.json>
```

| Argument | Meaning |
|---|---|
| `--cell` | The player's cell working directory. The probe **reads** it — judging does not modify what is being judged |
| `--rubric` | Host-side copy of the item's grading-layer rubric. **Omitted entirely** when the item ships no rubric |
| `--out` | Where the probe writes its verdicts |

**The exit code is the contract, and it carries three states**:

| Exit code | State | How the orchestrator records it |
|---|---|---|
| `0` | **Judged** — including `pass: false`, because "did it hold?" and "could the probe tell?" are different questions | The verdicts go to the `script` ns; outcome `judged` |
| `3` | **Not applicable this round** — the probe is fine and the criterion is not false; the input it needs is simply not in place (stage three never ran, the harness worktree is not in the cell) | Outcome `probe-skipped` with the probe's first stderr line; **not counted a failure** |
| any other non-zero | **The probe failed**, and produces no verdict at all | Outcome `probe-failed`, with the reason in the orchestrator ns |

The third state is not optional: without it, a run that executed only stages one and two collects several bogus "probe failed" records per cell, and the noise buries the real failures. **`3` rather than `2`** — `2` is the getopt-conventional "usage error" code, which is exactly what a probe returns when its arguments are wrong; reading it as "cannot judge" would swallow every mis-invocation. Exiting `0` without leaving a readable `--out` is a **probe failure**: it claimed a judgement and then produced nothing checkable.

**The output** is an **array** of §6.5 `dataseek.verdict/1` documents (a lone object is accepted as a one-element array). A proportionally scored criterion carries `ratio: {passed, total}` and **never encodes the proportion in an `evidence` prefix** (§6.5). The orchestrator checks the two numeric facts about `ratio` **where the artifact is produced**, and a failure counts as off-contract output (the same bucket as a schema failure, with the reason in the orchestrator ns):

- `passed` and `total` are integers, `total > 0`, and `0 <= passed <= total`;
- `pass === (passed === total)` — `pass` is always "the criterion FULLY holds", which for a proportional criterion means numerator equals denominator. When the two contradict each other there is no way to tell which is the typo.

The report side (§6.5) still degrades gracefully for data already on disk: an out-of-bounds ratio is treated as absent and falls back to the boolean. Both are needed — the source check catches a mistake that can still be fixed, the report check absorbs one already written down.

**`task` and `by` are backfilled by the orchestrator, BEFORE validation.** Whatever the probe wrote is overwritten: those two are coordinates the orchestrator knows and the judging side only echoes, and getting them wrong would corrupt every join the report performs. **A probe may omit them entirely** — both are `required` under `additionalProperties: false`, so validating first would void an otherwise complete verdict for missing exactly the fields the orchestrator was about to supply; hence backfill first, validate second. A value that is present but disagrees loses, and the fact that it was overwritten is recorded in the orchestrator ns. What `by` holds: for an item probe, its display path in that item's verify layer (`probes/stage1-structure.mjs`); for a shared probe, `shared/` plus its display path in the dataset-level verify layer (`shared/helpers/probes/no-patch.sh`). `shared/` is a **namespace, not a directory** — it marks the verdict as coming from the dataset's ruler rather than this item's, and keeps the two `by` spaces from ever colliding.

**The execution environment**: the orchestrator materializes **both verify layers, whole**, into a host-side temporary directory, **in the dataset's own relative layout** — the dataset-level layer at `<tmp>/verify/…`, the item's at `<tmp>/items/<item id>/verify/…`. That the layout matches is the entire point: an item probe imports the dataset's shared library through **the same relative path that resolves in the repository** (`../../../../verify/helpers/lib/x.mjs`), so one ruler serves every item instead of a per-item copy drifting apart.

The cwd is always **the item's verify-layer root**, shared probes included — a shared probe is the same ruler applied once per item, and the checklist it reads beside it must be that item's. `.mjs` runs under node and `.sh` under `/bin/sh`, with a five-minute wall-clock cap each, and the whole directory is removed afterwards — the verify layer is the answer key and does not stay overnight. From I3 this step is executed inside the container by `lab.verify`; **the contract is unchanged**.

**Where it lands**: verdicts go to mission's `script` ns and to `attempt-N/archive/verdicts/script.json`. When neither layer ships a probe, nothing at all is written — no empty file, no empty annotation.

### 6.8 The judge contract — how `llm-draft` verdicts are produced

`llm-draft` is written by a **judge condition**. The judge is itself a `dataseek.condition/1` (§6.2), not a session with tools; the plan's `judge` block (§6.4) names it and says how many samples to take. Three methodological constraints are enforced by the orchestrator:

1. **The judge must not be a contestant.** The validator refuses an id that appears on both lists; before executing, the orchestrator compares `(harness.name, model.declared)` as well — two different ids naming the same subject is still a judge grading itself.
2. **De-fingerprint before judging.** In the judged material (`stage1.json` / `stage1.md` / `stage2.json` / `stage2.md`), harness names, CLI names and self-reported assistant names all become `<harness>`, and every model identifier the plan's conditions declare or the delegations read back becomes `<model>`. The replacement table and its counts go to the orchestrator ns; **the originals are never rewritten** — the judge always sees a copy.
3. **At least two samples.** Each judge condition runs `judge.samples` times independently (default 2), each a **fresh delegation** — a resumed judge would see its own previous answer and stop being an independent sample. The report turns these into an agreement rate and Cohen's κ.

**The judge prompt** is assembled by the orchestrator, never carried by the judge: the `kind: llm-draft` criteria of the item's grading-layer rubric (`objective` rows belong to the probes and `human` rows to the judge bench — neither is shown), plus the de-identified material, plus the output requirement. The rubric is selected as "the grading-layer display path whose file name is `rubric.yml` / `rubric.yaml`, shortest path wins", which covers both item layouts (the conventional `rubric.yml` and a register-rehomed `answers/rubric.yml`).

**The output** has the same shape as a probe's: the judge writes the §6.5 array into `verdicts.json` in its own cwd, and `task` and `by` (= the judge condition id) are backfilled by the orchestrator, **in §6.7's order: backfill first, validate second**. An unreadable answer is recorded in the orchestrator ns and **retried exactly once**; a second failure drops that sample honestly rather than inventing one.

**Where it lands**: one `llm-draft` annotation per sample, shaped `{sample, judgeCondition, judgeSha, promptSha, verdicts}` — provenance beside the verdicts, with the report unwrapping the envelope for `verdicts` — plus `attempt-N/archive/verdicts/llm-draft-<judge condition>-<sample>.json`. The judge's usage and duration go to the orchestrator ns under `kind: judge` and are **kept out of the contestants' efficiency table**. The judge material directory (prompt + de-identified material + the judge's answer) is retained after the run for review.

The grading and verify layers are read through the datasets service face with an **explicit single-layer scope** (`layers: ['grading']` / `['verify']`) and materialized into host-side judge and probe directories — **never into a player's cell**.
