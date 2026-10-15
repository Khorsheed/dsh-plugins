# Agent Note: Library — library_write goes flat: top-level fields instead of wrapper payloads

Status: implemented

## Problem

A third live session (【新建数学项目并规划学习路线】) failed a dozen times in a row on one verb. The dominant pattern was not wrong values but a wrong ENVELOPE: the model put the whole book payload at the args top level, or sent `project + what` with no payload field at all (six times), or poured prose into the id slot. The three-tool design asked the model to (a) pick `what`, (b) wrap a complex object in the matching named field (`book: {…}`), (c) get every nested field right — three compounding chances to fail. The host's own tools (e.g. `read_skill_file`) use flat typed parameters with per-field descriptions and a `required` array; models are trained on that shape.

## Decision

`library_write` parameters are now FLAT top-level fields — `title`, `bookKind`, `toc`, `tocSource`, `nodes`, `passRatio`, `note`, `node`, `text`, `attachment`, `label`, `marks`, `cards`, `focus`, `questions`, `op`, `url`, `kind`, `addedBy`, `resourceId`, `name`, `template`, `goal`, `bookId` — each typed and documented where the model writes it (the reference-tool style). `project` / `book` become pure scope selectors (id, `null` for the project path). The nested wrapper form (`book: {…}`, `roadmap: { nodes }`, …) keeps working as an undocumented legacy form: the parameter root is an open object, so the old slots reach execute, which merges flat-over-nested. Teaching refusals now name the missing flat fields explicitly (`got title ✗ MISSING · toc ✗ MISSING`). `library_read` was already flat; `library_assess` already carried a structured verdicts schema — both unchanged.

## Alternatives considered

- **Splitting into ~10 single-verb tools** (`library_add_book`, `library_draft_roadmap`, …): the purest match to the reference style, but breaks the three-verb mental model the prompt, the playbooks, and in-flight sessions all carry, for the same schema-level win the flat parameters already deliver.
- **Strict object schemas per payload** (`book: { type: 'object', properties… }`): rejected — a malformed value would meet the host's unteaching schema rejection again, and the JSON-text transport (which big-payload models fall back to) would no longer validate.
- **Dropping the nested fallback**: rejected — every in-flight session's context still shows the wrapper form.

## Consequences

- The model fills named slots instead of constructing wrapper objects; the observed "missing payload field" failure class disappears structurally.
- `toc` keeps the newline-string form; `nodes` / `questions` / `cards` / `marks` stay `json`-typed (host passes them through, execute tolerates JSON text).
- The two journeys' behaviors, the state, and the service API are all unchanged — this is a wire-shape change only.

## Testing

`tool.spec.ts`: all pre-existing nested-form calls keep passing through the legacy merge; a new `flat top-level fields` describe (+2) walks project → book → roadmap → notes → resource end-to-end without a wrapper, and pins the observed failure modes (no payload fields at all; prose in the id slot) to their teaching messages. 119/119 green.
