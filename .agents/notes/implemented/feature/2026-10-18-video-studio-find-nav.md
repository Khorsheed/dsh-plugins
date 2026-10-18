# Agent Note: video-studio — one sticky find bar with hit navigation owns text correction

Status: implemented

## Problem

The transcript tab's find/correct surface had four friction points, all reported from real use:

1. The find bar was a plain child of the `.body` scroller, so it scrolled away with the content — a long transcript lost the bar exactly when it was needed.
2. Two parallel correction paths had to be learned for one intent: the selection bubble's inline 改字 form (single fix) versus the find bar's replace-all, plus a 找同款 button that merely opened the find bar.
3. 「存进节目，以后自动改」 stored replacement rules into the show and silently applied them to every future transcript. It defaulted to checked, accumulated rules invisibly, and no settings surface ever listed them — silent cross-episode mutation with no management UI.
4. 「只看这些」 filtered the transcript to hit paragraphs, but the filter chip row only rendered in 原始 view — in 成片 view the filtering was invisible and could not be undone except by closing the find bar. Users could not tell what the button meant.

## Decision

The find bar is now the single correction surface, and it follows the Word model:

- **Sticky**: `position: sticky; top: 0` inside the `.body` scroller (the existing `.playerBar` pattern), so the bar stays on screen while the transcript scrolls.
- **Hit navigation**: a `3/12 处` current/total counter, ↑/↓ buttons (wrapping), Enter / Shift+Enter in either input, Esc or × closes. The current hit is highlighted solid (`data-hit-current` vs the soft `data-hit`) and scrolled into view with `block: 'center'`; when the hit's paragraph is beyond the 60-row paging window the window expands first (the follow feature's existing pattern). A `jumpedTo` key (`query | index | segment | start`) makes the jump run once per navigation and never on unrelated re-renders such as playback ticks.
- **One surface for corrections**: the selection bubble is a vertical menu (▶ 从这里播放 / ✂ 剪掉 / ↩ 恢复 / ✎ 改字…, dismissed by clicking anywhere outside) — vertical because horizontal space ran out and new actions now cost one row each. 改字… hands the selection to the find bar: query and replacement are both pre-filled with the selected text (replacement focused and selected, so typing overwrites), and the current hit is aimed at the exact occurrence that was selected, not the first in the episode.
- **替换当前 next to 全部替换**: the former calls the existing `fixText` on the current hit's range (no new remote verb); after the replace, the hit list recomputes and the index stays put, which lands on the next hit — Word's rhythm. 全部剪掉 is unchanged.
- **「只看这些」 and the `hits` filter variant are removed**; navigation replaces the use case.
- **「存进节目，以后自动改」 is removed end to end**: the checkbox, `ReplaceRequest.remember`, the remember branch of `service.replaceAll`, the `Settings.replacements` field and its default, the post-transcription `applyReplacements` call, the skill's sentence promising it, and the README mention. Old project/show files keep a now-dead `replacements` key that `normalizeSettings` ignores (it iterates `SETTING_KEYS`), so no migration is needed.

## Alternatives considered

- **Keep 只看这些 and also render the chip row in 成片 view**: rejected — an invisible filter was the bug, and hit navigation covers the review use case without a second list mode.
- **Keep the bubble's inline edit form as a third path**: rejected — two surfaces for one intent was the complaint; the find bar with a pre-aimed current hit is strictly more capable (it shows the other occurrences too).
- **Keep remembered replacements and add a settings editor for them**: rejected for now — silent cross-episode mutation needs a real management UI to be trustworthy, and per-episode replace-all covers the actual correction flow. Reintroduction requires the editor first.
- **Keep the horizontal toolbar bubble and squeeze more buttons in**: rejected in review — horizontal space is limited; the vertical menu extends by adding a row.

## Consequences

- `ReplaceRequest` loses `remember` — a wire change, safe because the package is 0.1.0 and unpublished.
- `Settings` loses `replacements` — a storage-format change with in-place tolerance: old files load and the dead key is ignored.
- `fixText` gains traffic from the find bar; user-originated single replaces apply immediately, exactly as the bubble's did.
- The skill no longer promises cross-episode auto-correction, so the model stops suggesting rules the user cannot see.

## Testing

`pnpm --filter @khorsheed/dsh-video-studio build` green (gen-typert + tsc + tsdown), package vitest suite green, `pnpm check:panels --package packages/video-studio` green.
