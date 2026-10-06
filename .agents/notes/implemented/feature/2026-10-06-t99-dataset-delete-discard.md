# Agent Note: datasets and eval — deleting a dataset, discarding an organizing result, a lab list that survives broken directories

Status: implemented

## Problem

The Datasets tab could only take a registration back. Its 「移除登记」 called the Remote `unregister`, which removes the record and leaves the repository on disk. A person who wanted a dataset gone had no way to do it in the page. A repository the agent had organized (a T90 proposal waiting on the banner 「Agent 整理好了「…」，等你确认登记」) could only be confirmed, never thrown away.

During the same walkthrough, the lab list showed four raw English lines above the list: `no experiment "<id>" in this deployment`. That instance's `DSH_HOME` sat in a system temp directory. The temp cleaner had deleted the files and left empty directories. `listExperimentRecords` put each one into `problems`, and the lab printed the host's sentences verbatim.

Separately, the 「agent 可见」 column ended every layer list with a permanent grey 「改」. It duplicated the row's own 「编辑登记」 and read as noise.

## Decision

### One 「删除」, one confirmation, two outcomes

Each registration row has one 「删除」 (`registry.remove`), and the armed two-step removal is gone. The button opens one dialog (`src/client/RemoveDialogs.tsx`, `DeleteDialog`). The dialog asks the host what a delete would do (`deletePlan`), then shows:

