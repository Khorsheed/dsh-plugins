# Agent Note: the judge prompt's material fence adapts to its content, and the preview shows material as a slot (T85 A)

Status: implemented

## Problem

A user walking through T84 raised two defects in the judge prompt:

- **The preview's placeholder looked like prompt text.** The pre-run preview put 「（开跑后这里是选手提交的 X，经全 run 统一去指纹后原样放入）」 inside a ```` ```json ```` fence. A reader took it for what the real prompt says.
- **The fence could be closed early.** `buildJudgePrompt` wrapped each material file in a fixed ```` ``` ```` fence. A player's stage report that itself contains a ```` ``` ```` block closed the fence early, so everything after it reached the judge as prompt structure instead of material.

## Decision

- **Adaptive fence.** `materialFence` returns `max(3, longest backtick run in the material + 1)` backticks. `fencedMaterial` wraps one material file in it.
- **One template, two consumers.** `judgePromptSegments` (`packages/eval/src/judge.ts`) returns the prompt as segments: literal text, and a `material` slot for each file. `buildJudgePrompt` fills the slots with `fencedMaterial` and joins the segments. Nothing else builds the prompt text.
- **The preview returns segments.** `EvalJudgePromptPreviewView` now carries `segments` in place of `prompt` + `sections`. The page renders a slot as a dashed grey label, 「此处放入选手的 X 全文（去指纹后）」, after the file heading and outside any fence. Every text segment is the real prompt's bytes.
- **Tests.** `tests/judge.spec.ts` covers plain material, material holding ```` ``` ```` and material holding ```` ```` ````. The plain case is pinned to the sha recorded from the builder before this change.

## Alternatives considered

- **Keep the placeholder, change its wording.** Rejected. Any text inside the fence reads as prompt text.
- **A separate preview template in the client.** Rejected. Two templates drift apart. The segments keep one source.
- **Escape backticks inside the material.** Rejected. It changes the material the judge quotes as evidence. A longer fence leaves the material byte-identical.

## Consequences

- **promptSha.** For material with no run of three or more backticks the prompt is byte-identical, so earlier experiments' `promptSha` is unchanged. For material that contains ```` ``` ```` or longer runs, the fence is longer, so **the prompt and its `promptSha` change**. A re-judge of such a cell after this change is not byte-comparable to the earlier sample.
- **Remote shape.** `judgePromptPreview` no longer returns `prompt` / `sections`. The only consumer is the eval client in the same package.
