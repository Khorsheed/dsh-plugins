# Agent Note: eval — the session face: an experiment card on the tool row, `eval_experiment_get`, and the tab-count verdict (T76 · D3)

Status: implemented

## Problem

When an agent drafted an experiment in a session, the session kept only a generic tool row: the tool name, a JSON blob, and two absolute paths (`planPath` / `conditionPaths`). To learn what was drafted and where it stood, the person had to switch to the Experiments tab and search for it. The agent's side was just as fragmented. Reading one experiment in full took three reads: `eval_cells` without a run id to find it, `eval_run_status` for the status word, then `eval_cells` with the run id for the cells. And when the analysis needed to cite a particular answer, no tool reported a file name, so the agent had to ask the person for a path.

## Decision

- **The experiment card**: the `eval_plan_draft` tool row mounts the host's keyed slot `tool.call.toolview` with key `eval_plan_draft` (`packages/eval/src/client/DraftCard.tsx`; the data half is `draft-card.ts`).
  - The card shows the name, the question verbatim (rev14, shown only when present), the scale, the dataset version (`<registration>/<set> @ short hash`), and the status.
  - The data comes from the call's own block: the settled block's `EvalDraftResult` first, the arguments as fallback. The only live field is the status, read once on mount from the matching `remote.runs` row. When that read fails it shows 草稿 (draft), the state the draft verb itself leaves.
  - The two absolute paths never enter `DraftCardModel`, so nothing downstream can show them.
  - There are four states: running (no result yet), failed (`isError`), unreadable (the result names no experimentId), and ready.
- **One action, 打开实验 (Open experiment), and no approve button** (R1).
  - The host has no tab-switch interface: `dsh.conversation`'s `openView` is injected into the conversation frame and the tab header only, and a tool row can reach neither. So the action falls back, per T72's finding. A plugin-level `LabFocus` channel (`createLabFocus`) records the request per session, and the lab view takes it on mount or when a request arrives.
  - On taking it, the lab view returns to the list and re-reads it, then marks the row (`data-marked`, a primary-colour bar on the left, `scrollIntoView`). If the row is outside the "this session" scope, it switches to 全部 (all) without writing the scope preference: that is the person's choice, and one mark should not overwrite it.
  - The card then says "The row is marked in the 实验室 tab's list — switch to that tab to see it".
- **Structural registration, no dependency**: `@deepseek-ai/dsh-client-ui-tool` declares the slot, but this package does not depend on it and it is not in the pnpm store.
  - Registration casts `ctx.slots` structurally and calls `slots.inject('tool.call.toolview', () => slots.register(...))`, following the cross-package slot registration convention.
  - `dsh.client.inject` names `@deepseek-ai/dsh-client-ui-tool`.
  - In a composition without that package, the row stays the host's generic one.
  - The card does not self-hide on the preset: the row exists only because the session was granted `eval_plan_draft`.
- **`eval_experiment_get({experiment})`** (`packages/eval/src/experiment-get.ts`, service method `experimentGet`).
  - Lookup: it finds the experiment by experimentId, list-row id, or run id, and throws `EvalReadRefused` when none matches.
  - It returns:
    - the list row, minus the plan path;
    - every run id;
    - the newest run's digest, from the same source as `eval_run_status`;
    - the bucket counts;
    - an answer index: one entry per task × group × rep with its stage, bucket, checkpoints, annotation counts, the player's child session, and the file names that attempt registered. Names are relative to the attempt directory; an absolute ledger path is reduced to a relative name or its basename;
    - the names of the files already in `analysis/`.
  - Every field is one the lab page already shows, so the numbers agree with the page by construction, not by a second computation.
  - It is read-only: no run, no finalize, no provision, and nothing that touches the human-review exits.
  - eval-tool registers it, and the eval-tool README tier table is updated.
- **Tab count: infeasible, so nothing is shown.**
  - A `conversation.view` `SlotLabel` is re-read only in ui-conversation's `refreshViews`, which runs only on slot subscription or a locale change. Even a label function that reads live state does not redraw with it.
  - The other route, rewriting the label through a DOM anchor, breaks the "DOM anchors are a last resort, with a fallback" convention, and the tab node is not a public contract.
- **The S18 fallback**: progress does not flow back into the session — no chip, no notification. An agent that needs progress reads `eval_run_status` / `eval_experiment_get`. Three candidates were examined on rc.1; they are recorded here and not wired:
  - `Session.append` has no "ignored by the model" option, so the model reads every entry written there;
  - `agent.inject` is model-facing by design, so using it for progress would mean sending the agent a message on the person's behalf;
  - `shell.overlay` is root-scoped rather than per-session, so session progress shown there would leak into other sessions.
- **Fixture-based acceptance**: a real card needs a real `eval_plan_draft` call, which needs a provider, and the rules say not to configure one or copy credentials. So client tests cover the card (`tests/DraftCard.client.spec.tsx`, `tests/apply.client.spec.ts`). For the screenshots, a temp instance renders the same component fed a fixture block. The block has the real result's shape, with paths under `/home/user/...`.

## Alternatives considered

- **Open the experiment's detail directly inside the hidden tab**: when a request arrives, the lab view would go straight to the design page, so the person lands there on switching. Rejected. A tab the person cannot see would change pages silently and replace whatever they were looking at. It would also put the design page, one step from the approve button, out of the person's sight. Marking the list row changes one visual; clicking into it stays the person's own act.
- **Write the count onto the label through a DOM anchor**: rejected, for the reasons above. The label node's structure is not a public contract, and one host change would break it silently.
- **Depend on `@deepseek-ai/dsh-client-ui-tool` for the `ToolCallOwnerProps` type**: rejected. It is not in the store. Adding it as a dependency would tie eval to ui-tool's version line when the card reads only six fields of the block. The structural subset (`DraftToolBlock`) names exactly those fields, and the tests catch a host shape change first.
- **Have the card call `eval_experiment_get` itself**: rejected. The card needs one live field, the status, and reading the list row is the cheapest way to get it from the same source as the lab list.

## Consequences

- `LabViewInjected` gains an optional `focus` field; tests that hand-write the lab inject face are unaffected.
- The card mounts on a slot declared by `@deepseek-ai/dsh-client-ui-tool`. If the host changes `ToolCallBlock`'s shape, the card falls to unreadable and says "The result of this call names no experiment". It does not crash.
- The model tools go from six to seven (five reads, a draft, an analysis door). The eval-tool prompt section and both READMEs are updated; the coordinator writes the matching UI-spec §六 sentences back.
- If the host ever offers a tab-switch interface, 打开实验 can go straight to the design page and the `LabFocus` channel retires.
