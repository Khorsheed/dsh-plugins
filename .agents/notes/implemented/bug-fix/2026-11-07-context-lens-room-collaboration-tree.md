# Agent Note: Context Lens attributes a room round to its whole collaboration tree

Status: implemented

## Problem

Room round 114 in a real session showed only the directly addressed member even though that member delegated work to another agent and later resumed with its report. The room journal recorded all three executions and their links. Context Lens created rounds only from human dispatches and attached only runs whose dispatch seq equaled the human root's seq. Nested coordinator and report dispatches neither joined the root round nor received their own numbered rounds, so their requests and decisions disappeared from the room-dimension view. Naively adding those runs to the existing scope map would also overwrite earlier executions of the same member and could double-count requests.

## Decision

- A human dispatch still defines one numbered room round. Non-human dispatches contribute topology, not additional round numbers: `parent` and run-resolving `reportFor` edges connect descendant work, while `releases` connects through the held dispatch's `reportFor`. Traversal is record-driven, cycle-safe, and never falls back to time proximity. Unresolvable external markers such as cross-room help ids are not forced into the tree.
- Round construction shares one collaboration-tree walk with decision attribution. Legacy logs without links reduce to the existing direct-run behavior, and unrecorded rounds keep their fallback rather than inventing request ownership.
- Scopes merge repeated executions of the same child: requests are chronologically ordered and deduplicated, compactions are claimed once, and usage is summed once. Multiple execution facts remain available through the additive `executions` field; the existing singular `execution` field remains for single-execution compatibility.
- The UI keeps one tab per member and renders every recorded execution note. Ordinary tool-call subagent attribution is unchanged.

## Alternatives considered

**Give every coordinator or report dispatch its own numbered round.** This would expose some missing work but split one user-visible collaboration into implementation details, renumber every later human round, and still fail the expectation that the root round shows all participants.

**Attach only the immediate child delegation.** That fixes the two-tab screenshot but drops the report-driven resumption and its requests. The tree must include both `parent` and `reportFor`, with `releases` preserving the held-report path.

**Keep one scope per execution.** Duplicate member tabs would complicate aggregation and request navigation. Merging by child scope preserves one participant view, provided requests and execution facts are both deduplicated and lossless.

**Infer descendants from elapsed time.** Rejected for the same reason as the earlier execution-record decision: concurrent and long-running members cannot be attributed honestly without following the journal's explicit links.

## Consequences

The root round now contains the complete recorded collaboration, including nested decisions and compactions, without changing subsequent human ordinals or duplicating token totals. Repeated member executions no longer overwrite one another. Older logs and runs without explicit links behave exactly as before; work outside a resolvable run tree remains unassigned rather than being guessed into a round.

## Testing

Regression coverage drives human → A → B → report A with execution-backed child logs, checks both member tabs, repeated A executions, nested decisions, request/token deduplication, and unchanged human ordinals. A second case pins held-report releases, cycle termination, and rejection of unrelated help markers. The original room log is replayed read-only to verify round 114 and the following human round.

## Related

- [Context Lens room rounds](../feature/2026-10-24-context-lens-room-rounds.md) — the human-rooted round model this change retains.
- [Context Lens reads execution records](../simplification/2026-11-05-context-lens-reads-execution-records.md) — the record-driven ownership rule extended here from direct runs to their collaboration tree.
