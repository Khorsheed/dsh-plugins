# Agent Note: eval and datasets tabs brought to visual parity with interaction draft v5 (T83)

Status: implemented

## Problem

The layout of the lab (eval) and dataset (datasets) tabs already followed interaction draft v5 (`proposals/prototypes/eval-journey-redesign.html`); see [the lab journey note](2026-09-26-eval-lab-journey-v5.md), [the design/result hierarchy note](2026-09-26-eval-design-result-hierarchy.md) and [the datasets hierarchy note](2026-09-26-datasets-tab-v5-hierarchy.md). On a real instance, though, the pages still looked unfinished. The causes were concrete:

- **Buttons.** The host `Button` defaults to `variant="ghost"`. Of 83 `<Button>` uses across both packages, 62 set no variant and rendered as bare text, so primary, secondary and destructive actions looked identical.
- **Content width and type.** The body stretched to the full tab width (1158px at 1440). Body text was 12px where v5 uses 13px.
- **Tokens.** The plugin CSS referenced two tokens the host does not define (`--dsw-alias-bg-l2`, `--dsw-alias-state-danger-label`). They resolved to nothing, so backgrounds went transparent and colours were inherited.
- **Scene gaps.** Several scenes still differed from v5:
  - The human-review form opened every evidence box at once.
  - The plan estimate filled missing items with averages from unrelated items.
  - Dataset detail cards ran their file lists together as wrapped monospace text.
  - The run-record timeline drew every dot grey.

## Decision

### Button variants carry the action hierarchy

Every `<Button>` states its variant; nothing relies on the host default.

- **`primary`** marks the one next step a page asks for, at most one per page.
- **`outline` + `sm`** is v5's default `.btn`. The host's 28px pill is visually equivalent, so no plugin-local button is drawn.
- **`danger`** marks destructive actions.
- **`ghost`** is kept for explicit utility actions (refresh, back).

The hierarchy is the information: with one uniform style, a reader cannot tell which button moves the experiment forward.

### Segmented control: one thin `Seg` per package

- **eval.** `packages/eval/src/client/parts.tsx` carries `Seg` / `Seg2`: a `radiogroup` with arrow-key movement.
- **datasets.** The datasets tab has no segmented-control use yet. When one appears, it copies eval's `Seg` into its own `packages/datasets/src/client/parts.tsx`, with the same name and shape; it does not import it.

The two packages must never import each other (the eval/datasets independence rule). The host ships no segmented control. A shared third package just for one ~40-line component would add a cross-package edge to every install of both. Two small copies are the cheaper contract.

### Human review: the evidence box opens after a row is chosen

The judge table is a compact three-column table: criterion, judge verdict, and your final ruling (a `Seg` for holds / does not hold).

- The evidence box expands under a row only once that row's ruling is chosen, and it is still required.
- Opening every box up front turned a 13-criterion card into a wall of empty textareas. The criteria and verdicts, which the reviewer scans first, sat far apart.
- Evidence belongs to a ruling. Asking for it before the ruling exists invites boilerplate.

### The plan estimate is a floor, never an extrapolation

`planEstimate` (`packages/eval/src/plan-items.ts`) sums per-item means only over items that have past answers.

- **Coverage.** An item counts for a field (active time, output tokens) only when every condition has at least one sample for it. An item answered by only one group is treated as uncovered.
- **Display.**
  - All items covered: the sum shows as 「≈」.
  - Some items covered: it shows as 「≥」, followed by a line naming the covered items and their answer counts, and the items with no estimate.
  - No item covered: it shows 无估算 (no estimate).
- **Rationale.** The earlier version filled uncovered items with the mean of the covered ones. In practice that meant using a one-stage placeholder item to price L3/L4 four-stage container items. That guess is always low, and a low number misleads the person approving the run. The standing rule is "no past answers of the same kind, no guess".

`plan-items.spec.ts` pins the rule: the partial-coverage case sums only the covered item, and a single group's answer does not count. `LabReview.client.spec.tsx` pins the 「≥」 wording and the partial note.

### Dataset item detail: one file per row, recent-first lists

- **File cards.** The two cards list one file per row: the path in monospace, with a small note on the right (size, 「13 条判据」, 「题集级」). The cards are top-aligned and of equal height through the grid's stretch; a long body scrolls inside its card (`max-height: 260px`).
- **Used by.** 用过这道题的实验 (experiments that used this item) lists the newest 5, then 「等 N 个」, which expands.
- **Answer records.** 作答记录 shows the newest 5 runs; the rest fold into 「更早的作答记录 · N」.

### Run-record timeline carries the state

Each stage dot carries its state:

- a completed stage is a filled dot in the host's success colour;
- the current stage of a moving cell is the business-primary ring;
- a halted cell's last stage is the error colour.

A hairline joins each dot to the previous one, as in v5. Only stages the record actually reached are drawn.

### Where the remaining gaps live

The per-scene gap table lives in `profiles/web-eval/docs/t83-visual-parity.md`: §十一 for the rulings batch and §十二 for phase 4. The coordinator accepted these as permanent differences from v5:

- The full score is the real value, not v5's sample number.
- The breadcrumb has no version switcher.
- The timeline draws only reached stages.
- The 「打开子会话」 wording stays.

## Alternatives considered

**Why not change the host `Button` default?** The host is tracked, not modified. A default change is a host-wide behaviour change for every plugin. Stating the variant at each call site also documents the hierarchy where it is decided.

**Why not share `Seg` through a common package?** It would create the eval↔datasets (or eval/datasets→new package) edge that the independence rule exists to prevent, for a component small enough to copy. If the host ships a segmented control, both copies retire together.

**Why not keep every evidence box open, but collapsed to one line?** Collapsed empty boxes still interleave with the criteria. They also imply that evidence may be written before the ruling.

**Why not extrapolate with a per-level or per-stage factor?** There is no calibrated factor. Any multiplier would be a new guess with a precise-looking number. A labelled floor is honest and still useful: the real cost is at least that much.

**Why not wrap the file list with a separator instead of one row per file?** Wrapped monospace breaks paths mid-segment and leaves no room for the per-file note, which is what the reader scans for.

## Consequences

- **Test counts.** eval has 1141 tests passing and datasets has 252. The estimate rule, the 5-item caps, the older-runs fold and the halted timeline dot each have a dedicated test.
- **Estimate wording.** An estimate can now read 「≥ 9 分钟」 with an explicit coverage line. It stays a floor until the missing items gain past answers, at which point it turns into 「≈」 by itself.
- **Buttons.** New buttons in either package must state a variant; a bare `<Button>` renders as text.
- **Shared-control changes.** Once datasets carries its copy, a change to `Seg` has to be made in both `parts.tsx` files.
- **Screenshots.** The paired screenshots (implementation vs v5, light / dark / 400) sit under the T83 scratch shots directory named in §十二 of the gap document.
