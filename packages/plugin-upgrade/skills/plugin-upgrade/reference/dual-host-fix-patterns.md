# Dual-host fix patterns

One artifact must run on the old AND the new host line, so an upgrade never
strands the rollback. These are the moves, cheapest first. Every pattern ends
with the same requirement: a spec per seat, and a live boot on both lines.

## 1. Feature-probe, never version-check

```ts
// BAD:  if (hostVersion >= '0.1.2') { ... }   // rots on backports, forks
// GOOD: probe the capability itself
const events = ctx.get('newEventsService') ?? ctx.get('legacyEventsService')
```

For service names that moved seats between lines, register a probe arm per
name — neither name exists on the other line, so exactly one arm fires. For a
static `inject: [...]` list, never name a service that exists on only one line
— a missing injected service pends the plugin fiber forever and fails the boot
gate. Probe with `ctx.get` and degrade instead.

## 2. Survive deleted named exports with a namespace import

A STATIC named import of an export the new host deleted is a `SyntaxError` at
module load — before any of your code runs:

```ts
// BAD:  import { resolveThing } from 'host-package'  // deleted on the new line
// GOOD: import the namespace and probe the member per call
import * as host from 'host-package'
const resolve = host.resolveThingNew ?? host.resolveThing
```

## 3. Anchor renamed brand types to a consumer API

When the host renames a branded type, any import of the NAME breaks. Derive the
type from a consuming API signature that exists on both lines — the brand cast
erases in emitted JS, so the artifact stays runtime-compatible everywhere:

```ts
// The host renamed the tool-call id brand (e.g. CallId -> ToolCallId).
// BAD:  import type { CallId } from 'host-llm/brand'
// GOOD: extract the same type from a stable consumer signature
type CallIdCompat = Parameters<StreamCallbacks['onToolCall']>[0]['id']
```

## 4. Inline a deleted value-import package

When the host deletes a package whose VALUES you import (stores, factories),
bundle the replacement INTO your artifact (the bundler's `noExternal` list) so
the artifact needs no host module-table row on either line. Precondition —
verify the package carries no cross-boundary identity:

- no `Symbol.for(...)` keys shared with the host,
- no `instanceof` checks against host-created classes,
- no host-shared singletons (your instances must be self-created).

If any of those holds, inlining forks the identity and breaks `instanceof`
checks across the boundary — fall back to pattern 1 with two probed seats.

## 5. Folded members: derive the same shape from the replacement

When the host folds a member into another object (`connection.description`
becomes `connection.generation.description`), derive a same-shaped value from
the new seat when the legacy member is absent, and degrade the capabilities
the new seat genuinely lost (hide the buttons whose RPC moved) instead of
crashing the renderer:

```ts
const description = connection.description ?? deriveFromGeneration(connection.generation)
```

An `undefined` passed into a hook or a `WeakMap` key crashes at render time —
probe at the boundary, substitute a derived value, never pass the hole
through.

## 6. Data that moved packages: dual-seat readers

When a snapshot slice moves to another package (chat data leaving the session
snapshot), wrap the read in a helper that probes the new seat first and falls
back to the legacy slice. One helper per data shape, shared by every reader in
the package — never scatter the probes.

## The verify-each-fix rule

Every fix above ships with: one spec exercising the old seat, one exercising
the new seat, and a live acceptance boot on both host lines. Compile-time
green against old-line types proves nothing about the new line — see
`breakage-checklist.md` §compile-time blind spots.
