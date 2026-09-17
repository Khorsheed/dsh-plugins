# dsh-datasets

English | [中文](README.md)

Generic versioned dataset storage over git repositories: layered items, commit-pinned reads straight from git objects, managed sparse-checkout worktree views for whole-layer consumption, and per-session bindings whose layer whitelist is enforced on every read path.

The plugin exists for the three things a file browser does not have: a **semantic contract** (descriptor shape validation, layer visibility classes, a declared item-metadata schema), **version pinning** (snapshots, git-object reads, commit-deduplicated managed worktrees), and **access governance** (a per-session binding whose layer whitelist is a mechanism, not a convention). It never interprets a dataset's semantics, and it never copies content out of the repository.

## The dataset repository layout

A dataset store is an ordinary git repository. The directory structure is the convention; layer names are arbitrary and declared by the descriptor. A layer directory may exist at **two levels** — dataset-level layers hold content shared across items, item-level layers hold per-item content:

```
<repo>/
  datasets/<dataset-id>/
    dataset.json           # id, name, layers manifest (visibility classes), item metadata schema
    <layer>/...            # dataset-level layer (a top-level directory named by the layers manifest)
    <any other files>      # descriptor passthrough — carried, unread, unreachable by the read paths
    items/<item-id>/
      item.json            # item metadata (fields constrained by the declared schema)
      <layer>/...          # item-level layers
```

Version = git commit. The plugin validates the **shape** of `dataset.json` only: `id`, optional `name`, an optional `canary` string, a non-empty `layers` manifest where each entry declares `name` and may declare `modelFacing: false` (default true), and an optional `itemMetaSchema` object. Everything else passes through verbatim.

The two-level rule is purely name-based: a top-level directory whose name is declared in the `layers` manifest IS a dataset-level layer; every other top-level file or directory is descriptor passthrough and stays outside `list`/`show`/`read`/`worktree_path` exactly as before. `items` is the reserved item container and may not name a layer. All mechanisms apply at both levels uniformly: the session binding's layer whitelist (filtered listings, rejected reads, sparse-checkout patterns covering `datasets/<id>/<layer>/` and `datasets/<id>/items/*/<layer>/` alike) and the `modelFacing` visibility class (the declaration is per layer NAME, so it covers both levels by construction). In evaluation-suite layouts this is where cross-item shared content with visibility requirements goes: `suites/<suite>/verify/helpers/` as a dataset-level layer (mounted only at judging time), and grading rubrics move from loose top-level directories into a declared dataset-level layer so the whitelist actually governs them.

`modelFacing: false` is a data declaration with exactly one meaning: exporting that layer off the machine must pass a human confirmation gate (the gate belongs to the exporter, not this plugin). It is independent of the session binding's layer whitelist — the whitelist governs what the session's agent can see; the export gate governs what may leave the machine.

