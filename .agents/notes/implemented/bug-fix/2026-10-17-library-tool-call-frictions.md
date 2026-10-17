# Agent Note: Library — batch teaching errors, the { items } list wrapper, and minted-id tolerance (from a live session's call ledger)

Status: implemented

## Problem

A live onboarding session (「新建数学项目并制定学习路线」, 2026-10-16) completed, but 8 of its 13 `library_*` calls were failed retries:

- `library_roadmap` needed **six** attempts. `validateRoadmapShape` returned on the FIRST shape error, so each retry resend of the ~10-node payload met the next error (acceptance on a read node ×3 nodes, depends-on-read ×3, acceptance on a quiz node ×1). The model understood every message — the cost was purely one-error-per-round-trip.
- `library_book`'s `toc` arrived as `{ items: [{ part, title }] }` — a wrapped object matching no oneOf branch — and the harness's schema gate rejected it with "must match exactly one oneOf branch (matched 0)" BEFORE the tool's own teaching error (`arrival()`) could run. The retry fell back to a newline string and **dropped the part groupings** the model had authored (the structured branch supports `part`).
- `library_project { id: "math", … }` and `library_binding { book: "calculus_lifesaver_2010", … }`: the model invents slug ids. Note the asymmetry — `library_book`'s edit param (`bookId`) was used correctly, while the bare name `id` read as "assign one".

## Decision

- **Batch teaching errors** (service.ts): `validateRoadmapShape`, `putQuiz`'s per-question gate and `writeCards`' per-card checks collect EVERY problem and refuse once — single-problem messages stay byte-identical, a multi-problem refusal is a header (`N shape errors — fix them all, then resend:`) plus the bulleted per-item messages (texts unchanged). Cascade-prone follow-ups are guarded, not stacked (an invalid `target` skips its focus/cardIds checks; a missing `ranges` array is its own error, not a crash).
- **The `{ items: [...] }` list wrapper is accepted** (tool-definition.ts): `payloadList` unwraps it, and every list parameter (`toc`, `extras`, `nodes`, `questions`, `marks`, `cards`) carries a matching `LIST_WRAPPER_SCHEMA` oneOf branch so the shape passes schema validation into execute — where a genuinely wrong object now earns the tool's own `arrival()` teaching error instead of the opaque oneOf refusal.
- **`library_project`'s edit param is `projectId`** (aligned with `library_book`'s `bookId`; `id` stays readable off the typed surface for models that memorized it), with the description stating ids are minted and never caller-chosen. An unknown id WITH a name is a create in disguise: create and return `note` saying so (the repo's degrade-don't-explode convention); unknown id WITHOUT a name keeps the not-found teaching error.
- **`setBinding`'s unknown-book refusal teaches the order**: book ids are minted, and registering the book binds the session itself — the pre-registration `library_binding` call the model attempted is never needed.

## Alternatives considered

- **Auto-fix over teach** (silently move `acceptance` to `goals` on non-practice nodes, drop read-node deps): rejected — acceptance lines are judged verbatim at assess time while goals are prose; silently refiling the model's intent stores data it did not mean, and teaches nothing. Batching keeps the teaching at a fifth of the round trips.
- **Caller-chosen ids** (honor `id: "math"`): rejected — ids anchor the event ledger and every foreign key (covers, bindings, quiz scopes); "never chosen by the caller" is what makes them stable.
- **Fix the oneOf message in the harness** (name the branches in the rejection): the right layer for the message, but upstream — tracked separately; the wrapper branch fixes the immediate shape class here regardless.
- **Schema-only `type: 'json'`** for the big payloads: rejected — the detailed schemas demonstrably guide composition (the session's nodes were shape-valid on the first try; its failures were semantic).

## Consequences

- Error TEXT is unchanged for single-problem payloads; multi-problem payloads get a header plus the same per-item lines. Any harness matching exact messages on multi-error payloads would notice — none exists (tests match substrings).
- The six list schemas grew one permissive branch; genuinely wrong objects now reach execute and get the better error.
- Evidence base: one session. The fail-fast fix is structural (its cost model does not depend on the session), the wrapper and slug fixes target shapes observed once each — worth re-auditing after a few more live runs.

## Testing

`tool.spec.ts` (+4): `projectId` edits (with `id` as silent alias), an unknown-id-with-name create returns the note, an `{ items: … }`-wrapped toc registers with parts intact, a three-problem draft earns one refusal listing all three, a multi-bad-question quiz likewise. The pre-existing single-error tests pin the unchanged per-item texts. `pnpm --filter @khorsheed/dsh-library build && test` green.
