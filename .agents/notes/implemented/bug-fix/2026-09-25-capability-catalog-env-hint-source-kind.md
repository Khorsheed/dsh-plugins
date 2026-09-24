# Agent Note: the skill env hint's retired source wrapper killed turns on rc.1 (producer-owned kind now)

Status: implemented

## Problem

`packages/capability-catalog/src/envHint.ts` appends a per-skill credential-mapping note as an `additionalContexts` user message on `tools/post-execute` of the `skill` tool. Its source was the 0.1.5-era wrapper `{kind: 'plugin', plugin: 'capability-catalog'}` — hidden from every type check by the `as unknown as never` cast the unofficial `additionalContexts` shape required, and so missed by the rc.1 wave's `createUserMessage`-keyed audits.

rc.1's session format v4 admission (`assertV4SourceRowAdmission` via the persistence `encodeEvent`) rejects a message whose `source.kind` is missing, empty, or exactly `'plugin'` — the retired wrapper. The rejection throws INSIDE the turn's append, the agent loop flattens it to `UNKNOWN`, and the turn dies with the log's last row at the `tool/call` (the failing append never reaches disk). Reproduced deterministically on 3093: any turn whose model loaded a skill with a configured credential env decl (`dsh-self-restart-guard` on that instance) failed at the skill result's step; plain turns passed, which is why the wave's UI-only acceptance never saw it.

## Decision

Stamp the injection with the producer's own kind, the ankh-guard pattern: `{kind: 'capability-catalog', plugin: 'capability-catalog', form: 'env-hint'}`. Own-kind sources are valid on both host lines (pre-V4 hosts serve any kind verbatim; v4 admits any nonempty kind except the bare `'plugin'`), so the fix needs no probe and no dual arm.

## Alternatives considered

**Kind `plugin:capability-catalog` (the v3-migration canon).** Rejected for new writes: the migration maps old wrappers to that shape so READERS can recognize history, but a producer writing natively owns its bare name (ankh-guard, message-tools `kind: 'message-tools'`); keeping the `plugin:` prefix on fresh writes would entrench the retired wrapper's vocabulary. Readers that span both eras (message-tools' `isMessageToolsSource`) already accept bare and prefixed kinds alike.

**Drop the `plugin` field now that kind carries the identity.** Rejected: it is free metadata that old readers key on; removing it buys nothing and breaks any consumer matching `plugin === 'capability-catalog'`.

**Probe the host line and keep the wrapper on 0.1.5.** Rejected: own-kind is valid on both lines, so a probe would be pure ceremony.

## Consequences

Turns survive a credentialed skill load on rc.1; 0.1.5 behavior is unchanged (the source was never validated there). The audit gap is the real lesson: any message write hidden behind an `as never` cast escapes type-keyed sweeps — the sweep for retired wrappers must grep the literal `kind: 'plugin'`, not the constructor. Repo-wide that grep now shows the retired shape only in deliberate test fixtures and in message-tools' reader (which must keep recognizing it in old logs).

## Testing

`tests/env-hint.spec.ts` (new, 3 cases): the accept decision's injected context carries `kind: 'capability-catalog'`; pass-through when no declared credential is configured; non-skill executions ignored. Package suite 235 green.

## Related

- [capability-catalog resolves rc.1 preset scopes through the leased roster face](./2026-09-24-capability-catalog-rc1-leased-scope.md) — the other rc.1 seam repaired in the same package.
- [The community agent presets ship as one declarative bundle (host 0.1.7-rc.1)](../../implemented/feature/2026-09-24-community-presets-declarative-bundle.md) — the wave whose audit missed this cast-hidden write.
