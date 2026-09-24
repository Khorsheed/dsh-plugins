# dsh-datasets

English | [中文](README.md)

Generic versioned dataset storage over git repositories: layered items, commit-pinned reads straight from git objects, read-only materialized views for whole-layer consumption (`git archive`, content-addressed), and a deployment-level dataset registry — an agent reaches data only through a registered `<id>/<set>` reference, and the layer whitelist is enforced on every read path.

The plugin exists for the three things a file browser does not have: a **semantic contract** (descriptor shape validation, layer visibility classes, a declared item-metadata schema), **version pinning** (snapshots, git-object reads, commit-addressed read-only materializations), and **access governance** (a human-written registry whose layer whitelist is a mechanism, not a convention). It never interprets a dataset's semantics, and it never copies content out of the repository.

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

The two-level rule is purely name-based: a top-level directory whose name is declared in the `layers` manifest IS a dataset-level layer; every other top-level file or directory is descriptor passthrough and stays outside `list`/`show`/`read`/`worktree_path` exactly as before. `items` is the reserved item container and may not name a layer. All mechanisms apply at both levels uniformly: the registry's layer whitelist (filtered listings, rejected reads, materialization archive paths covering `datasets/<id>/<layer>/` and `datasets/<id>/items/*/<layer>/` alike) and the `modelFacing` visibility class (the declaration is per layer NAME, so it covers both levels by construction). In evaluation-suite layouts this is where cross-item shared content with visibility requirements goes: `suites/<suite>/verify/helpers/` as a dataset-level layer (mounted only at judging time), and grading rubrics move from loose top-level directories into a declared dataset-level layer so the whitelist actually governs them.

`modelFacing: false` is a data declaration with exactly one meaning: exporting that layer off the machine must pass a human confirmation gate (the gate belongs to the exporter, not this plugin). It is independent of the registry's layer whitelist — the whitelist governs what an agent can see; the export gate governs what may leave the machine.

