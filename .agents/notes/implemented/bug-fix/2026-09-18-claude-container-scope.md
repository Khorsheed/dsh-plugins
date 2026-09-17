# Agent Note: A containerized claude condition owns its scope

Status: implemented

English | [中文](2026-09-18-claude-container-scope.zh.md)

## Problem

claude is the only harness in this family whose credential lives in two stores, and the two do not have one reader. Measured:

| where | version | store the CLI reads AND writes |
|---|---|---|
| host, macOS | 2.1.274 | the keychain |
| unit, Linux | 2.1.272 | `<CLAUDE_CONFIG_DIR>/.credentials.json` |

Since T20c a container round bind-mounts the instance's own scoped home read-write, so a host round and a container round against that scope are one grant refreshed from two stores. The endpoint rotates single-use refresh tokens by invalidating the whole token FAMILY, so the side that did not refresh last is left holding a dead token. This is not a timing window. It is what sharing means.

It was measured end to end on the evaluation instance, in the natural expiry window:

1. The unit's round refreshed the grant and wrote the rotated blob through the mount (the credentials file's refresh-token fingerprint changed, its access expiry moved 8 hours out).
2. The host reconcile correctly declined to overwrite it — [newer-wins](2026-09-17-claude-credential-sync-newer-wins.md) working exactly as designed, logging `is AHEAD of the keychain`.
3. The very next host round answered `Failed to authenticate: OAuth session expired and could not be refreshed`, although the file's own access token was still hours from expiry — because the host CLI was not reading that file. It read the keychain, whose refresh token the unit's rotation had just invalidated, and it rewrote the keychain item one second into the failed round.
4. Recovery required a human `/claude-code login`. The container side kept working off the same file throughout.

So newer-wins is correct and necessary — it keeps the file side alive, and step 2 is the proof — but it cannot speak for the keychain. Nothing can: writing the unit's rotation back would mean handing `security add-generic-password` the secret as an argv value, which trades one credential-exposure path for another.

The remaining lever is to stop sharing the grant.

## Decision

**A claude condition that runs inside a unit declares its own named scope, and no host-side claude round ever uses that scope.** Two scopes are two independent grants — claude's keychain item is keyed by the config-directory path, so a named scope gets its own item for free — and one side's rotation cannot reach the other's family.

The evaluation enforces it rather than documenting it, because the failure costs a manual re-login and is invisible until the next host round:

- `claudeScopeDiagnostics` in `packages/eval/src/unit.ts` takes the conditions that run in units and the conditions that run on the host, and returns `CLAUDE_CONTAINER_SCOPE_MISSING` for a containerized claude condition with no scope, `CLAUDE_CONTAINER_SCOPE_SHARED` when a host-side claude condition names a scope a containerized one already uses. Both messages say WHY — two stores, family invalidation — and the missing-scope one names the fix, `/claude-code login --scope <name>`.
- It runs in `validate` (offline, before anyone approves the plan) and again in the run's pre-flight refusals (before any unit is acquired). A plan with no unit segment puts every condition on the host, so players count as host-side there.
- An ABSENT scope is the instance's DEFAULT scope — the one `/claude-code` delegations and every status probe use — so it is the worst case, not a neutral one. That is why the rule is "must declare", not "should differ".

Only `claude-code` is checked. codex pins `cli_auth_credentials_store = "file"`, so host and unit share one store and therefore one chain; kimi has only the file; dsh injects an API key and never refreshes. None of the three can fork a grant.

Two containerized conditions MAY share one scope: both sides of that pair are the same file, which is one chain, the way codex's single store is one chain.

The provider is unchanged. This is a plan-level discipline, not a runtime behavior.

## Consequences

- A container round can rotate its grant as often as it likes without touching the credential the instance's own delegations use.
- Every containerized claude condition costs one human login (`/claude-code login --scope <name>`), once, because credentials are never copied between scopes.
- A plan that predates this rule is refused by `validate` with a message naming the fix, rather than running and logging the instance out.
- The correction this forced on the earlier note — that the host CLI reads the keychain, so the stores never re-converge — is recorded there rather than only here.

## Alternatives considered

**Write the unit's rotation back into the keychain (a2).** The direct repair of the observed failure, and refused on exposure: `security add-generic-password -U … -w <value>` takes the secret in argv, where the process table can see it, and omitting the value drops to an interactive prompt that is useless headlessly. A native Security-framework binding would avoid argv but adds a compiled dependency to a plugin package for one write.

**Suppress the reconcile for container scopes and let each side keep its own copy.** This is what the scope separation achieves, but done by special-casing the sync it would leave both stores nominally pointing at ONE grant — the family invalidation happens at the endpoint, not in our code, so nothing local can make sharing safe.

**Mount a copy of the credential for the unit.** Refused against the standing rule that credentials are not copied, and it would break the model read-back, which parses the round's transcripts out of the mounted scoped home.

**Document the discipline without enforcing it.** The failure mode is silent until a host round runs, and its cost is a human login. A plan that violates the rule cannot be distinguished from a correct one by reading the run's output, which is exactly when a check belongs in the gate.

## Testing

Six cases in `packages/eval/tests/container.spec.ts` against `claudeScopeDiagnostics`: a containerized claude condition without a scope is refused and the message carries both the keychain reason and the login command; one that owns a scope passes; a host-side condition naming the container's scope is refused and the message names the container condition and the token family; a host-side condition on the default scope passes; two containerized conditions sharing a scope pass; and the other three harnesses are untouched even when they share a scope across the line.

`run.spec.ts`'s four-harness container fixture now gives its claude condition a scope — before this change it declared none, so it is also a live example of what the gate refuses.

Not covered by tests: the endpoint's family-invalidation behavior itself, which is the premise. It was measured on the instance (the sequence in Problem) and cannot be reproduced without a real grant.
