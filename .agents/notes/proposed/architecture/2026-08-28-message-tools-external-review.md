# Agent Note: message-tools codex external review

Status: proposed

## Problem

`message-tools` (packages/message-tools) is slated for community open-source
release, but its withdraw/edit/restore machinery had never had an independent
architectural review. Before shipping we want an external assessment of
architecture, code quality, completeness, and open-source readiness, so we can
fix real defects before the surface is public.

A codex subagent ran a read-only review of `packages/message-tools` (src,
tests, package.json, cordis.patch.yml, ts configs, README/CHANGELOG). The
review is reproduced in full in the codex output; this note records the
findings we accept (verified against the source and tests, not just the
review's prose) and the direction we intend to take. No code changed yet.

## Proposal

Adopt the review's findings in two tiers. Tier A items need an upstream
harness API or behavior change and go through the upstream-change pipeline.
Tier B items are self-contained to the package and can ship without upstream.

A (upstream-pipeline, HIGH): make replace-after-cancel turn/revision-aware
instead of trusting a client-side "latest turn" poll, and give the host an
atomic cancel→await-closure→conditionally-replace so a just-started turn is
never silently swept into a replacement tail.

A (upstream-pipeline, HIGH): require a message-tools withdrawal that cites the
target before restoring; return a distinct `withdrawal-not-found` /
`foreign-shadowing` failure otherwise (restore currently replays any
off-surface editable target, crossing producer ownership).

B (self-contained): restore idempotency (stable withdrawal id + reject/return
existing receipt) and transactional/multi-entry append; make ui-model-selection
genuinely optional across `dsh.client.inject` AND peer metadata
(`peerDependenciesMeta.optional`); add `@deepseek-ai/dsh-agent` to
peerDependencies (host injects `['sessions', 'agents']`); extract shared text
join and `replaceAfterSettling` helpers; drop the unused `isMessageToolsTrigger`
or use it; simplify `hiddenFlowKeys`; normalize `foldHiddenRanges` intervals;
probe Remote-mount failure and degrade the action face instead of blind-casting;
re-check `RiskConfirmation.acknowledged` locally; special-case image-only
messages for copy/edit; cancel the DOM-hider scheduled frame on disposal and
sign the rule from actual hidden flow keys.

## Detailed findings

### HIGH — replace-after-cancel is not turn/revision-aware

`turnSettled` (client/edit-in-place.ts) reads the latest turn's close status,
never the identity of the turn being cancelled. The test suite encodes the
unsound case (`ignores an unclosed older turn once the latest one closed`).
Combined with `running` being sampled before `editInPlace`/`withdrawInPlace`
(client/index.ts), a new turn admitted between snapshot and replacement can be
swept into the replacement tail, or the replacement can proceed without
cancelling a just-started turn. Client choreography cannot guarantee this
without host revalidation.

### HIGH — restore accepts foreign shadowing (e.g. compaction) as if it were ours

`planRestore` replays any editable target absent from the live surface; when no
message-tools withdrawal cites it, it replays the target alone (deliberate,
tested `foreign shadowing` case). This crosses producer ownership: a caller can
"restore" content another compactor/policy removed, and the API doc promises
"restore a withdrawn message" which this doesn't guarantee.

### MED — restore is non-idempotent and appends incrementally

`restore` appends each replay entry one at a time (single flush after the
loop, host/index.ts). No request token / already-restored check → a double
click, RPC retry, or second client duplicates a span; a mid-loop append
exception leaves a partial group; a flush failure makes retry ambiguous.

### MED — optional model-selection metadata contradicts runtime degradation

The client probes `modelDirectories` via `ctx.get` and degrades to no chip
(client/index.ts). But `dsh.client.inject` requires
`@deepseek-ai/dsh-client-ui-model-selection`, and it is a required peer with no
`peerDependenciesMeta.optional`. A composition installing this plugin without
ui-model-selection may be blocked before the degradation path is exercised.

### MED — host service deps not declared as peers

Host `static inject = ['sessions', 'agents']` and imports
`@deepseek-ai/dsh-agent` (type-only). `dsh-session` is a peer, but `dsh-agent`
is only in devDependencies. Consumers need it for the host contract.

### Smaller accepted findings

- `editInPlace`/`withdrawInPlace` identical modulo final verb → one private
  `replaceAfterSettling({cancel, waitIdle, replace}, running)`.
- Three separate join-text implementations (host restore fold, client node
  fold, user render) — the two client ones should share a content parser.
- `isMessageToolsTrigger` (marker.ts) has no production caller.
- `hiddenFlowKeys` (dom-hider.ts) has a redundant condition (already gated on
  `source.plugin === 'message-tools'`).
- `foldHiddenRanges` sorts but never normalizes/merges overlapping ranges.
- Remote mount failure logs then blind-casts `ctx.get('remote.messageTools')`
  → a property-access TypeError instead of a typed RPC error.
- `RiskConfirmation.acknowledged` not re-checked in `confirmWithdraw`.
- Image-only messages offer copy (empty clipboard) and edit (unpreservable).
- DOM hider: scheduled animation-frame callback not cancelled on disposal;
  rule signature uses node count + ranges, not actual hidden flow keys.
- Restore chunk maps join in Map insert order, not block index order; the
  single pending accumulator can't handle two interleaved (turn, step) streams.
- Comments restate the full algorithm (dom-hider.ts:1, :166) — tighten.

### Packaging / hygiene

- Stray `packages/message-tools/khorsheed-dsh-client-message-tools-0.4.9.tgz`
  artifact — gitignored (won't ship) but obsolete (pre-0.1.0) and confusing.
- `./types` export points at runtime `types.js` while `types.ts` is types-only.
- `dsh.compat.minHost` (0.1.0-rc.8) vs README's rc.8/0.1.1-rc.2 — put the
  min + latest-verified matrix in one place.
- Package description says "withdraw and resend" but it's in-place
  replace+regeneration — update. README screenshots hosted from another repo
  (`dsh-web-basic`) — move into this repo.
- Changelog notes internal dev reached 0.4.x then reset to 0.1.0 — explain the
  public-version reset in the English changelog too.

## Alternatives considered

- **Do nothing**: the plugin works and is tested; the HIGH items are
  theoretical until a race is observed. Rejected for open-source release — the
  review's HIGH concerns are real latent races, and a public surface is the
  wrong place to discover them.
- **Fix only the self-contained items, defer upstream**: reasonable as a first
  step, but the two HIGH items are the ones most likely to bite users (a silent
  tail sweep can discard unrelated new work; foreign restore can resurrect
  content). Deferring them is acceptable only if documented as known limits.
- **Have the harness expose a turn-id/atomic replace**: the cleanest fix, but
  requires an upstream change; the pipe is slower, so it is scoped to Tier A.
- **Rewrite instead of patch**: not warranted — the pure/core separation is
  sound and the review found no structural reason to rebuild.

## Acceptance criteria

- Tier B items land as self-contained package changes (tests green, typecheck
  clean, hygiene clean, agent-note-format gate passes).
- Tier A items are tracked as upstream-change-pipeline work items and
  re-checked against the next official rc (when the harness ships the
  capability, retire the degraded client path).
- A follow-up codex re-review confirms the HIGH items are either fixed or
  documented as upstream-deferred known limits, and that no new correctness
  gap was introduced.

## Risks

- Upstream items may take longer than the community release window; if
  shipping first, users could hit the turn-sweep or foreign-restore edge cases
  (mitigate: document as known limits and gate the restore foreign-shadowing
  path behind a clear warning).
- Making ui-model-selection optional changes the composition contract; a
  composition that relied on the chip being present would silently lose it
  (mitigate: keep the chip rendered when the service is present, degrade only
  when absent).
- Restoring idempotency could reject a legitimate re-restore that the user
  intended; the recovery UX (busy guard + clear "already restored" message)
  must stay coherent.
