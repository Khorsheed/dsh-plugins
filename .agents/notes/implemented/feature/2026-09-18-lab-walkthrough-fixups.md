# Agent Note: the walkthrough's ten — colours that never reached their tokens, a column that was clipped, and reasons that were never said

Status: implemented

English | [中文](2026-09-18-lab-walkthrough-fixups.zh.md)

## Problem

T67 rebuilt the lab tab into four stages and the coordinator walked every page of it in light and dark on a throwaway instance. The structure held — all fourteen rows of the delivery table checked out on real data — and what was left was ten presentation defects, of which three are the interesting ones.

**The five tones were chosen correctly and painted wrongly.** Every call site asked for `ok` or `busy` exactly as ui-spec §九 says, and `.chipTag[data-tone='ok']` was `--dsw-alias-state-business-primary` — the BRAND blue — while `busy` was `--dsw-alias-label-primary`, the body text colour. So a finished run rendered blue and a running one grey, which is the one pair §九 is most specific about. No test could have caught it: a chip's colour is a token in a stylesheet, and jsdom neither loads stylesheets nor computes styles.

**The bench's second answer was half off the screen.** `.judgeColumns` was a three-column grid from when the queue, the material and the criteria were three panes. T67 moved the criteria inside each answer and the third column stayed in the template, holding a share of the width for nothing: the answers got 509 px of an 1134 px page, two columns of 358 px, and macOS does not draw the horizontal scrollbar that would have hinted at the rest.

**A readiness badge said 「✓ 环境就绪」 over an experiment whose two players did not exist.** The badge counted the readiness RECORDS, which only cover what a run actually probed; a group nothing ever resolved was not a red cross but an absence, and an absence counted as nothing. The comparison-group table had the same shape of bug from the other side — it filtered the registry to the plan's ids, so an id with no registry row was silently dropped.

## Decision

**W3 — the tones.** `ok` → `--dsw-alias-state-success-primary`, `busy` → `--dsw-alias-state-business-primary`, in BOTH tabs' hand-kept copies of the chip. And a new `tests/tones.spec.ts` that reads the two stylesheets: it asserts each tone draws from its own token family, names the two specific mistakes so they cannot come back, and pins that `neutral` takes no state token at all (a tone rule for 「未开始」 would be the opposite of grey).

**W8 / W9 — the bench.** Two columns in the template, `flex: 1 1 320px` with a 320 px floor per answer. And each answer's material is FOLDED, criteria on top: thousands of lines of stage json above the scoring boxes meant two columns never showed their forms at one scroll position, which is the one thing side by side exists to give. The summary still carries the file and how many fingerprints were scrubbed, so a grader sees the redaction ran without opening anything.

**W12 / W15 — the badge and the crosses.** The badge walks the PLAN's own subject list (players then judges) and resolves each one in order: a readiness record if the run probed it, else the review's row, else 「缺失」. A subject can no longer leave the denominator. The table renders a row for every `only` id the registry does not carry — not pickable, not provisionable, dashes and one word — because an experiment naming a subject nobody has is a fact about the experiment, not a gap in a table. And every cross now says WHY, read from the review's structure (status, lock present, lock matching, home hashed); only the unresolved endpoint has no structural field, so that one is found by the `condition <id>: ` prefix validate itself writes. Nothing parses a sentence for its meaning.

**W11 — the plan that is gone.** `PLAN_UNREADABLE` is pulled out of the check list and rendered through the three-part seat, so the page says 「计划文件不在了」 and what to do, with `cannot read plan file: /Users/…` folded under 详情. The shared `ErrorState` grew one optional `fix` key, used only when the classifier does not recognize the cause — both copies took the same change, so the two tabs still hold one implementation.

**W4 / W5 / W7 — the numbers that were not numbers.** 「在态时长」 prints an em dash on a terminal state: the ledger measures from the last transition to now, which on a finished cell is how long ago the RUN ended. The timeline's equal-length grey bars turned out to be the stage chip itself — a grid item, and grid items stretch — so the chip keeps its own width now and a real bar sits beside it, scaled against the longest segment of that same record. The score column is 「判定」, because a column headed 「得分」 whose cells read 「终评」 names the score after the grader.

**W6 / W13 / W14 — the last internal words.** `finalize` → 「终评收口」; `rep` → 「次数」; 「保存草稿并 validate」 → 「…并校验」; 「逐 rep Δ」 → 「逐次 Δ」. The wizard's budget defaults to the plan template's 30 minutes, and step ③ stops telling a person to fill in a step that has nothing to fill.

**W10 — the merged page.** Five strings still sent people to 「计划审阅」, which is part of 实验设计 now.

## Consequences

- `packages/eval` 850 → 860 tests (one new spec file), `packages/datasets` 214; both suites, both typechecks and the gate green.
- Two client specs changed their EXPECTED numbers rather than their assertions, and both changes are the fix: the readiness badge now counts three subjects where it counted one, and `LabReview`'s provision tests wait for «one or more» of a group id that legitimately appears three times on a settled page.
- `ErrorState` gained one optional prop in both packages. It is deliberately narrow — it applies only on the `unknown` branch, so a recognized cause still wins, because the classifier knows more about `ENOENT` than any caller does.
- **Left alone, as the brief says**: validate's English warning sentences (T66, host side), the `capabilities.source` lock warning (T65 rev12 removes it), and the stale 「运行中 0/1」 rows (the coarse edge the README documents).
- **One thing I could not reproduce from the code**: W13 reports 「rep / 预算无缺省，下一步一直灰」. All three fields have had defaults since T67 (`1` / `60` / `10`), and the only way step ③ cannot be left is a dataset set that declares no stage schemas. I aligned the budget default to the brief's 30 minutes and stopped the generic 「这一步填完才能往下走」 from appearing under a step with nothing to fill — but if the screenshot shows empty boxes rather than an unpickable stage list, the real cause is still open.

## Testing

`pnpm test` and `tsc -b --noEmit` in both packages, then `pnpm gate`. `tests/tones.spec.ts` is the one that matters most: it would have failed on the code this pass fixes, in both packages, which is the property a regression test has to have. The client specs pin the badge counting the plan's subjects rather than the probes, a cross carrying its reason, an absent subject being a row with no buttons, the plan-gone seat folding the host sentence away, a terminal record showing no elapsing time, and each answer's material being inside a `<details>`.

## Alternatives considered

### Why read the stylesheet in a test rather than assert a computed colour?

Because there is nothing to compute. jsdom does not load CSS modules and `getComputedStyle` returns the declared cascade, not the token's value — asserting a colour would need a real browser, which this suite is not and should not become for one rule. Reading the source is narrower than it looks: it checks the mapping the rule is ABOUT (tone → token family), not a hex value, so the theme can restyle green whenever it likes and the test still holds.

### Why does the badge trust the review over the registry listing?

They answer different questions. The review is `validatePlan`'s own output about THIS plan's subjects; the registry is a listing of what the repository declares. When they disagree the review is the one that was asked about readiness, so it wins, and the registry's silence only decides whether the table can draw a row. Making the badge also penalise a subject the listing omits would have coupled two payloads and produced a red cross over a group the review had just resolved.

### Why fold the material instead of giving each column its own scrollbar?

An inner scroll region would keep the criteria visible, but it also hides that there is more material and puts a second scrollbar inside a page that already scrolls in the host's container — and on the walkthrough's own evidence macOS draws neither of them until you touch it. A disclosure says how much there is (the file name and the redaction count stay on the summary) and puts the grader in charge of when to spend the screen on it.