A descriptor may also carry an optional `register` array (the authoring protocol's §2): explicitly mapping free-form files inside an item's directory onto item/layer roles — `register: [{item, layer, files}]`, where files are item-relative paths or single-level globs (`*` never crosses `/`). Registered files re-home into their declared layer in list/show and the tree (physical location decouples from role), and worktree sparse patterns cover them; path escapes, `**`, layout-form conflicts, and dangling exact paths all fail loud. The full convention lives in `docs/dataset-authoring-protocol.md` at the repository root.

`modelFacing` defaults to `true` when a layer omits the key. Because descriptor files get copied as templates, shape validation also **warns** (never blocks): in a mixed-sensitivity dataset — one that has any explicit `modelFacing: false` layer — every layer that left the key undeclared produces one warning (`MODELFACING_UNDECLARED`, per layer). Datasets with no hidden layer, and datasets where every layer is explicit in either direction, stay silent. The warnings ride the dataset summary: the CLI prints them to stderr on `list`/`show`/`describe`, the slash command appends them to its output, and the web tab shows them as a quiet line under the dataset row.

**The canary (leak forensics)**: a descriptor may declare a `canary` — one globally unique string, recommended shape `dsh-canary:<dataset-id>:<uuid>`. Once declared, `validate` checks that every text file of a visible layer (`modelFacing: true`; both levels, and a register-mapped file counts under its role layer) contains it verbatim, reporting each file that does not as `CANARY_MISSING`. Text is decided by an extension whitelist (`.md` / `.txt` / `.yml` / `.yaml` / `.json` and extensionless files); everything else is skipped, as are sensitive layers and item.json. The point is to search model output for that string later: finding it proves this dataset entered training data, at nearly zero cost. The plugin only checks — it never generates or injects a canary; the author mints it and embeds it. A dataset that declares no `canary` is not checked at all.

**Judgeability (can this item be judged at all — known before anything runs)**: when an item's grading layer carries a rubric (a display path in that layer whose filename is `rubric.yml` / `rubric.yaml`, shortest path first — covering both the convention form `rubric.yml` and the register-re-homed `answers/rubric.yml`), `validate` checks whether that rubric can actually be judged. A rubric with axes but no leaves passes every shape check there was, and then all three judgement sources (probes, the LLM judge, the human bench) read LEAVES and none of them can write a single verdict: every cell records judge-skipped, its verdicts stay empty, and it never clears the archive gate — a fact the repository alone already knows, which a run should not have to discover one cell at a time. The layer names `grading` / `verify` come from the judging convention of the authoring protocol §6.7/§6.8 (the orchestrator mounts exactly those two). An item whose grading layer holds no rubric is not checked at all, so a dataset outside that convention reports byte-identically to before.

### `validate` rule table

| Level | Code | Fires when |
|---|---|---|
| error | `SHAPE_INVALID` etc. | A descriptor / item.json / register shape error. Fails loud per dataset; the other datasets still validate |
| error | `RUBRIC_UNREADABLE` | The rubric is not a readable YAML document, or cannot be read at that commit |
| error | `RUBRIC_NO_ITEMS` | The rubric declares no leaf criteria (`items` missing or empty). Axes alone cannot be judged — every judgement source reads leaves |
| error | `RUBRIC_FIELD_MISSING` | A leaf is missing `id` / `axis` / `weight` / `kind` / `criterion` / `evidence` (`weight` a number, the rest non-empty strings). One error per leaf, naming every field it lacks |
| error | `RUBRIC_KIND_INVALID` | A leaf's `kind` is not `objective` / `llm-draft` / `human` — a fourth value routes to no judgement source |
| error | `RUBRIC_POLARITY` | A leaf's `negative: true` and its `weight` sign disagree, in either direction. Polarity is stated once: a negative leaf carries a negative weight, and a verdict source never re-reads the sign |
| warn | `MODELFACING_UNDECLARED` | A layer of a mixed-sensitivity dataset left `modelFacing` undeclared, per layer |
| warn | `FIELD_NAME_SENSITIVE` | An item.json key carries a note / hint / answer / rubric / grading root |
| warn | `UNREGISTERED_FILES` | A file covered by no layer directory and no register entry — it sits in the passthrough zone, visible to every bound session |
| warn | `CANARY_MISSING` | In a dataset declaring a `canary`, a text file of a visible layer does not carry it verbatim |
| warn | `OBJECTIVE_NO_PROBE` | The item has `kind: objective` leaves but its verify layer carries no executable probe (a `.mjs` / `.sh` under a `probes/` segment). A probe is the only writer of an objective verdict, so without one those leaves are judged by nobody |
| warn | `RUBRIC_REF_DANGLING` | `rubric.md` refers to a leaf id `rubric.yml` does not declare. The id shape is matched loosely and false positives (a table label that looks like an id) are deliberately tolerated, which is why this only warns — a stale reference is not one of them |

A `kind: llm-draft` leaf counts as having a source the moment it exists: the judge comes from the plan, which the dataset side cannot see. `kind: human` is not checked — the bench is a person. Whether a plan supplies a judge at all, and whether its `expectedNs` matches the item's sources, belongs to `dsh-eval validate`; this plugin's check stops at the dataset. When the rubric has no leaves or cannot be read, the last two warnings are skipped: every reference would then be trivially dangling, and the noise would bury the one error that matters.

Content enters a dataset as plain files in the repository, committed through the normal git flow, or drafted by an agent via `datasets_put_item` into the working tree and committed by a human after review. There is no import verb and no copy-out materialization: single files are read from git objects, whole layers are consumed through managed worktrees.

## Install and load

This package is a dsh plugin with the single identity **`@khorsheed/dsh-datasets`**, developed in the `dsh-plugins` monorepo (`packages/datasets`) and published to npm from there:

```sh
npm install @deepseek-ai/dsh                            # the host (dsh web / dsh CLI)
dsh plugin --profile web add @khorsheed/dsh-datasets    # this plugin
```

The package declares `dsh.bundle`, so the add reconciles its `cordis.patch.yml` row (a bare `datasets` mount) into the profile's bundles layer — no hand-edited cordis.yml. A composition may mount the `datasets` row id only once; `dsh --profile web --dump-config | grep datasets` printing nothing means the add is safe.

Config (all optional): `repo` (default dataset repository when a call has no explicit `repo` and the session has no binding; default none) and `worktreeRoot` (managed worktree root override; default `$DSH_HOME/state/datasets/worktrees`, else `<cwd>/.dsh-datasets/worktrees`). `tools` is no longer a key on this row: the model-tool grouping moved to the companion row `@khorsheed/dsh-datasets-tool`, see [Model tools](#model-tools).

The plugin provides the `ctx.datasets` service for other plugins to consume optionally, provides the `/datasets` slash command, mounts the `datasetsRemote` Typert Remote service (the web session tab's data face), and (when the composition mounts `@khorsheed/dsh-datasets/invariant`) checks the managed worktree root's structural integrity at load. The `datasets_*` model tools and the `datasets:tools` prompt section belong to the companion row `@khorsheed/dsh-datasets-tool`, granted per session by an agent preset — see [Model tools](#model-tools).

## The session binding

Each session may bind its own dataset repository, stored as a plugin-owned durable state file — one JSON record per session under the plugin state root (`$DSH_HOME/state/datasets/bindings/`, else `<cwd>/.dsh-datasets/bindings/`):

```ts
{ repoPath: string, datasets?: string[], layers?: string[] }
```

`datasets` restricts which dataset ids are visible; `layers` is the layer whitelist. An absent `datasets` means "every dataset"; an absent **`layers` does NOT mean "every layer"** — it means that dataset's `modelFacing: true` layers (next paragraph). The whitelist is enforced on **every** tool read path — `list`/`show` filter to it, `read` rejects outside it, and `worktree_path` intersects with it (an empty intersection is an error; the sparse-checkout physically omits disallowed layer directories).

**Safe by default, and what the boundary is about**: a binding with no explicit `layers` gives the agent that dataset's `modelFacing: true` layers and nothing else — a sensitive layer reaches an agent only when somebody lists it. Since I5 · T58 that floor is **unconditional**: the old "a dataset that declares nothing sensitive is not filtered at all" branch is gone, because it made "no whitelist" mean two different things depending on a descriptor the binder never reads, and the unfiltered branch also admitted item-level directories no `register` entry claims — precisely the ones nobody has declared a sensitivity for. The write path (`put_item`) and the worktree default follow the same floor. What the whitelist constrains is the two real boundaries, **agent tools and worktree materialization**; the web tab's and the CLI's read verbs are the human's view (operator scope) and are bound by neither the whitelist nor the floor — sensitive layers stay visible to a person with a `· sensitive` marker, and the tree carries a separate "passthrough" group making the unprotected content conspicuous.

**Why not a session event**: the binding was a log-only `datasets/binding` session event in the first cut, but the harness's persistence read path refuses to rebuild a session whose log contains an event type outside its generated known-types set unless the envelope carries `ignorable: true` — a downstream plugin's event types are outside that set by construction (the registration surface is deferred upstream), and `Session.append()` offers no way to set the marker. Any custom-typed event this plugin appended made the session unresumable, so the binding moved to the plugin's own store (read per call, so a CLI write to a live session's binding is race-free). The trade: a forked session starts unbound, and deleting a session leaves an orphan record behind.

Binding **writes** are human operations: `/datasets bind` in a live session, the web tab's binding bar, or `dsh-datasets bind` from a script. Agent tools only resolve the binding — which datasets an agent may use is decided by the human.

**The `repo` argument only restates the binding** (I5 · T58): on the model-tool face `repo` may only restate this session's binding (or, with no binding, the repository the plugin was configured with) — a path that is not that one is refused with both named, and in a session with neither a binding nor a configured default every `repo` is refused with "ask the person to `/datasets bind`". The comparison is on normalized paths (`~` expanded, realpath resolved, trailing separator dropped), so a binding recorded one way and an argument typed another are still one repository. The human faces are unchanged: the CLI's `--repo`, `/datasets` and the tab all still name one.

The narrowing came from a real incident: told plainly by the tools that a person had to bind one, an agent in an unbound session did not stop — it searched the disk with glob, found a checkout several agents share, and wrote three files onto somebody else's branch, editing the evaluation plan that was executing at the time. "Findable" is not "mine to use".

The whitelist is a session-level constraint, not a security boundary: a same-machine human can rebind, and an agent with shell access can read the original repository. It prevents accidental fetches and workflow cross-contamination, not malice.

## Model tools

**This package registers no model tool any more (BREAKING)**: the eight tools below and the `datasets:tools` prompt section belong to the companion row `@khorsheed/dsh-datasets-tool`, granted per session by an agent preset. Migration is two lines: install the companion as a dependency and add `- id: datasets-tool` / `  name: '@khorsheed/dsh-datasets-tool'` to the target preset's `agent.cordis.yml` (that row may carry `config: { tools: authoring }`). The inventory, groups, and behavior prose below describe the **companion's** tool face from here on; the service, CLI, `/datasets`, and the session tab still belong to this package.

| Tool | Writes? | Purpose |
|---|---|---|
| `datasets_list` | | List datasets in scope, or one dataset's items with metadata |
| `datasets_show` | | Dataset/item detail: summary, descriptor passthrough, layer-file listing |
| `datasets_describe` | | The raw `dataset.json` descriptor, verbatim |
| `datasets_read` | | One file of one item layer, from the git object at the pinned commit — no copy |
| `datasets_snapshot` | | Pin `{repoPath, commit, datasetId}` for stable reads while the repo evolves |
| `datasets_worktree_path` | creates a managed worktree | Whole-layer read-only view path (sparse-checkout-limited, deduplicated) |
| `datasets_put_item` | writes the working tree | Create/update an item's metadata and layer files; `git commit` stays with the human |
| `datasets_validate` | | Authoring hygiene + judgeability: shape errors and unjudgeable rubrics fail loud; six warning kinds (undeclared modelFacing in a mixed dataset / sensitive-looking item.json field names / files falling into the passthrough zone / a declared canary missing from a visible-layer text file / objective leaves with no probe source / a dangling rubric.md reference), never blocking. Rule by rule in the [rule table](#validate-rule-table) above |

**Tool groups**: the `tools` config decides which group is registered — a preset cannot deselect a tool the profile already registered, so registration is the only place that can decide. The four tiers are one containment chain: `read` = the six read verbs (list / show / describe / read / snapshot / validate); `authoring` = read plus `put_item` (drafting into the working tree; committing stays the human's); `all` (the default) = authoring plus `worktree_path` (whole-layer materialization, which writes a managed worktree); `none` = no model tool at all. The prompt section describes only the tools actually registered, and contributes nothing under `none`. The service, the CLI, `/datasets` and the session tab are the human's faces — no tier touches them. **An eval domain wants `authoring`**: a planning agent reads and authors items, but whole-layer materialization is the orchestrator's action, not a step the agent should be able to start.

`worktree_path` returns an ordinary directory under the managed root, keyed by (repo, commit, sorted layers) and shared machine-wide per key: `git worktree add --detach <commit>` + sparse-checkout limited to the layer directories + `git worktree lock`. Consumers mount it read-only or read it directly, and never modify or delete it — it is a cross-consumer cache. Same-key concurrent creators serialize on a lock directory under the managed root; the second one reuses the finished worktree. Cleanup is the CLI's `worktree prune`.

## CLI

The `dsh-datasets` bin mirrors the tools' read verbs (same semantics, same parameters) and adds the maintenance verbs. Repository resolution: `--repo`, else `$DSH_DATASETS_REPO`. Exit codes: 0 ok, 1 operational failure, 2 usage error. Reached through a symlink — a `PATH` entry, pnpm's `.bin/<name>` — the bin behaves exactly as `node lib/cli.js` does: the entry guard resolves `argv[1]` to its real path before comparing, so a symlinked path can never make it exit 0 doing nothing.

```sh
dsh-datasets list [--repo R] [--dataset D] [--commit C]
dsh-datasets show --dataset D [--item I]
dsh-datasets describe --dataset D
dsh-datasets read --dataset D --item I --layer L --path P [--commit C]
dsh-datasets snapshot --dataset D
dsh-datasets validate [--repo R] [--dataset D] [--commit C]
dsh-datasets worktree path --dataset D [--layers a,b] [--worktree-root DIR]
dsh-datasets worktree prune --repo R [--worktree-root DIR]
dsh-datasets bind --session ID --repo R [--datasets a,b] [--layers x,y] [--state-root DIR]
dsh-datasets unbind --session ID [--state-root DIR]
dsh-datasets binding --session ID [--state-root DIR]
```

`bind`/`unbind` write the plugin-owned binding store (`--state-root` defaults to `$DSH_HOME/state/datasets`; bindings live under its `bindings/` subdirectory). The store is read per call, so binding a session a running instance has open is race-free — the next tool call in that session sees the new binding.

## Slash commands

```
/datasets list [dataset]
/datasets show <dataset> [item]
/datasets bind <repoPath> [--datasets a,b] [--layers x,y]
/datasets unbind
```

`bind` **with no `--layers` binds the model-facing layers only**, and the receipt says so; opening more (sensitive layers included) takes an explicit `--layers a,b`, which the receipt then names. The receipt used to read "(all layers)" — a sentence that said the opposite of the truth, so a person reading it believed the reference answers and the grading rubric were already open to the planning agent (I5 · T39 · G3). `dsh-datasets bind` prints the same receipt.

The command declares its free-form input (`input.hint`). That is not decoration: without it a capable composer has no reason to believe `/datasets` takes arguments — picking the command from the completion strip submits a bare invocation and leaves the `bind <path>` the human typed in the MESSAGE body, so the command answers with its usage line (found during T36's live pass).

## The binding chip on the composer (I5 · T58)

The browser half puts a read-only chip on the composer tool row (`conversation.input.left`): **Datasets · <repository name> · model-facing layers**, or a dashed "Datasets · not bound" when there is none, with the full path and the rebinding command in its title.

It exists because `/datasets bind` had **nowhere to print its receipt**. The binding lands on disk and the 题集 tab reads it correctly, but the tab strip waits for the session to have content and binding is the first thing done in a session that has none — so the one command whose whole output is "it worked" answered into a part of the screen that was not there yet (walkthrough gap G2). The composer tool row is there from the first frame.

The chip is **read-only**: binding is a human act with two doors already (the slash command and the tab), and a third one wedged into the composer would be a third place for the same decision to be made. It rides the same self-hide criterion as the tab (does this session's preset composition name the `@khorsheed/dsh-datasets-tool` row), so the two can never disagree about whether this is a datasets session. It refreshes by subscribing to its own session's snapshot, throttled: a slash command moves the session when it starts and again when it settles — exactly when the receipt has to appear — and the throttle keeps a streaming turn from becoming a poll.

## The 题集 tab (web)

<!-- screenshot placeholder: docs/screenshots/…-datasets-tab.png (pending) -->

On web profiles the plugin contributes a **`datasets` tab** to the conversation's view ring (labelled 题集 / Datasets, beside chat and trajectory). Two pages in one shell, shaped by the [web-eval UI spec](../../profiles/web-eval/docs/ui-spec.md) §三 §四.

**The slot vocabulary.** Files are labelled by **who sees them**, not by layer name — a layer name is one dataset's authoring convention, and the person reading this tab is judging visibility. Every file falls in exactly one **role**, computed from `dataset.json`'s `layers` + `register` (a mechanical fact): the player sees it (a `modelFacing` layer), the judge only (`grading`), the probes only (`verify`), withheld from the player (any other sensitive layer), readable by everyone (the passthrough zone). On top of the role sits a **slot** display name — task statement / acceptance standards / reference answer / grading rubric / check scripts / other files — derived by a basename heuristic: anything under an `oracle/` segment is the reference answer, `task.md` and anything under `prompts/` is the task statement, `rubric*` and `standards-notes*` are the rubric, `standards*` are the acceptance standards, anything under `checks/` or `probes/` is a check script, and whatever matches nothing falls back to its role (the verify layer's default is check scripts, the grading layer's is the rubric). The protocol's two layouts therefore give the same answer: the register form's `answers/rubric.yml` and the convention form's `rubric.yml` are both "grading rubric · the judge only". The heuristic and the role computation live in one place, `src/slots.ts`, shared by the host and the browser — the protocol has no slot field, and forking the descriptor format for a display name is not worth it; per-dataset slot names are deferred.

**The list page**: one row per dataset — id and display name, the snapshot (repository @ commit), the item count, the slot ← layer mapping, whether a canary is declared (presence only, never the string itself), the `validate` outcome, and which experiments used it. The gestures are **New dataset** (writes the `dataset.json` skeleton, `visible/prompts/`, `schemas/`, `items/`) and **Import a dataset** (binding a repository already laid out by the protocol). The whole page is one RPC (`overview`): the projection is computed host-side and shipped as a value. The "used by" column comes from the eval plugin's Remote, and **an instance without eval does not render the column at all** — a column of em dashes would promise a feature that is not installed.

**The detail page** (dataset › item): a file tree on the left where every leaf carries its slot and who sees it (three colours: visible to the player / withheld / unprotected), with a slot filter above it; four blocks on the right — **What the player will see** (this item's model-facing files plus the dataset-level task prompts, listed with byte counts, the dataset-level ones marked as such; an answer key that drifted into a visible layer shows up in THIS table first, which is what it is for), **Judgeability** (how many rubric leaves, how many per kind, how many probes, how many dataset-level probes, how many stage schemas), **Answer record** (this item's cells across every experiment; the whole area hides when eval is absent), and the selected file's preview. The preview is delegated to the official reader primitives — markdown through the official `MarkdownText` pipeline (the same renderer the chat uses), JSON through the official `JsonTree`, everything else through `CodeBlock`; there is no self-rolled renderer in this package. The gestures are **Item skeleton**, **Import an item** and **Validate**.

**Every write lands in the working tree only, and the commit stays the human's** (this plugin never commits). An item skeleton is homed by **this dataset's own shape**: when the descriptor's `register` already speaks for the item, the files land at the registered paths (`task.md` / `answers/rubric.yml` / `checks/probes/…`); when it does not, the convention layout applies (`<layer>/rubric.yml`). Existing files are never overwritten. The placeholder `rubric.yml` is deliberately leafless (`items: []`) — `validate` therefore reports `RUBRIC_NO_ITEMS` pointing at that file, which is the intended next step rather than a defect. Importing an item is a **verbatim copy** of an existing item directory, re-homing nothing: the dataset's own `layers` and `register` decide what each file becomes, and whatever lands outside every layer is reported honestly by `validate`. All three write gestures require the operator view (the tab's buttons); an agent's drafting path stays `datasets_put_item`, inside the session binding.

The tab's data face is a Typert Remote service (`datasetsRemote`, wire namespace `datasets`) over the same service core as the tools: `binding` / `bind` / `unbind` / `previewRepo` / `list` / `show` / `read` / `readPassthrough` / `overview` / `itemBrief` / `validate` / `scaffoldDataset` / `scaffoldItem` / `importItem`. The read methods are the operator view — the binding supplies the repository path only; the whitelist and the modelFacing floor constrain the agent boundary (tools + worktree), never a human reading their own repository, so sensitive layers stay readable with a `· sensitive` marker while the genuinely unprotected passthrough zone and `item.json` are marked conspicuously. The one exception is the two judging reads behind `itemBrief`: they name their **one layer explicitly** (`layers: ['grading']` / `['verify']`) instead of taking the operator bypass — the page needs the answer key's shape (how many leaves, of which kind), and its bytes never go on the wire. The browser half mounts the namespace through the official `ctx.remote.$mount` channel; eval's namespace is probed with `ctx.get` on **every call** rather than once at mount — the two plugins `$mount` independently and neither may assume it loaded second.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.2-rc.1`): ✅ — every capability works; the contract surface (`ctx.tools`, `ctx.commands`, log-only session events, the Typert Remote channel, `conversation.view`) is stable on this line. minHost moves up to 0.1.2-rc.1 — older hosts stay on the previous release line.
- source line (deepseek-harness master): ✅ (verifiedHost: 0.1.2-rc.1).
- The canary check and the judgeability check are both internal (they only read git objects) — no new host capability, identical on both lines; the `tools` grouping moved with the model-tool face to the companion row `@khorsheed/dsh-datasets-tool` (`read` / `authoring` / `all` / `none`), and this row no longer has that config key.
- ⚠️ degraded (both lines): slash commands need an interactive UI adapter (web/TUI profile); on headless profiles `/datasets` is unavailable while the CLI stays fully functional (the model tools come from the companion row). The 题集 tab self-hides: it registers only when the current session's preset composition names the `@khorsheed/dsh-datasets-tool` row, read from the official `pluginInventory` Remote, and every unreadable path fails OPEN (stays visible). Release order matters: a pack that names a companion row needs the companion published / installed first — a row that fails to resolve reports the preset composition `broken` while the instance boots unaffected. The session tab is a web surface — TUI has no tab mechanism; headless profiles serve the Remote data face without a browser consumer.

This section mirrors the `dsh.compat` field in package.json; the two move together.

## Known Limitations and Deferred Work

- **Descriptors are JSON, not YAML** — the layout convention calls them `dataset.yml`/`item.yml`; v1 reads `dataset.json`/`item.json`. The judgeability check has to read rubrics (YAML on the suite side, a shape this package does not get to choose), so `js-yaml` has been on the dependency chain since; descriptors staying JSON is now a shape decision rather than "no parser available". Accepting both is one deliberate change away, unmade because nobody has asked.
- **Item metadata is not validated against `itemMetaSchema`** — the schema is declared, shape-checked as an object, and passed through; full JSON-Schema validation of item metadata needs a validator dependency this package does not take.
- **The session tab's preview reads whole files over RPC** — `read` serves full file content with no byte cap (the same semantics as the tool); very large layer files are better consumed through `worktree_path`.
- **A forked session starts unbound** — the binding is filed under the session id in the plugin-owned store and does not follow a fork; deleting a session leaves its binding record behind (harmless, one small JSON file).
- **The canary and judgeability checks read file content, one file at a time** — `validate` runs one `git show` per visible-layer text file (the canary), plus one or two more per item carrying a rubric (the rubric and its `rubric.md`); these are the only two content-reading checks in the plugin, which is why both run on `validate` only and the `list`/`show` summary warnings stay shape-level.
- **The judgeability check hardcodes the layer names `grading` / `verify`** — the judging convention (authoring protocol §6.7/§6.8) is written in those two names, and the orchestrator mounts exactly them. Layer names are otherwise free in this plugin, so a suite that files its rubric under a different layer name is not checked (and not falsely reported either). Making the names descriptor-declarable is a protocol change, not one this package settles alone.
- **A file written into the working tree is invisible until it is committed** — the tree, `list`/`show`/`validate` all read git objects at HEAD, while `put_item` and the tab's three write gestures only write the working tree. A freshly written skeleton is not in the tree and `validate` does not report it yet; both happen once you commit, and the tab says so on every write form and every write result. Making the read paths also see the working tree would make "snapshot" meaningless (a run pins a commit), so this is a choice rather than an oversight.
- **A worktree a consumer dirtied is rebuilt by `worktree prune`** — the read-only contract is enforced by the consumer's mount (`:ro`), not by the plugin.
- **`worktree prune` needs `--repo`** — the registry is `git worktree list`, which is per-repository; orphaned roots of deleted repositories are removed by hand.