- the directory that would go, in code type;
- how many pieces of plugin state go with it;
- the experiments that used the registration, as experiment names (runs fold), with 「这些实验的历史记录保留，但不能再跑」. This comes from the same rows as the 「用在哪些实验」 column (`datasetExperiments`, eval's namespace probed per call). Datasets never imports eval: without eval the block is simply absent;
- 「删除后无法撤销」.

The footer separates the two outcomes. The danger-styled 「删除」 removes the registration and the files (`deleteRegistration`). The ghost 「只移除登记」 removes the record and keeps the files (the existing `unregister`). Each is also spelled out as a line in the body, so the choice reads before the buttons do.

When the host's plan says the files stay, the dialog changes form. This happens for a repository outside the datasets home, behind a symlink, not the repository root, with other checkouts, or already gone. The title becomes 「移除登记「id」」, the body gives the reason, opening with 「文件留在原处」, and the only action is 「移除登记」. There is no delete button to misread.

A refused or failed call keeps the dialog open with the message (`role="alert"`). Success refreshes the registry and the proposals.

### Path rules (host side, `src/removal.ts`)

The browser names a registration or a proposal **by id**. The directory is derived on the host from the record's git common dir: `<root>/.git` → `<root>`, and a bare repository is its own directory. A `path` field smuggled into the request is ignored. A directory is deleted only when every rule holds. Otherwise the plan is `keep` with a `keepReason`:

1. **`outside-home`**: the directory must lie *strictly* inside the realpath of the datasets home (`organizing.datasetsHome`, default `$DSH_HOME/datasets`). The home itself is never a candidate.
2. **`missing`**: the directory is already gone.
3. **`symlink`**: no component from the home down to the directory is a symlink, and the directory's realpath equals itself.
4. **`not-repo-root`**:
   - a work tree's `.git` must be a real directory, not a link and not a gitfile;
   - git, asked from the directory, must answer the same common dir;
   - for a work tree, git must name the directory itself as the toplevel. A folder inside a repository, or a different repository, is refused.
5. **`other-checkouts`**: `git worktree list` may name no live checkout outside the directory. The legacy managed worktrees under this plugin's own state root (`<stateRoot>/worktrees`) are not "other": they count as plugin state.
6. The materialized view `<stateRoot>/materialized/<repoKey>` joins the plugin state when present and not a link.

The plan is recomputed at the moment of deletion. A `keep` plan makes `deleteRegistration` throw `NOT_REMOVABLE`. Deletion works in three steps:

- first an atomic rename to a hidden sibling inside the home (`.removing-<name>-<pid>-<ts>`);
- then the record goes, along with any open proposal for the same repository;
- then the renamed tree and the plugin state are removed with `removeReadOnlyTree`, which unlinks links instead of walking them.

A failure after the rename leaves a hidden leftover, never a half-deleted repository that is still registered.

### 「放弃」 on the organizing banner

The pending-proposal banner gains a ghost 「放弃」 next to 「核对并登记」. `DiscardDialog` shows the directory and says the organizing session stays, then calls `discardProposal`. That call requires the proposal to be pending or returned, deletes the proposal record, and deletes the organized repository under the same rules. One more keep reason applies: **`registered`**, where the proposal is an update, or its repository is already registered. Discarding never deletes a registered repository. When the repository goes, other open proposals for it go too. The organizing session, its transcript and its worktree under the session are not touched.

### Lab list tolerance (eval)

`listExperimentRecords` handles unreadable directories in two ways:

- A directory whose meta cannot be read, and which holds nothing but (nested) empty directories, is skipped silently: it has nothing to recover.
- A directory with content is reported as `{id, message}`. A symlink, any other entry, or an unreadable subdirectory counts as content.

`listExperiments` now returns structured `notices` (`{code, params, text, items?}`, the T98 judge-note shape) next to the unchanged `notes`, which is the notices' text kept for text consumers. All unreadable directories fold into one `experiments-unreadable` notice with `{count}` and the names in `items`. The lab renders it as one line, 「有 N 个实验目录读不出来」, that opens to the names.

The lab words every code it knows and falls back to the host text for an unknown one. From an older host without `notices`, it shows the plain notes. The other list notices are localized by code:

| Code | When |
|---|---|
| `plan-unreadable` | `{id, detail}` |
| `mission-missing` | no mission service |
| `mission-cannot-list` | the mission service has no run listing |
| `mission-list-failed` | `{detail}` |
| `state-root-missing` | DSH_HOME unset |

### The hover pencil

`LayersEdit` (`src/client/parts.tsx`) is an icon button: `IconEditOutlineMedium` from the ui-primitives artwork, regenerated into the package's `icons.tsx`. Its `title` and `aria-label` are both `layers.editTitle`. In the table (`variant="row"`) it is transparent until the row is hovered or focus enters it. Under `@media (hover: none)` and at container widths of 560px or less it is always shown. The detail page's bar (`variant="bar"`) always shows it, because that bar has no row to hover.

Other small always-visible actions in the same table, checked against the same rule:

- **Usage toggle (「用在哪些实验」 count).** Kept visible: it is data, the count, and only incidentally a button.
- **「待确认」 pending chip.** Kept visible: it is status.
- **Repository-group actions (「交给 Agent 修改」「编辑登记」「删除」).** Kept visible: they head a repository group, not a set row, and are the page's primary verbs for that repository. Hiding them would hide the only way to start those flows.
- **Nothing else.** No other permanent inline action sits in a set row.

## Alternatives considered

**Two buttons on the row, 「删除」 next to 「移除登记」.** The brief allowed it. It lost because the row already carried three buttons, and two that both "remove" read the same at a glance. In one dialog the two outcomes sit side by side with their consequences spelled out, and the host decides which are offered. An external repository never shows a delete button at all.

**Trust a client path and check it on the host.** A path the browser sends must be validated against the record anyway. Deriving it from the record leaves nothing to validate and nothing to forge.

**`rm -rf` the directory in place.** A crash halfway would leave a registered repository with half its files. Rename-then-remove makes the visible state change atomically.

**Follow symlinks inside the home to their real target.** A link into the home can point anywhere, for example at a person's own checkout. Refusing any link on the way is the only rule that never deletes outside the home.

**Delete the organizing session's worktree on 「放弃」 too.** The brief keeps the session untouched, and the session is where the person sees what the agent did. Its files are the session's, not the dataset's.

**Hide every unreadable experiment directory.** An emptied directory is noise, but one with content may hold a person's work. Naming them, folded, keeps the list clean without silently losing something.

**Replace `notes` with `notices`.** Text consumers and older browsers read `notes`, so both travel. `notices` is optional in the type, so an older host still type-checks.

## Consequences

- A dataset can be deleted from the page; external repositories can still only be unregistered, and the dialog says so.
- Deleting is irreversible by design; the dialog says it and names the experiments whose re-runs it breaks. Their history stays readable.
- `deletePlan` / `deleteRegistration` / `discardPlan` / `discardProposal` are new Remote verbs; `NOT_REMOVABLE` is a new error code.
- Notes that remain English, not above the lab list: `runsForItem` notes (item answer records), the draft options notes (`draft.ts`, shown on the design page), and item-materials notes. They are out of T99's scope.
- The repository-wide icon sync (`scripts/sync-icon-artwork.mts`) fails against both available harness lines (each lacks one artwork the other has). Only datasets' `icons.tsx` was regenerated, from the 0.1.7-rc.1 artwork.

## Testing

- `packages/datasets/tests/removal.spec.ts` runs entirely in `mkdtemp` directories and covers:
  - deletion inside the home, with the materialized state;
  - outside the home, unregister only;
  - a link into the home, and a symlinked directory on the way;
  - the home itself, and a path that is not the repository root;
  - a checkout outside the directory;
  - the delete plan naming the sets experiments pin (`sets`);
  - an unknown id, and a smuggled client path;
  - discard: a new repository goes, an outside one keeps its files, a registered one is never deleted, a confirmed proposal refuses.
- `packages/datasets/tests/DatasetsView.client.spec.tsx` covers:
  - the delete dialog with experiments, the unregister-only path, and the external-path keep form;
  - a refused delete;
  - the 「放弃」 banner and both discard forms;
  - the pencil's aria-label and its row/bar variants.
- `packages/eval/tests/experiment-store.spec.ts` and `experiments.spec.ts` cover emptied versus broken directories, the folded notice, and the codes.
- `packages/eval/tests/LabView.client.spec.tsx` covers the fold, the code-to-sentence path, and the unknown-code fallback.
