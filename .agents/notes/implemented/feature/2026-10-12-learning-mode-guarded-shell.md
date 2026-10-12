# Agent Note: learning mode's guarded shell

Status: implemented

## Problem

Curl-style skills (weread-skills calls its API gateway with `curl` + a Bearer key) need a command transport. Learning mode mounted none, and the observed failure on 3080 was worse than a missing tool: the model delegated the same commands to `subagent_dsh`, whose child runs a scoped-home headless profile with **danger-full-access** — so the diet's "no shell" line was honored in the letter while the model reached a LOOSER shell by delegation, and the credential still never arrived (the child shares neither the credential store nor the catalog's shellEnv contributor).

## Decision

The preset mounts the standard platform pair — `tool-bash` (off Windows) / `tool-pwsh` (on Windows) — and nothing else changes. Every command runs under the learning session's own boundary (workspace-write sandbox + ask approval), which is strictly tighter than the delegation path it replaces. `tool-bash` injects `tools`/`shell`/`systemPrompt`/`shellEnv`, all host-plane and resolvable up the scope chain; the capability catalog's `DSH_<KEY>` contributor feeds the same shell, so a configured skill credential reaches the execution without the raw value entering the model's context.

## Alternatives considered

**Keep no-shell and build a credential-injecting scoped HTTP tool.** The cleaner boundary for API-keyed skills (host allowlist + header templates, substituted server-side); deferred — it is a per-shape channel that covers HTTP skills only, while the shell is the skill ecosystem's actual transport idiom, and the delegation leak meant the diet was buying little real isolation.

**Deny the root-granted subagent tools in this preset (`denyTools`).** A separate composition question (they are profile-root rows, not this bundle's); flagged, not bundled into this change.

## Consequences

Learning mode can run curl-style skills end to end; weread-skills scoped to `learning` works once its key is configured in the catalog. The diet keeps fs/todo/plan/delegation dropped, but the "no shell" claim is gone — the honest boundary is now the session sandbox plus per-command approval. The bundle spec pins the platform pair present.
