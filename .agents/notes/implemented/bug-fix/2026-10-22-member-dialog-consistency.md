# Agent Note: Member dialog consistency — claude's effort parse fix + member model directories scoped to the shortlist

Status: implemented

English | [中文](2026-10-22-member-dialog-consistency.zh.md)

## Problem

Two regressions surfaced on 3080 after the endpoint-sourced model catalogs wave ([2026-10-22-endpoint-model-catalogs.md](../feature/2026-10-22-endpoint-model-catalogs.md)):

1. **claude members' reasoning-effort pane was entirely disabled.** The endpoint probe (`GET /v1/models`) read each model entry's top-level `effort` field, but the served shape nests it at `capabilities.effort.<level>.supported` (verified against the openproxy relay 2026-10-22; the official API shares the shape) — directory entries lost their `reasoning`, so the pane had nothing to offer.
2. **The member session's model dialog did not match the delegation card's「Available models」shortlist** (user report). A member's model directory was the broker's extended view (endpoint catalog + settings/cliDefault + config-discovered + history); on kimi it even listed scoped-config table models the endpoint does not serve (e.g. `fable5` from the user's mirrored config).

## Decision

- claude-code `endpoint-auth.ts`: `servedEffortsOf` prefers the top-level `effort` block and falls back to `capabilities.effort` — both shapes answer.
- Each of the three provider brokers carries the same `scopeServedDirectory` helper (inlined per package, see below); `modelDirectory`/`followModelDirectory` now scope by the asking surface:
  - memberless (the card's add dialog, the invite picker): only `source: 'native'` endpoint-served entries — configuration/history extras never become add candidates;
  - a member with a non-empty curated list: the list IS the vocabulary, in list order (a curated value the endpoint no longer serves stays as a bare row, exactly as the card shows it), plus the member's current effective model as a bare entry when it sits outside the list so an existing binding never renders blank;
  - a member without a curated list: the legacy extended vocabulary, unchanged.

## Alternatives considered

- **Folding `scopeServedDirectory` into the family core**: the three broker copies are verbatim. Folding into core (`model-directory.ts`) means a new core publish the providers import at runtime — core shipped rc.3 the same day, and a same-day rc.4 for one pure function is not worth it; fold at the next family wave.
- **Scoping the invite picker (room's InviteDialog reads the memberless directory) to the shortlist too**: the memberless directory also feeds the card's add dialog, which needs the full endpoint catalog to add from; the invite picker's full-catalog noise (139 entries on codex's relay) is left as follow-up (a `curatedOnly` flag on the directory face, say).
- **kimi's live-mode ACP configOptions directory**: untouched — it is the runtime's authoritative answer for that member; the scoping only gates the broker's directory face.

## Consequences

The member session's model/effort dialog now mirrors the card's「Available models」shortlist exactly, and claude members' effort pane offers the endpoint-advertised levels again. No data migrations; existing member bindings outside the list keep working and stay visible. Follow-ups: fold the triplicated `scopeServedDirectory` into the family core at the next wave; consider a `curatedOnly` flag for the invite picker's directory face.

## Verification

- New specs: claude model-catalog's `capabilities.effort` nesting case; three scoping cases per broker (memberless endpoint-pure / member shortlist-scoped with current-binding kept / legacy extended without a list).
- kimi 278 / codex 247 / claude-code 262 green; the openproxy claude route's `capabilities.effort` shape verified live (2026-10-22).
