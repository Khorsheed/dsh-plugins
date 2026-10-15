# Agent Note: Library — tool-call resilience: teaching refusals for missing `what`, minted-id discipline, toc as text, slimmed descriptions

Status: implemented

## Problem

Two live sessions (different models) showed the same tool-call failure cluster: (1) a `library_write` without `what` hit the host's bare schema rejection ("missing required property what") which teaches nothing; (2) the model invented semantic ids (`p_math`, `b_prob_lifesaver_2020`) for edit targets — one refusal text ("no project p_math") invited the wrong conclusion "then create it"; (3) `acceptance` was attached to quiz stations twice in a row — the refusal named the rule but not the outlet (the pedagogical checklist belongs in `goals`); (4) a long nested payload came out as invalid JSON (`MALFORMED_RESPONSE`, the whole turn aborted); (5) under failure pressure the model finally emitted the tool call as plain reply text. Meanwhile the write tool's description had grown into a ~2600-char wall that diluted attention (the user's own review: shapes belong with the fields, discipline in the prompt).

## Decision

- **`what` optional in schema, required in execute**: `library_read` / `library_write` drop `required: true`; a missing or unknown `what` throws the teaching error with the valid list and an example call, instead of the host's unteaching rejection.
- **Minted-id refusals teach**: `updateProject` ("no project p_math") and `putBook` now say ids are minted, `library_read · projects / books` lists them, and omitting the id creates.
- **The acceptance refusal names the outlet**: "…acceptance belongs to kind: practice only; for a quiz / read station, write the completion expectations into goals: [...] instead".
- **The most-mangled payload flattens**: `what=book` accepts `toc` as one newline-joined string (rows are plain titles) beside the object/string-array forms.
- **Descriptions slimmed**: `library_write`'s description keeps one behavioral line per `what`; every payload shape moved into its parameter's own description (the model reads it where it writes). The prompt keeps the discipline, the parameters keep the shapes — no duplication.
- **Prompt gains two sentences**: change only what a refusal names and resend the same payload (rewrite-regression was the observed spiral); a tool call is a function call, never text in the reply.

## Alternatives considered

- **Name-based project/book resolution** (treat "数学" as the id): rejected — fuzzy identity invites silent wrong-target writes; teaching the minted ids keeps the contract exact.
- **A line-DSL for roadmap nodes** (`id | kind | title | covers`): rejected for now — sugar multiplies the grammar; the JSON-text transport and the newline toc cover the observed malformation sites.
- **Accepting acceptance on quiz nodes** as informational milestones: rejected — it would blur the practice-station gate; redirecting to `goals` preserves both meanings.

## Consequences

- Every observed refusal now names its fix; the fatal modes left (invalid JSON emission, text-form tool calls) are model-side, with payload flattening shrinking the biggest trigger.
- No state or API shape changes; existing data untouched.

## Testing

`tool.spec.ts` (+2): missing `what` teaches on both tools; a newline-joined `toc` registers with blank lines dropped. `service.spec.ts` (extended): the acceptance refusal also points at `goals`. Full suite green.
