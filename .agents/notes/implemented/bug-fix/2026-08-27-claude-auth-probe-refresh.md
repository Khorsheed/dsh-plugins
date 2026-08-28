# Agent Note: claude auth probe — sync keychain before judging, refresh-token expiry counts

Status: implemented

English | [中文](2026-08-27-claude-auth-probe-refresh.zh.md)

## Problem

On prod 3080 the Claude Code harness showed 未登录 (red) and the user's re-login flow sat stuck at "code 已提交，等待授权完成…" — yet the credential was fully working: a manual `claude -p` against the scoped home succeeded, refreshing the keychain entry in place. Two probe defects combined:

1. claude 2.1.236 on macOS refreshes the credential in the KEYCHAIN and never touches `.credentials.json`. The probe read the file first and refused its stale `expiresAt` — permanently red despite a working credential. `syncClaudeCredentialFile` (the keychain→file mirror) only ran in the login-watch path, never in the plain probe.
2. The probe refused any past-`expiresAt` access token, ignoring `refreshTokenExpiresAt` — but the CLI refreshes on use, so an expired access token with a live refresh token (valid to 2026-09-18 in this incident) is fully functional. The false red sent the user into an unnecessary re-login that never landed a credential.

## Decision

`claudeAuthenticated` now mirrors the keychain into the file BEFORE judging (`syncClaudeCredentialFile` is content-compare, so a fresh file is never clobbered by a stale keychain on macOS — the CLI always writes keychain-first there), and the expiry read — file (`credentialFileExpiry`) and keychain (`readCredentialExpiry`) alike — takes the LATER of `expiresAt` and `refreshTokenExpiresAt`. A credential is refused only when both are past.

## Alternatives considered

- **Probe by spawning the CLI** — rejected long-standing (the file documents why); a `security` read per probe is far cheaper than a CLI boot, and the sync makes it accurate.
- **Treating access-token expiry as the only truth** — the previous behavior; disproven by the CLI refreshing on use.

## Consequences

- A refresh-on-run renews the keychain; the next probe syncs it into the file and reads green — the card dot and the section row agree again.
- Between runs, an expired access token with a live refresh token reads authenticated, matching what a delegation actually does.
- The stuck "code 已提交" login flow was moot in this incident (the credential never needed replacing); the pty exchange's own reliability remains a separate, unverified path.

## Testing

`records.spec.ts` +2: expired-access + live-refresh reads authenticated; a fresher keychain blob is mirrored over the stale file before the verdict (stubbed `security` exec). Suite: claude-code 88/88.

## Cross-references

- [Credential sentinel (kimi)](2026-08-27-kimi-credential-sentinel.md) — the sibling incident's guard.