A descriptor may also carry an optional `register` array (the authoring protocol's §2): explicitly mapping free-form files inside an item's directory onto item/layer roles — `register: [{item, layer, files}]`, where files are item-relative paths or single-level globs (`*` never crosses `/`). Registered files re-home into their declared layer in list/show and the tree (physical location decouples from role), and materialization archive paths cover them; path escapes, `**`, layout-form conflicts, and dangling exact paths all fail loud. The full convention lives in `docs/dataset-authoring-protocol.md` at the repository root.

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
| warn | `UNREGISTERED_FILES` | A file covered by no layer directory and no register entry — it sits in the passthrough zone, visible to every agent |
| warn | `CANARY_MISSING` | In a dataset declaring a `canary`, a text file of a visible layer does not carry it verbatim |
| warn | `OBJECTIVE_NO_PROBE` | The item has `kind: objective` leaves but its verify layer carries no executable probe (a `.mjs` / `.sh` under a `probes/` segment). A probe is the only writer of an objective verdict, so without one those leaves are judged by nobody |
| warn | `RUBRIC_REF_DANGLING` | `rubric.md` refers to a leaf id `rubric.yml` does not declare. The id shape is matched loosely and false positives (a table label that looks like an id) are deliberately tolerated, which is why this only warns — a stale reference is not one of them |

A `kind: llm-draft` leaf counts as having a source the moment it exists: the judge comes from the plan, which the dataset side cannot see. `kind: human` is not checked — the bench is a person. Whether a plan supplies a judge at all, and whether its `expectedNs` matches the item's sources, belongs to `dsh-eval validate`; this plugin's check stops at the dataset. When the rubric has no leaves or cannot be read, the last two warnings are skipped: every reference would then be trivially dangling, and the noise would bury the one error that matters.

Content enters a dataset as plain files in the repository, committed through the normal git flow, or drafted by an agent via `datasets_put_item` into the working tree and committed by a human after review. There is no import verb: single files are read from git objects, whole layers are consumed through read-only materialized directories.

## Install and load

This package is a dsh plugin with the single identity **`@khorsheed/dsh-datasets`**, developed in the `dsh-plugins` monorepo (`packages/datasets`) and published to npm from there:

```sh
npm install @deepseek-ai/dsh                            # the host (dsh web / dsh CLI)
dsh plugin --profile web add @khorsheed/dsh-datasets    # this plugin
```

The package declares `dsh.bundle`, so the add reconciles its `cordis.patch.yml` row (a bare `datasets` mount) into the profile's bundles layer — no hand-edited cordis.yml. A composition may mount the `datasets` row id only once; `dsh --profile web --dump-config | grep datasets` printing nothing means the add is safe.

Config (optional): `materializedRoot` (materialization root override; default `$DSH_HOME/state/datasets/materialized`, else `<cwd>/.dsh-datasets/materialized`). The registry file is fixed under the state root: `$DSH_HOME/state/datasets/registry.json`. `tools` is no longer a key on this row: the model-tool grouping moved to the companion row `@khorsheed/dsh-datasets-tool`, see [Model tools](#model-tools).

The plugin provides the `ctx.datasets` service for other plugins to consume optionally, mounts the `datasetsRemote` Typert Remote service (the web session tab's data face), and (when the composition mounts `@khorsheed/dsh-datasets/invariant`) checks the materialization root's structural integrity at load. Since the preset-visibility rollout (A3) the `/datasets` slash command's REGISTRATION belongs to the companion row — it lands in the preset's scope layer, so only granted sessions see it; the handler and definition stay in this package, registered by the companion through `registerDatasetsSlash`. The `datasets_*` model tools and the `datasets:tools` prompt section belong to the companion row `@khorsheed/dsh-datasets-tool`, granted per session by an agent preset — see [Model tools](#model-tools).

## The dataset registry (T73)

A dataset repository is **registered once per deployment**, no longer bound per session. The registry is one JSON file under the state root (`$DSH_HOME/state/datasets/registry.json`), one record per repository:

```ts
{ id, commonDir, trackedRef, registeredAt, registeredCommit, sets: { <set>: { layers } }, authoringCheckout }
```

- **Identity is the realpath of the git common dir**: a repository's main checkout, its `.git`, and any of its linked worktrees are one registration, and registering it twice is refused (`ALREADY_REGISTERED`). `id` is the `<id>` of an agent's reference, unique across the file.
- **«Latest» = `git rev-parse <trackedRef>`, never HEAD.** A shared checkout's HEAD belongs to whoever is working in it; a registration tracks a branch, and as the branch moves, «latest» moves with it, no re-registration needed. A missing branch is refused (`REF_NOT_FOUND`); the registration stays on the list with the sentence. `registeredCommit` is audit only and never resolves anything.
- **Visible layers are per set**: a set named in `sets` gives the agent the layers written there; a set left out (including one added to the branch after registration) gets the `modelFacing: true` floor, computed at read time. Naming a layer the set does not declare is refused (`LAYER_UNDECLARED`).
- **`authoringCheckout`** is the only working tree `datasets_put_item` writes; with none, writing is refused (`NO_AUTHORING_CHECKOUT`). Reads always come from the tracked branch's git objects, writes always go into this checkout — committing and merging stay the human's.

**Registering is a human act**: the 题集 tab's Register repository form (a path input + the native chooser + a live preview; one row of layer chips per set, model-facing only by default; a tracked-branch dropdown, `main` by default), or the CLI's `dsh-datasets register` / `update` / `unregister`. No agent tool writes the registry.

**Agents speak references only**: a model tool's `dataset` argument accepts `<id>/<set>` and nothing else; when unsure, call `datasets_list` first. Each of the three ways to get it wrong answers with a sentence the agent can act on:

| Passed | Answer |
|---|---|
| a path | paths are not accepted; when that path is registered, the refusal names the `<id>/<set>` to pass (`PATH_NOT_REF`) |
| a name matching no single set | lists the candidates and says to use `ask_user_question` to let the person choose (`AMBIGUOUS_DATASET`) |
| an unregistered repository or name | "is not registered in this deployment": ask the person to register it on the Datasets tab, **do not read that directory yourself** (`NOT_REGISTERED`) |

The third comes from a real incident: an agent in a session with no data was told truthfully to "have the human bind one", and instead of stopping it globbed the disk, found a checkout several agents share, and wrote three files on someone else's branch. The registry separates «can be found» from «may be used»: present on disk is not registered in this deployment.

**Safe by default, and what the boundary is about**: the layer whitelist constrains the two real boundaries — **agent tools and materialized views**; the web tab's and the CLI's read verbs are the human's view (operator scope), outside the whitelist and the floor — sensitive layers show to the human with a `· sensitive` marker, and the tree lists the unprotected passthrough content in a conspicuous group of its own. The whitelist is not a security boundary: a person on the machine can edit the registry, and an agent with a shell can read the original repository. It prevents accidental access and process bleed, not malice.

### Legacy session bindings

Before T73 each session bound one repository (`$DSH_HOME/state/datasets/bindings/<session>.json`). From T73's second step that path is **fully retired**: no code reads a binding any more (eval's experiments now pin their own `{registry id, set, commit}`), and the `repo` fallback config, the CLI's `binding` / `unbind`, and `/datasets unbind` are deleted. Every door that wrote a binding (`/datasets bind`, the CLI's `bind`, the tab's binding bar, the composer's binding chip) was retired earlier; `/datasets bind` answers with directions to register. The only thing that still touches these files is the one-click migration below, and it only reads them. Binding files are **never deleted automatically**: once the migration looks right, remove the `$DSH_HOME/state/datasets/bindings/` directory by hand.

Migrating from bindings is one click: the tab's «从旧绑定登记» (import from bindings; CLI `import-bindings`) folds every binding that points at one repository into one registration and marks bindings whose path no longer exists in red and skips them; the binding files stay byte-identical, and running it again never registers twice.

## Model tools

**This package registers no model tool any more (BREAKING)**: the eight tools below and the `datasets:tools` prompt section belong to the companion row `@khorsheed/dsh-datasets-tool`, granted per session by an agent preset. Migration is two lines: install the companion as a dependency and add `- id: datasets-tool` / `  name: '@khorsheed/dsh-datasets-tool'` to the target preset's `agent.cordis.yml` (that row may carry `config: { tools: authoring }`). The inventory, groups, and behavior prose below describe the **companion's** tool face from here on; the service, CLI, `/datasets`, and the session tab still belong to this package.

| Tool | Writes? | Purpose |
|---|---|---|
| `datasets_list` | | List the sets this deployment registered: `{ref, title, trackedRef, latest:{commit,date}, layers}`, with no path anywhere; an optional `query` narrows |
| `datasets_show` | | Dataset/item detail: summary, descriptor passthrough, layer-file listing |
| `datasets_describe` | | The raw `dataset.json` descriptor, verbatim |
| `datasets_read` | | One file of one item layer, from the git object at the pinned commit — no copy |
| `datasets_snapshot` | | Pin the tracked branch's current commit for stable reads while the repo evolves |
| `datasets_worktree_path` | writes the materialization cache | Whole-layer read-only view path (`git archive` of the registered layers only, content-addressed) |
| `datasets_put_item` | writes the working tree | Create/update an item's metadata and layer files in the registered `authoringCheckout`; refused when none is registered; `git commit` stays with the human |
| `datasets_validate` | | Authoring hygiene + judgeability: shape errors and unjudgeable rubrics fail loud; six warning kinds (undeclared modelFacing in a mixed dataset / sensitive-looking item.json field names / files falling into the passthrough zone / a declared canary missing from a visible-layer text file / objective leaves with no probe source / a dangling rubric.md reference), never blocking. Rule by rule in the [rule table](#validate-rule-table) above |

**Tool groups**: the `tools` config decides which group is registered — a preset cannot deselect a tool the profile already registered, so registration is the only place that can decide. The four tiers are one containment chain: `read` = the six read verbs (list / show / describe / read / snapshot / validate); `authoring` = read plus `put_item` (drafting into the working tree; committing stays the human's); `all` (the default) = authoring plus `worktree_path` (whole-layer materialization, which writes the materialization cache); `none` = no model tool at all. The prompt section describes only the tools actually registered, and contributes nothing under `none`. The service, the CLI, `/datasets` and the session tab are the human's faces — no tier touches them. **An eval domain wants `authoring`**: a planning agent reads and authors items, but whole-layer materialization is the orchestrator's action, not a step the agent should be able to start.

`worktree_path` returns a read-only directory under the materialization root, `<repoKey>/<sha>/<set>/<layers-key>/` (`repoKey` hashes the common dir, so every checkout of one repository shares the cache): `git archive <sha> -- <layer paths>` is unpacked into a staging area, stripped of write bits, and renamed into place atomically. The key fully determines the content, so a repeat call is a cache hit (`reused: true`), and concurrent creators each stage privately with the first rename winning. The return shape `{path, commit, layers, reused}` is the managed worktree's, unchanged. It replaces the managed worktree: `git worktree add` registers (and locks) an entry in the repository's **shared** `.git`, so every materialization wrote shared state of a checkout other people work in; `git archive` reads objects only — no index, no HEAD, no worktree list.

## CLI

The `dsh-datasets` bin mirrors the tools' read verbs (same semantics, same parameters) and adds the registry verbs. The CLI is the human's face: its read verbs' `--repo` takes a registry id or a repository path; omitted, it uses the deployment's only registration (zero or several are refused, with a sentence saying to pass `--repo`). By registry id, `--commit` defaults to the registration's tracked-branch tip; by path, to HEAD. Exit codes: 0 ok, 1 operational failure, 2 usage error. Reached through a symlink — a `PATH` entry, pnpm's `.bin/<name>` — the bin behaves exactly as `node lib/cli.js` does: the entry guard resolves `argv[1]` to its real path before comparing, so a symlinked path can never make it exit 0 doing nothing.

```sh
dsh-datasets list [--repo R] [--dataset D] [--commit C]
dsh-datasets show --dataset D [--item I]
dsh-datasets describe --dataset D
dsh-datasets read --dataset D --item I --layer L --path P [--commit C]
dsh-datasets snapshot --dataset D
dsh-datasets validate [--repo R] [--dataset D] [--commit C]
dsh-datasets worktree path --dataset D [--layers a,b] [--materialized-root DIR]
dsh-datasets registry [--state-root DIR]
dsh-datasets register --repo R [--id ID] [--tracked-ref B] [--set-layers set=a+b,…] [--authoring-checkout P]
dsh-datasets update --id ID [--tracked-ref B] [--set-layers set=a+b,…] [--authoring-checkout P|none]
dsh-datasets unregister --id ID
dsh-datasets import-bindings [--state-root DIR]
```

The registry verbs write `registry.json` under `--state-root` (default `$DSH_HOME/state/datasets`), read per call, so a running instance's next tool call sees a new registration. `bind` is retired and answers with `register`'s usage; `unbind` / `binding` are deleted.

## Slash commands

```
/datasets list [<id>/<set>]
/datasets show <id>/<set> [item]
```

`/datasets bind` is retired: it now answers with one sentence pointing to the 题集 tab's Register repository (or `dsh-datasets register`) and writes nothing. A dataset repository is registered once per deployment; it is no longer a per-session act. `list` with no argument lists every registration's `<id>/<set>`.

The command declares its free-form input (`input.hint`). That is not decoration: without it a capable composer has no reason to believe `/datasets` takes arguments — picking the command from the completion strip submits a bare invocation and leaves the `show <dataset>` the human typed in the MESSAGE body, so the command answers with its usage line (found during T36's live pass).

## The 题集 tab (web)

<!-- screenshot placeholder: docs/screenshots/…-datasets-tab.png (pending) -->

On web profiles the plugin contributes a **`datasets` tab** to the conversation's view ring (labelled 题集 / Datasets, beside chat and trajectory). Two pages in one shell, shaped by the [web-eval UI spec](../../profiles/web-eval/docs/ui-spec.md) §三 §四.

**The slot vocabulary.** Files are labelled by **who sees them**, not by layer name — a layer name is one dataset's authoring convention, and the person reading this tab is judging visibility. Every file falls in exactly one **role**, computed from `dataset.json`'s `layers` + `register` (a mechanical fact): the player sees it (a `modelFacing` layer), the judge only (`grading`), the probes only (`verify`), withheld from the player (any other sensitive layer), readable by everyone (the passthrough zone). On top of the role sits a **slot** display name — task statement / acceptance standards / reference answer / grading rubric / check scripts / other files — derived by a basename heuristic: anything under an `oracle/` segment is the reference answer, `task.md` and anything under `prompts/` is the task statement, `rubric*` and `standards-notes*` are the rubric, `standards*` are the acceptance standards, anything under `checks/` or `probes/` is a check script, and whatever matches nothing falls back to its role (the verify layer's default is check scripts, the grading layer's is the rubric). The protocol's two layouts therefore give the same answer: the register form's `answers/rubric.yml` and the convention form's `rubric.yml` are both "grading rubric · the judge only". The heuristic and the role computation live in one place, `src/slots.ts`, shared by the host and the browser — the protocol has no slot field, and forking the descriptor format for a display name is not worth it; per-dataset slot names are deferred.

**The list page**: grouped by registered repository (the group heading carries the registry id, the tracked branch, whether an authoring checkout is set, and edit / remove), one row per set — `set · trackedRef@short-hash · date · visible layers`, with the agent's reference `<id>/<set>` on the set cell's title, then the display name and which experiments used it. Every cell answers «what an agent gets when it names this row»: the reference, the commit «latest» means right now (the tracked branch's tip, not a checkout's HEAD), that commit's date, and the layers it may read. A registration whose tracked branch is gone stays on the list with the host's sentence (the agents' `datasets_list` simply skips it). The page-level gestures are **Register repository** (the form above) and **«从旧绑定登记»** (fold the legacy bindings in one click, dangling ones marked red and skipped); a group with an authoring checkout also offers **New dataset** (the `dataset.json` skeleton, `visible/prompts/`, `schemas/`, `items/`, written into the authoring checkout). The list is one RPC (`registry`); the per-set projections — item count, slot mapping, canary, `validate` — come with the detail page through `overview`. The "used by" column comes from the eval plugin's Remote, and **an instance without eval does not render the column at all** — a column of em dashes would promise a feature that is not installed.

**The detail page** (dataset › item): a file tree on the left where every leaf carries its slot and who sees it (three colours: visible to the player / withheld / unprotected), with a slot filter above it; four blocks on the right — **What the player will see** (this item's model-facing files plus the dataset-level task prompts, listed with byte counts, the dataset-level ones marked as such; an answer key that drifted into a visible layer shows up in THIS table first, which is what it is for), **Judgeability** (how many rubric leaves, how many per kind, how many probes, how many dataset-level probes, how many stage schemas), **Answer record** (this item's cells across every experiment; the whole area hides when eval is absent), and the selected file's preview. The preview is delegated to the official reader primitives — markdown through the official `MarkdownText` pipeline (the same renderer the chat uses), JSON through the official `JsonTree`, everything else through `CodeBlock`; there is no self-rolled renderer in this package. The gestures are **Item skeleton**, **Import an item** and **Validate**.

**Every write lands in the working tree only, and the commit stays the human's** (this plugin never commits). An item skeleton is homed by **this dataset's own shape**: when the descriptor's `register` already speaks for the item, the files land at the registered paths (`task.md` / `answers/rubric.yml` / `checks/probes/…`); when it does not, the convention layout applies (`<layer>/rubric.yml`). Existing files are never overwritten. The placeholder `rubric.yml` is deliberately leafless (`items: []`) — `validate` therefore reports `RUBRIC_NO_ITEMS` pointing at that file, which is the intended next step rather than a defect. Importing an item is a **verbatim copy** of an existing item directory, re-homing nothing: the dataset's own `layers` and `register` decide what each file becomes, and whatever lands outside every layer is reported honestly by `validate`. All three write gestures require the operator view (the tab's buttons); an agent's drafting path stays `datasets_put_item`, which writes only the registered authoring checkout.

**The error seat is three-part** (UI spec §九): one human sentence on what happened ("The registered tracked branch does not exist"), one on how to fix it (with the command when there is one), and the raw exception plus the absolute path folded under Details — the page itself never renders `error.message` and never exposes a path. The cause is recovered from the message text (a domain code does not survive the Remote wire; the browser sees one of the gateway's three transport codes), so `tests/error-state.client.spec.tsx` feeds the host's REAL sentences to the real classifier: reword one host message and the test goes red before a user sees the unknown-cause copy. The lab tab uses a copy of the same implementation — a client bundle never imports a sibling plugin (UI spec §八).

**Visual and copy pass, to ui-spec §九** (I5·T63, the same pass as the
Experiments tab). Both tabs now share one implementation of the status chip
(`Chip`), the empty seat (`EmptyState`), the section box and the «details»
disclosure — each as a verbatim copy, because a client bundle never imports a
sibling plugin (§八). What landed on this page: validate's result and the canary
flag became chips instead of coloured text, with the diagnostic code moved to
the row's `title` (the sentence stays on the page); every cell's BUCKET and
STAGE in «作答记录» now read through the same word table the Experiments tab uses
(`src/client/vocab.ts`) rather than as `done` / `archived`; a repository group
heading shows the registry id with the absolute path on its `title`; and
each empty seat (nothing registered / no dataset / filter matched nothing / no answer
record yet) carries a next-step sentence and its own action button, worded
differently from the toolbar's so the two never read as one button duplicated.

**Glossary v2 and colour semantics** (I5·T63, second pass): §九's three new
rules land on this page too. English terms in the column headers became words
(canary, validate), the snapshot column is now the dataset version, and every
row of «作答记录» reads «{arm} · take N». Colour collapsed to five tones (green =
done/succeeded, blue = in progress, grey = not started, red = failed/blocked,
amber = warning) through the same `stageTone` / `bucketTone` the Experiments tab
uses: archived / releasable / released are GREY, not green — reaching the end of
the pipeline is «finished», not «succeeded», and green is kept for `judged`.

**The five tones now actually reach the tokens** (I5·T67 fixups · W3): the tone each state CHOSE was always right, but the paint was not — `ok` used the brand blue `--dsw-alias-state-business-primary` and `busy` used the body label colour `--dsw-alias-label-primary`, so 「完成」 rendered blue and 「进行中」 grey. They are `--dsw-alias-state-success-primary` and `--dsw-alias-state-business-primary` now. The two tabs carry the chip as two hand-kept copies (§八), so both took the correction, and eval's `tests/tones.spec.ts` reads BOTH stylesheets to hold it — a chip's colour is a token in a stylesheet, and jsdom neither loads stylesheets nor computes styles, so no client spec can see it.

The tab's data face is a Typert Remote service (`datasetsRemote`, wire namespace `datasets`) over the same service core as the tools: `registry` / `previewRepo` / `register` / `updateRegistration` / `unregister` / `importBindings` / `list` / `show` / `read` / `readPassthrough` / `overview` / `itemBrief` / `validate` / `scaffoldDataset` / `scaffoldItem` / `importItem`. Read requests carry the registry `id` (`repo`), which the host resolves to the repository; the read methods are the operator view — the whitelist and the modelFacing floor constrain the agent boundary (tools + materialized views), never a human reading their own repository, so sensitive layers stay readable with a `· sensitive` marker while the genuinely unprotected passthrough zone and `item.json` are marked conspicuously. The one exception is the two judging reads behind `itemBrief`: they name their **one layer explicitly** (`layers: ['grading']` / `['verify']`) instead of taking the operator bypass — the page needs the answer key's shape (how many leaves, of which kind), and its bytes never go on the wire. The browser half mounts the namespace through the official `ctx.remote.$mount` channel; eval's namespace is probed with `ctx.get` on **every call** rather than once at mount — the two plugins `$mount` independently and neither may assume it loaded second.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.2-rc.1`): ✅ — every capability works; the contract surface (`ctx.tools`, `ctx.commands`, log-only session events, the Typert Remote channel, `conversation.view`) is stable on this line. minHost moves up to 0.1.2-rc.1 — older hosts stay on the previous release line.
- source line (deepseek-harness master): ✅ (verifiedHost: 0.1.2-rc.1).
- The canary check and the judgeability check are both internal (they only read git objects) — no new host capability, identical on both lines; the `tools` grouping moved with the model-tool face to the companion row `@khorsheed/dsh-datasets-tool` (`read` / `authoring` / `all` / `none`), and this row no longer has that config key.
- The dataset registry and read-only materialization (T73) are internal too: the registry is one JSON file under the state root and materialization uses only `git archive` + `tar`, so no new host capability is needed and both lines behave the same; the native directory chooser rides the existing host probe, and when the probe fails only the path input remains.
- ⚠️ degraded (both lines): slash commands need an interactive UI adapter (web/TUI profile); on headless profiles `/datasets` is unavailable while the CLI stays fully functional (the model tools come from the companion row). The 题集 tab self-hides: it registers only when the current session's preset composition names the `@khorsheed/dsh-datasets-tool` row, read from the official `pluginInventory` Remote, and every unreadable path fails OPEN (stays visible). **"The current session's preset" means the nearest one in its PARENT chain** (I5 · T60; web-eval T39 · G13): a member sub-session declares no preset of its own, so read alone it failed open and every gated tab appeared inside a player's sub-session. Release order matters: a pack that names a companion row needs the companion published / installed first — a row that fails to resolve reports the preset composition `broken` while the instance boots unaffected. The session tab is a web surface — TUI has no tab mechanism; headless profiles serve the Remote data face without a browser consumer.

This section mirrors the `dsh.compat` field in package.json; the two move together.

## Known Limitations and Deferred Work

- **Descriptors are JSON, not YAML** — the layout convention calls them `dataset.yml`/`item.yml`; v1 reads `dataset.json`/`item.json`. The judgeability check has to read rubrics (YAML on the suite side, a shape this package does not get to choose), so `js-yaml` has been on the dependency chain since; descriptors staying JSON is now a shape decision rather than "no parser available". Accepting both is one deliberate change away, unmade because nobody has asked.
- **Item metadata is not validated against `itemMetaSchema`** — the schema is declared, shape-checked as an object, and passed through; full JSON-Schema validation of item metadata needs a validator dependency this package does not take.
- **The session tab's preview reads whole files over RPC** — `read` serves full file content with no byte cap (the same semantics as the tool); very large layer files are better consumed through `worktree_path`.
- **The canary and judgeability checks read file content, one file at a time** — `validate` runs one `git show` per visible-layer text file (the canary), plus one or two more per item carrying a rubric (the rubric and its `rubric.md`); these are the only two content-reading checks in the plugin, which is why both run on `validate` only and the `list`/`show` summary warnings stay shape-level.
- **The judgeability check hardcodes the layer names `grading` / `verify`** — the judging convention (authoring protocol §6.7/§6.8) is written in those two names, and the orchestrator mounts exactly them. Layer names are otherwise free in this plugin, so a suite that files its rubric under a different layer name is not checked (and not falsely reported either). Making the names descriptor-declarable is a protocol change, not one this package settles alone.
- **A file written into the working tree is invisible until it is committed** — the tree, `list`/`show`/`validate` all read git objects at HEAD, while `put_item` and the tab's three write gestures only write the working tree. A freshly written skeleton is not in the tree and `validate` does not report it yet; both happen once you commit, and the tab says so on every write form and every write result. Making the read paths also see the working tree would make "snapshot" meaningless (a run pins a commit), so this is a choice rather than an oversight.
- **The materialization cache is never collected** — one read-only directory per (repository, commit, set, layers), so each move of a tracked branch may add one. To reclaim space, delete the whole `materialized/` subtree (the directories are read-only: `chmod -R u+w` first); the next call rebuilds on demand.
- **Managed worktrees from before T73 are not cleaned up by this package** — they are registered (and locked) in the dataset repository's shared `.git`, so removing them writes shared state; a human runs the commands listed in the T73 Agent Note under `.agents/notes/`.
