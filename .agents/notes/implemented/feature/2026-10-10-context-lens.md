# Agent Note: Context Lens request and timing workbench

Status: implemented

## Problem

The request inspector exposed captured data but made cache regressions, repeated prompt content and expensive tool interactions difficult to compare. The approved prototype also revealed inconsistent duration rounding and mixed parent/child totals.

## Decision

The package, directory, bundle row and sidebar kind are renamed to `context-lens` (`@khorsheed/dsh-context-lens`). The `requestInspector` service and Remote namespace remain stable for scoped-read consumers. This is an installation identity change: an existing deployment must replace the old direct dependency and bundle row; mounting both packages would register the same service twice. This change does not publish to npm.

The retained visual style uses bordered metric cells, mono numbers and the prototype's timing palette. A turn stepper and latest button synchronize the conversation scroll. A horizontally scrollable, draggable session map follows the selected agent and shows only its retained requests, with a scale computed from that agent; the redundant visible agent/count and height/color explanation above the chart are removed; `getSessionTrend(sessionId, filter)` returns only request headers and inherits scope filtering, retention and generation metadata.

Request detail is ordered as measured cache usage, this exchange (new input beside captured output), then context composition. Full-text duplicates of at least 40 characters can be filtered. Message rows expose explicit tool errors and the originating session-event turn where known. Long output and reasoning show bounded previews and remain scroll-bounded when opened; argument values expand independently.

The request list uses compact two-line rows: action/cache percentage, then input → output and duration. Four metric cells separate values, units and supporting facts. The request header's `{ }` toggle replaces only the lower detail with JSON; the request list and metrics stay available. The bottom toolbar and its unsupported wire-body placeholder are removed; measurement semantics move to the composition info tooltip and partial-backfill status sits by turn navigation.

Composition is one bordered stack: category bar, compact percentage legend, then system/tools/history/added layers with proportional bars and original counts. Category and duplicate filters are exclusive and affect detail rows only. Selecting a filter opens matching layers; repeated rows keep wire order and show ×N. Exact full-text matches of at least 40 characters count only excess copies after the first, including duplicates crossing layers. Default added rows remain expanded. Exchange cards show previews immediately; reasoning and argument values expand independently without stretching the panel horizontally.

Prefix comparison uses exact retained segment content in the same scope, including across turns. Appending messages preserves the prefix; replacement/removal or tool-schema changes remain visible. Prefix differences describe assembly facts, not a claim about the provider's cache invalidation cause. Without a retained predecessor the UI calls this a comparison baseline, explicitly scoped to retained records rather than claiming the actual first-ever request. Cache usage remains an independent provider fact. Text differences use full segment text, trim shared leading/trailing content, and highlight the bounded replacement span with a character offset and old/new lengths. Previews keep 48 context characters on each side and at most 160 changed characters per side, with explicit omissions; Unicode characters remain intact.

Timing cards and both tables describe one selected agent. All agents stay visible on separate clickable timeline lanes. Model-internal residuals and between-request gaps are separate. Tool reasoning is allocated equally among calls from that request, parameter time follows its tool lane, and execution errors use explicit `isError`. Concurrent intervals share elapsed time across active spans, with an explanatory note, keeping cards and tables additive. All duration labels retain tenths of a second.

Each request carries its captured provider/model, reasoning effort, output limit and temperature. Request detail displays a compact configuration strip above metrics. Request headers also carry that per-request snapshot, so the timing page can display consecutive configuration runs for the selected agent and turn, with request links. A → B → A stays three runs. Missing historical fields say not recorded; scope-level configuration is never substituted for a request or interpreted as a provider default.

Request labels use a separate optional `requestNumber`: a 1-based cumulative ordinal within each agent, continuous across turns. Internal `seq` remains the process-local query/selection ID, including in raw JSON. Complete logs assign ordinals in event order before newest-first retention; incremental child folds continue their own count, including failed attempts. Live capture starts at 1 only when turn 1 was observed, otherwise a complete log anchors a fully observed turn. That numbering reconciliation may re-read a completed backfill while a live turn still lacks its first durable response. Retaining fewer turns never rebases known numbers. Unanchored partial histories and auxiliary requests show an unknown number rather than a fabricated first request. List/detail, trend, cache predecessor, exchange provenance and timing/config links all use the display ordinal while callbacks retain query IDs.

Tool execution results are attached to response calls by exact call ID, in both live capture and main/child log reconstruction. Same-name parallel calls keep distinct outcomes; an incremental child result updates the already retained call. Request details expose execution status and full captured result text independently of model-request success. Failed calls show a three-line error preview with bounded full expansion; success bodies start collapsed, while running, unrecorded, missing-body and empty results remain distinct. The list says tool failures rather than generic errors. Input tool-result cards name the issuing request only when its exact call ID resolves within the retained agent history. Result bodies consume the existing retention budget (including late arrivals), but never alter input composition, tokens or duplicate accounting. Existing live-capture priority under memory pressure remains unchanged.

