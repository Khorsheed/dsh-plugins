# Agent Note: auth-failure truthfulness — fresh-stamp login watches, revocation marks, 401 detection

Status: implemented

English | [中文](2026-08-22-local-agent-auth-failure-truthfulness.zh.md)

## Problem

A revoked claude OAuth token surfaced two lies in the family UX (3080 incident, 2026-08-22):

1. **The manual-handoff login reported success without any login**: the watch polled a presence probe (`oauthAccount` in the scoped `.claude.json`), and the revoked token's leftover marker satisfied it on the first tick.
2. **The status row kept showing "authenticated"**: presence probes cannot see a server-side revocation, so nothing downgraded the harness until a delegation actually failed — and the failure gave no re-auth guidance.

## Decision

- **`credentialStamp?: (homeDir) => Promise<number | undefined>`** joins the harness contract: the credential marker's mtime (claude `.claude.json`, codex `auth.json`, newest file in kimi's `credentials/`). A completed login always rewrites the marker, so the stamp separates "fresh login" from "leftover".
- **Manual login watch requires freshness**: presence AND `stamp > watchStart`. A stale marker keeps the watch polling instead of concluding a false success.
- **`registry.reportAuthFailure(name, detail)`**: providers call it when a settled failure is auth-shaped (narrow signatures per CLI: claude `failed to authenticate|authentication_failed|oauth access token`, codex `401 unauthorized|unauthorized|…`, kimi `401|unauthorized|…`). `statusOf` downgrades a present credential whose stamp predates the mark; the next real login rewrites the marker and the status recovers with no explicit clearing.
- **Detection reads the seam's `collected` buffers post-exit**, not the streamed stdout/stderr variables: `done` can settle before stream data events land, so a settle-time read races the flush (proven by test). The mirror chains already ran post-exit; detection joined them there.
- **claude's stream-json parser** now reads the error detail from the result event's `result` field on `is_error` (real 401s carry the text there; `error` stays a fallback) — before this, auth failures surfaced as the generic "claude -p reported an error".
- **claude's probe also checks the keychain credential's `expiresAt`** (`security find-generic-password -s "Claude Code-credentials-<sha256(home)[:8]>" -w`): past-expiry reads unauthenticated locally; revocation stays server-side-only and flows through the 401 mark.

## Alternatives considered

- **Validating credentials with a network probe on every status poll** — rejected: status is polled every few seconds; revocation visibility is paid for once per failed delegation instead of per poll.
- **Dropping detection into the settle chain (streamed variables)** — rejected on test evidence: the streams lag `done`, so fast failures would slip through intermittently.

## Consequences

- A revoked/expired credential shows unauthenticated within one status poll after the first failing delegation, and the delegation's error names re-auth as the remedy.
- The manual login watch can no longer conclude success from a leftover marker.
- The dsh harness (API-key, no OAuth marker) does not participate: no `credentialStamp`, no marks.

## Testing

Framework: stale-marker watch does not conclude, fresh marker concludes; `statusOf` downgrade on `reportAuthFailure` and recovery on a rewritten marker. Providers (kimi/codex/claude): auth-shaped failure fires `onAuthFailure`, non-auth failure does not; fakes serve text through `collected` buffers to pin the drain semantics.

## Cross-references

- [claude manual-handoff login](../bug-fix/2026-08-22-claude-manual-login.md) — the watch this hardens.
- [CLI sub-agent resume](2026-08-16-local-agent-resume.md) — the registry this extends.
