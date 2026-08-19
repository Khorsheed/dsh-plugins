# Agent Note: Room invite validates the provider, and failed runs carry their reason

Status: implemented

English | [中文](2026-08-19-room-invite-provider-validation.zh.md)

## Problem

A live field report: the main agent invited a member through `room_invite` with `provider: "kimi"` — the harness's *display* name — while the local-agent family had registered the delegation provider as `kimi-cli` (`local-agent-kimi` records harness name `kimi` + delegationProvider `kimi-cli`). Invite validated only non-blankness, so the bad provider landed in the roster; the first @-dispatch then threw inside the delegation facade's `requireProvider`, the run settled `failed` 6ms in, and the UI showed only「kimi 运行失败 · 0.0s」— no cause anywhere: the terminal `room/run-state` edge carried no reason, and the client rendered the flat `0.0s` which reads as "nothing happened".

## Decision

Two layers, both fail-fast-with-cause:

1. **Invite rejects an unknown provider.** `RoomService.inviteMember` (the shared entry of the `invite` Remote and the `room_invite` tool) now validates the provider against the roster's `delegationProvider` set — the same probe `listProviders` already serves (`probeLocalAgentRoster` → `roster()` + `statusOf`). A miss returns the structured `unknown-provider` failure carrying the legal `available` list; the `room_invite` tool renders it as self-correcting text (`Unknown delegation provider "kimi" … Available: kimi-cli, codex-cli … Retry`), so the model renames and retries on its own. A core whose registry predates the roster slice skips the check (degrade, never explode); an absent facade still answers `local-agent-unavailable` first. The dialog picks providers from `listProviders`, so it cannot produce the slip — it only gained the localized copy for the new code.
2. **Failed runs say why.** `room/run-state`'s terminal `failed` edge carries an optional `error` (journal replay tolerates old error-less edges — the field folds only when present, `exactOptionalPropertyTypes`-clean). The dispatch engine threads the caught fault's message (and explicit reasons for the facade-missing / agent-not-live / non-completed-stopReason paths) into the edge; the client's dim failure row renders the reason, ellipsis-truncated with the full text on hover. Durations under 100ms now render `<0.1s` instead of `0.0s`.

The `room_invite` tool description and its `provider` parameter doc now state the contract up front (delegation provider id, e.g. `kimi-cli`, not the harness display name; when unsure, probe without `firstTask` and read the rejection's list).

## Alternatives considered

- **Validate at dispatch only, keep invite permissive** — rejected: that is the reported bug; the roster entry with an undispatchable provider is a write-side invariant violation, and invite is the only write.
- **Reject when the roster slice is missing** — rejected: `probeLocalAgentRoster` returning undefined means a pre-roster core; failing invite there would break compositions that worked before (degrade, don't explode).
- **Resolve display names to delegation providers at invite (accept `kimi`, store `kimi-cli`)** — rejected: silently rewriting model input hides the vocabulary the model must learn for the *next* call; the self-correcting rejection teaches it, and the roster is the single source of truth for what dispatch can resolve.

## Consequences

- Wire vocabulary: `RoomFailure` gained `{ code: 'unknown-provider', provider, available }`; `RoomRunStateEvent` and the replayed `RoomMemberRun` gained optional `error`. Both flow through `./types` into the generated Remote codecs; old journals replay unchanged.
- Tests: host specs pin the rejection (with the legal list), the skip-on-rosterless-core degradation, the failed edge's `error` on all three failure paths, and the tool's self-correcting text; the client spec pins the reason row and the `<0.1s` rendering. 110 → 117.
