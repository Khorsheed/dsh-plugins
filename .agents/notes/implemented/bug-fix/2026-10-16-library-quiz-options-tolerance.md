# Agent Note: Library — choice options tolerate the { label } / letter-keyed forms (the invisible-options bug)

Status: implemented

## Problem

A live 3080 session (【新建数学项目并添加微积分读本】) stored a quiz whose choice questions showed the learner a bare prompt and no options. The model had written `options: [{ label: "A) …" }, …]` — an array of label objects. `normalizeQuiz` kept only string entries and silently dropped them all; the write-side check passed because the answer carried a letter prefix (`A) …`), which `choiceOptionIndex` maps by letter without ever reading the options. Silent drop + letter shortcut = a stored quiz that can never be answered.

## Decision

`normalizeQuizOptions` (store.ts, exported) converts every observed form to plain strings — string arrays verbatim, `{ label }` objects by their label, letter-keyed maps by their values — stripping a leading letter marker (`A) `) since the answering UI badges letters itself. It is used at both ends: the tool's quiz case normalizes before `putQuiz` (so validation sees real strings), and `normalizeQuiz` reads through it (so the already-stored broken quiz heals on read). The `questions` parameter's schema lists the label form as a second branch (`oneOf [string, { label }]`) so the DSL's own validation admits what the tolerance accepts.

## Alternatives considered

- **Refuse non-string options at write time**: rejected — the letter-prefixed answer would still have slipped past content matching, and the already-stored quiz would stay broken.
- **Strip letter prefixes from plain string options too**: rejected — those strings are the coach's authored text and the answer may match them verbatim.

## Consequences

- Quizzes authored with the label / letter-keyed option forms now store clean strings and render; the already-stored broken quiz heals on its next read (normalization runs on the read path).
- `choiceOptionIndex` keeps its letter shortcut — harmless now that options are normalized before it runs.

## Testing

`store.spec.ts` (+1): strings / label objects / letter-keyed maps / undefined / a bad entry. `tool.spec.ts` (+1): a `{ label }` choice question stores clean string options. Full suite green.
