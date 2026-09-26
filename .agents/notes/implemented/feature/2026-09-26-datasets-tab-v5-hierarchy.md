# Agent Note: Datasets tab list and detail at the v5 hierarchy

Status: implemented

## Problem

The T79 walkthrough (scene 11, P1-11, P1-12, P2-15) set the real 题集 tab next to interaction draft v5 and found three gaps. The list had no header. It printed the raw layer name («agent 可见：visible»). Its «用于» cell laid 21 experiment names flat over three lines. The detail page was a file tree with an empty right pane, and visibility was only explained by per-file coloured markers. At 400px the right pane was squeezed into a one-character column and the top buttons folded their labels vertically. The reader's two questions — what does the agent get from this set, and what does the player see versus the judge — were answered by decoding names.

## Decision

The list page is one table under one header: 仓库 · 题集 / 最新版本 / 题数 / agent 可见 / 用在哪些实验. Each registration gets a group row, and each set gets a row under it. The «用在哪些实验» column, header included, renders only when an eval plugin answers.

- **«agent 可见» is a word, not a layer name.** `layersPhrase` in `src/client/vocab.ts` maps known names: `visible` is the task face, and `verify` / `grading` carry answers.
  - Every layer known and none answer-bearing reads 「只看题面」.
  - Any answer-bearing layer reads 「含答案」, and unknown names ride after it.
  - No answer layer plus an unknown name is undecidable, so the raw names are the word.
  - The hover title always lists the exact layers. For an unknown name it adds a sentence saying the name is not in the table and the page does not guess.
  - The detail header uses the same component (`LayersWordView` in `parts.tsx`).
  - The word is read-only. Beside it, a «改» (`LayersEdit`) opens this registration's edit form, the same form the group row's «编辑登记» opens. The host's `previewRepo` answers an already-registered repository with its registered layers (`setView(…, existing.sets[set])`), so the chips arrive prefilled. The form stays the one writer of a set's layers. The detail header carries the same «改».
- **«用在哪些实验» is a count.** It reads 「N 个实验 · 分布在 M 个版本」, and a click unfolds the names with each one's pinned commits.
  - Runs fold by `experimentId` (a re-run is not another experiment). A run from the older ledger has no id and folds by its name instead: folding those by run id showed 22 experiments on the 3171 ledger where 17 were real.
  - A version is a distinct pinned commit.
  - Rows match on the set id and, when the snapshot names one, on the registration id, so two registrations' `default` sets do not share counts.
  - To make this possible, the structural eval mirror (`client/index.ts`) and `DatasetExperimentRow` now carry `experimentId`, `registry` and `commit`. They are optional on the mirror, so an older eval degrades to «match by set, count unpinned».
- **«题数» comes from one set-less `list` read per registration.** The registry RPC carries no counts, and this task changes only the client.
  - The N reads go out together: the effect fires every read before any answers, and each lands in its own cell. A spec keeps them in flight at once.
  - A cell stays an em dash while loading or after a failed read. It is never 0.
- **Detail: two boxes side by side** once an item is open: 「选手将看到」 (the brief's player files, as before) and 「只有判官和探针看得到」.
  - The second box lists the item's files, plus dataset-level files, in non-modelFacing layers. This is the complement from the same layer declaration the tree markers use.
  - «可判性» closes it as one line.
  - The tree's per-file markers stay, as secondary information.
- **Narrow layout** keys off the view's own width (`container: datasets-view`), not the window's.
  - Below 700px the right pane moves under the tree and the body scrolls as one page.
  - A right pane narrower than 520px stacks the two boxes.
  - Top-bar buttons wrap only as whole buttons (`flex: none; white-space: nowrap`), and the title half truncates first.

## Alternatives considered

**Add item counts to the host's `registry` answer.** One RPC would stay one RPC, but the brief limits this change to the client and README. The per-registration `list` read is also cheap: it reads git objects, and there is one per repository, not one per set. If the list grows to many registrations, moving the count host-side is the natural follow-up.

**A segmented 「只看题面 | 含答案」 control, as drawn in v5.** v5 means the person switches this here. Changing a set's layers is the register/edit form's job (the human gesture with a confirm step), and a second writer on the list page would bypass that form. The «改» keeps v5's «switch it from here» as one click into the prefilled form, not as an in-place control. The form's per-layer chips are also finer than a two-state toggle: a set may carry an unknown layer the toggle could not express.

**Map unknown layer names by heuristic (e.g. `answers*` → answer-bearing).** The brief says not to guess. A wrong 「只看题面」 is the one error this cell must never make, so unknown names show as written.

**Replace the tree with the two boxes.** The tree is where the file preview and slot filter live, and it is how an author finds a misplaced file. The boxes answer the check at a glance, and the tree stays for the work.

## Consequences

- The list page no longer costs a single RPC: it makes N+1 calls (registry plus one `list` per registration with sets). The client spec pins the set-less call and the «—, never 0» fallback.
- The judge box lists paths without byte counts (`ItemRecord` carries paths only). The player box keeps its byte counts from the brief.
- The layer word table is duplicated knowledge of the protocol's layer names (`grading` / `verify`, the same names `validate`'s judgeability check keys on). A repository with other answer layer names reads raw names, not a false 「只看题面」.
- `tests/vocab.spec.ts` pins the four word cases. `tests/DatasetsView.client.spec.tsx` pins the header, the count fold (experiment and registration filtering, version count), the dash fallback and the judge box's complement.
