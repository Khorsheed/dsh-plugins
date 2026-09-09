# Agent Note: claude keychain sync mirrors the non-empty entry, never the first-match empty shell

Status: implemented

English | [中文](2026-09-09-claude-keychain-empty-shell-first-match.zh.md)

## Problem

`syncClaudeCredentialFile` read the macOS keychain with `security find-generic-password -s <service> -w` — no `-a`. macOS allows several items under one service, and `-w` returns the FIRST match. On an eval machine the `Claude Code-credentials-<hash>` service held two items: `acct=unknown` (accessToken/refreshToken empty, `expiresAt: 0` — historical debris from an earlier claude) and `acct=<user>` (the real credential a fresh `claude login` had just written). The sync mirrored the empty shell into `<home>/.credentials.json` — the very file the CLI reads at runtime.

The failure shape was expensive: login succeeded, status reported authenticated (the shape check passed), and every delegation failed with `OAuth session expired and could not be refreshed` — byte-identical to a real expiry. Four hypotheses (whitelist proxy, container networking, missing `.claude.json`, refresh-token rotation) were eliminated before hashing the three token copies revealed all three equalled the hash of the empty string. Deleting the shell item made the same code work immediately. Same lesson as pilot A's G4 — *shape-correct is not usable* — one step earlier in the pipeline.

## Decision

- **Enumerate, never trust the first match.** `keychainItems` parses `security dump-keychain` metadata (no secrets in that output) for every account under the service, newest `mdat` first; `readKeychainCredential` takes the first item whose token record is non-empty. Usability beats recency: the shell in the report was the NEWER write.
- **A non-empty token is the bar for mirroring.** `credentialUsable` requires a non-empty `accessToken` or `refreshToken` under `claudeAiOauth`. The legacy unscoped read (kept as the fallback when enumeration itself is unavailable — not macOS, a failing dump) is held to the same bar.
- **All entries empty → return false and heal.** Nothing is written; and a credentials file already holding an empty-token shell — debris from this bug — is REMOVED, so the runtime says "Not logged in" instead of the misleading "OAuth session expired". A file with real tokens is kept (the keychain may be temporarily unreadable).
- **`readCredentialExpiry` reads the same usable credential**, so the status probe and the sync can no longer disagree about which entry exists.

## Verification

`packages/local-agent-claude-code/tests/records.spec.ts` — the keychain suite now stubs `dump-keychain` + per-account reads:

- shell (newer write) + real entry + an unrelated service's item → mirrors the real blob, true;
- two usable entries → the newest write wins;
- all entries empty → false, nothing written, a pre-existing mirrored shell is deleted, probe reads unauthenticated;
- keychain unusable but the file carries real tokens → false, file kept;
- the pre-existing fixtures gained tokens, since token-less blobs are no longer mirrorable by definition.

`pnpm --filter @khorsheed/dsh-local-agent-claude-code build` + `test`: 13 files, 131 tests, green.

## Alternatives considered

**Sort by `mdat` and take the newest regardless of content.** Rejected: the shell in the incident was the NEWER write — recency alone still mirrors it. Recency only breaks ties among usable entries.

**Delete the empty-shell keychain item outright.** Rejected: the keychain is the CLI's own store, shared with it; we read it, we do not prune it. The shell is harmless once never mirrored, and deleting entries from a store another process owns risks breaking a flow we do not see.

**Keep mirroring whatever the unscoped read returns, but log a warning.** Rejected: the file is what the runtime reads. A warned-about shell still fails every delegation with an error indistinguishable from a real expiry — the log line does not un-poison the home.

## Consequences

- A scoped home already poisoned by the shell heals on the next sync (login watch or delegation spawn) — no manual keychain surgery.
- Machines with a single, real entry behave exactly as before (enumeration finds one account; the dump's extra subprocess only runs at probe/spawn time).
- The unscoped first-match read survives only as the non-macOS fallback, and even there an empty shell is refused rather than mirrored.
