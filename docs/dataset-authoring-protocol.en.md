# Dataset Authoring Protocol

**Version: v1-rev1** · [中文](dataset-authoring-protocol.md)

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
