# Agent Note: the 题集 tab's slots, player view, skeletons and imports (I5 · T47)

Status: implemented

English | [中文](2026-09-14-datasets-tab-slots.zh.md)

## Problem

The old datasets tab was a binding bar, a tree keyed by layer name, and a preview. A layer name (`visible` / `verify` / `grading`) is **one dataset's authoring convention**, while the person opening this tab is always judging something else: does the player see this file. "The user cannot read it" was accurate feedback.

The UI spec ([ui-spec](../../../../profiles/web-eval/docs/ui-spec.md) §三 §四) fixed the shape: label files by who sees them, show slots as task statement / acceptance standards / reference answer / grading rubric / check scripts / other files; one row per dataset on a list page; a detail page with the tree, the preview, a slot filter, «what the player will see», judgeability and the answer record; creation is a skeleton plus an import, and the tab owns no body editor.

## Decision

- **The role is a mechanical fact, the slot is a display name, and the two are computed separately.** Every file falls in exactly one **role** by `dataset.json`'s `layers` + `register`: the player sees it (a `modelFacing` layer), the judge only (`grading`), the probes only (`verify`), withheld from the player (any other sensitive layer), readable by everyone (the passthrough zone). The layer decides that, and a display heuristic gets no vote in it. The **slot** then comes from a basename heuristic, falling back to the role when nothing matches.
- **The two layouts must produce the same answer** — that is the heuristic's acceptance criterion. The register form's `answers/rubric.yml` (item-relative) and the convention form's `rubric.yml` (layer-relative) must both read "grading rubric · the judge only". Half of that answer comes from the path and half from the role's fallback (the verify layer defaults to check scripts, the grading layer to the rubric); the paired table in `tests/slots.spec.ts` pins it, so breaking either half surfaces as "this pair stopped agreeing".
- **The rule ORDER is deliberate**: an `oracle/` segment is the strongest signal and wins over everything; `task.md` and `prompts/` are the task statement; `rubric*` and `standards-notes*` are the rubric — and that rule **must precede** `standards*`, or the judge's private notes get filed under the slot the player reads.
- **The heuristic and the role computation live in one module, `src/slots.ts`**, free of `node:` and of yaml, imported by the host and the browser alike. The tab and the service therefore cannot give two answers to "who sees this file". `GRADING_LAYER` / `VERIFY_LAYER` moved here from `rubric.ts` for that (re-exported there, so no consumer changed).
- **Five roles, three colours.** The reader's first question is whether the player sees it, so everything withheld from the player shares one colour and the role word answers the second question.
- **The list page is one RPC (`overview`).** Slot ← layer needs the register expanded and `validate` reads file content: host work (ui-spec §八). A list page firing three RPCs per dataset would also answer in a different order every refresh.
- **The canary is reported as present or absent, never carried.** It is the one string that proves a leak; putting it in a payload puts it in a log.
- **The "used by" column does not render at all on an instance without eval**, rather than rendering a column of em dashes — the latter promises a feature that is not installed. Likewise the answer record disappears entirely when eval is absent, and **stays** (carrying eval's own reason verbatim) when eval is present but cannot answer. Those two facts must be said differently.
- **The two judging reads behind `itemBrief` name their one layer explicitly** (`layers: ['grading']` / `['verify']`) instead of taking the operator bypass. The page needs the answer key's **shape** — how many leaves, of which kind — and its bytes never go on the wire; this is the same discipline the orchestrator's judge path follows (eval's `faces.ts`), and narrower than the operator bypass the architecture table allows.
- **An item skeleton is homed by this dataset's own shape.** When the descriptor's `register` already speaks for the item, the files land at the registered paths: an exact pattern matching the convention path is used verbatim, then an exact pattern with the same basename, then a single-segment glob whose trailing `*` hosts the basename — **preferring the glob whose directory matches the convention path's own**, so `probes/README.md` lands under `checks/probes/*` and not `checks/*` (a probe is a probe by sitting under a `probes/` segment, protocol §6.7). With no register entry the convention layout applies. Guessing wrong is not an aesthetic problem: it drops a rubric outside every layer, into the passthrough zone, readable by every bound session.
- **The placeholder `rubric.yml` is deliberately leafless (`items: []`).** `validate` therefore reports `RUBRIC_NO_ITEMS` pointing at that file. That is the intended next step, not a defect: all a skeleton owes the author is a file in the right place with an obviously unfinished body.
- **Existing files are never overwritten** (`putItem` stays an upsert; the two semantics differ and both are stated on the face).
- **Importing an item is a verbatim copy that re-homes nothing.** The dataset's own `layers` and `register` decide what each file becomes, and whatever lands outside every layer is reported honestly by `validate`. Guessing a home by slot would hide the problem exactly when the author most needs to see it.
- **The three write gestures require the operator view.** A brand-new dataset id cannot be inside any whitelist by construction; rather than inventing an exception for it, the rule is stated: these are the tab's buttons (a human gesture), and an agent's drafting path stays `datasets_put_item`, inside the session binding.
- **eval's namespace is probed with `ctx.get` on every call**, not once at apply. The two plugins `$mount` independently in whatever order the loader composes them, and a one-shot probe would hide the answer record for the life of the page on an instance that does carry eval.
- **`/datasets` gained its `input.hint`** (found during T36's live pass). Without a declared free-form input a composer has no reason to believe the command takes arguments: picking it from the completion strip submits a bare invocation and leaves the typed `bind <path>` in the message body, so the command answers with its usage line. The hint's content is copy; its PRESENCE is the contract, and that is what the test pins.

## Alternatives considered

### Why not add a slot field to `dataset.json`?

That is the more precise path: the author declares it and nothing is guessed. The cost is forking the descriptor format for a **display name** — the protocol changes, the dataset repositories change, eval's read side follows, and existing datasets migrate. Meanwhile both existing dataset repositories are named regularly enough that the heuristic never guesses wrong (the paired table in `tests/slots.spec.ts` covers seven file classes across both layouts). Per-dataset slot names are therefore explicitly deferred, not forgotten.

### Why not compute the byte counts and `validate` in the browser?

The browser already has the `ItemRecord` (layer → display path), which is plenty for the slot — that is exactly why the tree's markers are computed client-side. But byte counts need the files read, `validate` needs the rubric and the canary read, and slot ← layer needs the register expanded. Moving those into the browser means either one RPC per file or git reads in the client. Computing the projection host-side also means the tab and the `datasets_*` tools share one semantics.

### Why does the skeleton not commit?

Because this plugin never commits (protocol §0), and that is not fastidiousness: a dataset's snapshot IS a commit, and a run pins it. A UI that commits for you decides which set of bytes is called "this version of the item". The cost is real — **a freshly written skeleton is not in the tree and `validate` does not report it yet**, because every read path goes through git objects at HEAD. That sentence is therefore on every write form, on every write result, and in the limitations list on both READMEs.

### Why not render the answer record as an empty section when eval is absent?

An empty section reads as "nobody has answered this item yet". That is a statement about the **item**, while the truth is a statement about the **instance**: this machine has no orchestrator. The two lead to completely different next steps, so an absent eval removes the area and an eval that cannot answer keeps it and shows its reason.

## Consequences

- `DatasetsRemoteService` grows six verbs: `overview`, `itemBrief`, `validate`, `scaffoldDataset`, `scaffoldItem`, `importItem`. The seven existing ones are untouched.
- `DatasetsService` grows the same five methods; `createDatasetsService` now returns a named const so `overview` can reuse `validate` and `itemBrief` can reuse `read` (one core, never a second copy of a semantics).
- Three new modules: `slots.ts` (pure, shared by both halves), `brief.ts` (the list row, the player view, judgeability), `scaffold.ts` (the skeleton bodies and the placement rule). `rubric.ts`'s two layer-name constants moved into `slots.ts` and are re-exported from where every consumer already looks.
- The client splits into a shell plus two pages: `DatasetsView.tsx` (fetches and page switch), `DatasetList.tsx`, `DatasetDetail.tsx`, `SkeletonForm.tsx`, `parts.tsx` (the vocabulary the pages share).
- The tab's label changed from 数据集 to 题集 / Datasets; the self-hide criterion (a `@khorsheed/dsh-datasets-tool` row in the preset) is untouched.
- One React self-cancellation surfaced during implementation: the brief effect listed `briefs` / `briefLoading` in its dependencies while its own first act was `setBriefLoading(true)` — the state change re-ran the effect, the previous run's cleanup set `cancelled`, and the answer to the request just fired was dropped, leaving the panel on "loading" forever. Fixed with a ref of already-requested keys, which keeps the guard out of the dependency list. Effects of this shape are worth auditing the same way.
- T39's end-to-end walkthrough inherits both pages; per-dataset slot names and the list page's `validate` cost are deferred.

## Testing

- `packages/datasets`: 167 tests green (148 before).
- `tests/slots.spec.ts`, 19 cases: the role computation (including a dataset that declares nothing sensitive, and the passthrough zone), the five path rules and their order (`standards-notes` must precede `standards`; an `oracle/` segment wins over everything), the **paired two-layout table** (seven file classes, each comparing slot / role / colour across both layouts), the fallback never upgrading a visible-layer file into a slot it did not earn, and `slotLayerMap`'s reserved passthrough name and ordering.
- `tests/scaffold.spec.ts`, 12 cases: the four placement branches (exact, same basename, glob filled with the basename, glob directory preference), the convention fallback, the four planned slots plus one honest reason per slot this dataset cannot hold, and a skeleton descriptor that declares `modelFacing` per layer.
- `tests/remote.spec.ts`, 10 new cases: `overview`'s slot ← layer, canary-presence-only and validate cells; `itemBrief` listing the same three files in both layouts, counting the rubric's shape while never shipping its text, and saying why a number is missing when a dataset declares no grading layer; `scaffoldDataset`'s placement and its refusal to overwrite; `scaffoldItem` filling only the missing probe README on a register-homed item (under `checks/probes/`) and using the convention layout on a new one; **`validate` before and after the commit** of a skeleton (working tree vs HEAD, pinning the limitation above); `importItem`'s verbatim copy and its non-directory refusal; and all three write gestures refused under an agent scope with nothing written.
- `tests/DatasetsView.client.spec.tsx`, rewritten to 22 cases: the list page cell by cell (including "one RPC" and the passthrough zone not rendering as a layer named `-`), the used-by column vanishing without eval and filtering by dataset with it, the six slot · role markers on the detail tree, the slot filter (asserted inside the tree — «what the player will see» is a projection of the item, not of the filter), the player view's bytes and dataset-level marking with no answer key in it, the per-kind judgeability counts, the **three states of the answer record** (absent / listed / present-but-unanswerable with its reason), the preview and passthrough reads, the three write forms and validate's read-back, and the binding bar's existing behaviour.
- `tests/tool-groups.spec.ts`, 1 new case: `/datasets` declares its `input.hint` (the regression for T36's bug).
- `pnpm gate --all` green.