Tool additions require an observed preceding request in the same agent scope. An absent baseline shows the tool inventory without addition badges; an observed empty tool set still allows real additions. Trend bars keep token-scaled heights inside full-height hit columns (16px wide for a pointer, 40px for touch), with visible hover, selection and keyboard focus. Enlarging the hit column instead of the data bar preserves the measurement while making short and unknown-usage requests selectable.

Response summaries count repeated calls by exact tool name, in first-occurrence order: `skill ×2`, or `skill ×2 · read` for mixed tools. All live, settled-log and failed-attempt paths supply these counts. Single calls retain their argument hint; older summaries without name counts retain the honest `+N` fallback. Text responses without tool calls are labeled “Assistant reply”, without implying no reasoning or earlier tool use.

Composition disclosure rows use 16px host-style SVG chevrons and whole-row hit targets. Tool definitions form a compact aligned inventory without search; inline expansion shows descriptions and parameter names/types/required flags, preserving nested constraints and exposing the exact original parameter JSON. Nested objects, arrays, alternatives and constraints render recursively as labeled fields; oneOf/anyOf/allOf retain their distinct semantics. Required badges replace required-name lists for declared properties; undeclared required names remain explicit. There is no redundant full-constraints disclosure or JSON block in the structured view. Unknown keywords retain a labeled value tree, references remain explicit, and deep or unreadable definitions point to the original JSON toggle without inventing counts. History and added messages retain one-line collapsed summaries. Expanded prose uses the panel body font; JSON and call arguments stay monospace. Composition bodies share the request-detail scrollport, with sticky message controls for collapse and advancing to the next visible row (respecting filters). Advancing closes the current body and moves keyboard focus to the next header. The composition border clips paint without creating a scroll container, so sticky headers follow the actual reader.

## Alternatives considered

**Separate readers, spacious excerpts, tool search, or nested scrolling.** The reviewed prototypes made users navigate too often or made long histories too sparse. One-line summaries and compact inline reading preserve scan density; sticky next/collapse controls keep long content navigable without another viewport.

**Another visual redesign.** Rejected by the user after reviewing the prototype; retain the earlier visual direction.

**Model-generated findings or host changes.** The user requested observable data only and no upstream changes. Exact comparisons and provider usage meet that scope.

**Summing parent and child timing.** Delegation already includes child execution, so that would count the same time twice. Agent-specific accounting preserves the distinction.

**Guessing errors from tool prose.** Error totals consume the host flag; Canvas fixes its own declared failures through the host's thrown-error path instead.

**Keeping the footer or filtering a copied request object.** The footer contradicted the approved prototype; rewriting segments for filtering also changed denominators and hid original group sizes. A request-local toggle and row-only filter preserve both navigation and measurement meaning.

**A single mixed-agent trend or scope-level configuration.** Both imply continuity where independent contexts or per-request settings differ. Agent selection filters the trend and exact request snapshots preserve configuration switches.

**Comparing truncated message openings.** Equal openings hide later changes and whole-line colors hide the actual edit. Full-text comparison with bounded, highlighted context stays readable without transmitting another entire request.

**Displaying insertion IDs, turn/step numbers, or retained-list indices as request ordinals.** Insertion IDs depend on query order and newest-first backfill; turns contain multiple calls and retries need not have distinct steps; retained indices change after eviction. A separately anchored ordinal preserves chronology without changing query addresses.

## Consequences

The new installation identity requires migration before production replacement. Old saved sidebar kinds may show the host's unavailable fallback. Capture is still pull-based and bounded by the existing retention budget; uncaptured or evicted data is not invented. A prefix preview is short, while the full request remains expandable.

Regression coverage pins overlap accounting, the two-table identity, source turns, content changes with stable message IDs, scope-filtered trend reads, Remote descriptor arity, navigation and output expansion. The actual components are visually checked at desktop and 390px widths using synthetic fixtures.

Acceptance initially passed all build/test stages on main baseline `84399e6a` but failed the final pack gate: full `gen-typert` incorporated game’s `MessageSourceMap` augmentation into Canvas diagnostic declarations, which the family-edge scan misread as a dependency. Mainline fixed the scanner in `43c56cb9` (see [the fix note](../bug-fix/2026-10-10-pack-dist-typert-face-exemption.md)). After incorporating that fix, `pnpm gate` passed all 16 steps in 464 seconds: whole-repo build/test and all 39 bundle tarballs, including 137 Context Lens tests, 620 Canvas tests and 327 script tests. The merge blocker is resolved; cold-install verification remains CI-only.

Production migration uses the explicit `deploy:3080 --replace OLD=NEW` flow ([decision](../process/2026-10-10-deploy-package-replacement.md)); never mount both identities. The rollout result is recorded separately after canary verification.

The prototype-alignment regression pass covers excess-copy arithmetic, equal previews with different full text, exclusive filters, unchanged totals/exchange, and JSON navigation. The reproducible `packages/context-lens/examples/workbench/` preview uses synthetic data and actual components; 800px and 390px light/dark checks confirm no horizontal overflow.

Numbering regressions cover newest-first backfill under retention, independent agents/sessions, eviction, live/log anchoring, partial-history honesty, incremental failed attempts, and display labels separated from query IDs.
