# Agent Note: a Codex member runs under its session's sandbox mode

Status: implemented

## Problem

A Codex member of a full-access room (bcc89add…, 10-27) ran every command inside Codex's `workspace-write` seatbelt with no network, whatever its session showed. Blender crashed there (exit 139, five times in one round), while a Kimi member ran the same script and exported seven times. The sandbox came only from this plugin's `sandbox` config, which defaulted to `workspace-write` and is unset on 3080. The session's own `sandbox/mode` was never read. Claude members run with permissions skipped and Kimi members run unconfined, so Codex was the odd one out.

## Decision

- `CodexCliProvider.sandboxFor(childSession, parentSessionId)` decides each round's policy. If the plugin config's `sandbox` is set explicitly, it wins. Otherwise the provider reads the member's session: the delegating session's latest `sandbox/mode`, then the child session's inherited one. The host's vocabulary (`read-only` | `workspace-write` | `danger-full-access`) is Codex's own, so the value passes through unchanged. When neither session records a mode, the round runs under `workspace-write`.
- Both drives use it: the exec argv's `--sandbox`, and the live driver's `thread/start` (via `CodexLiveRoundSpec.sandbox`).
- The config's schema is unchanged. Unset now means "follow the session" instead of `workspace-write`.

## Alternatives considered

- **Set the plugin config to `danger-full-access`.** That would give every Codex member full access regardless of its session, breaking a read-only or workspace-write session's own limit.

## Consequences

- A member gets the access its session shows. A restricted session keeps its member restricted.
- The live driver applies the mode when the member's thread starts. A mode changed mid-life applies from the member's next thread (a reclaim or a model change).
- The eval snapshot's `sandbox` field still reports the config value (`workspace-write` when unset), not the per-session mode.

## Testing

`local-agent-codex` (262): specs cover the parent's mode first, the child's latest inherited mode, unknown and absent modes, and an explicit config overriding the session.
