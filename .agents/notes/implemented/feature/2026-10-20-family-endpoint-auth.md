# Agent Note: Endpoint-key auth everywhere — codex and kimi drop OAuth too

Status: implemented

## Problem

After claude-code's OAuth removal (2026-10-19 note) and codex's one-day dual-mode experiment, the family still had two login flows with different failure shapes: codex's device-code/browser grant (auth.json) and kimi's OAuth (credentials/kimi-code.json + the empty-shell wipe bug that needed the credential-guard sentinel). The user decided the whole family goes endpoint-key only, and asked whether that is appropriate. It is: one credential story across four harnesses, container rounds share the host's credential with nothing authorized inside, no rotation fork anywhere.

## Decision

`@khorsheed/dsh-local-agent-codex` and `@khorsheed/dsh-local-agent-kimi` authenticate by endpoint key only, same shape as claude-code: `<scopedHome>/endpoint-auth.json` (0600, denylist-named) merged field-by-field over the profile row's `baseUrl`/`apiKey`; the card edits the file through the family gateway's session-less `endpointAuth`/`configureEndpoint` Remotes; `isAuthenticated` is key presence, `credentialStamp` is the file mtime, `logout` clears the file and refuses when the credential is config-sourced. dsh needed nothing (its child instance authenticates through its own profile's model config; `isAuthenticated` reads no directory).

- **codex**: the web login (PTY `codex login`, the device-code paste) is removed one day after it shipped as the dual-mode's second leg — the user cut it. `login` declaration gone (`/codex login` answers no-login-flow); provisioning sweeps the leftover `auth.json` on every boot so a stale grant cannot authenticate while the status reads unauthenticated. The spawn-time `-c model_providers.dsh-endpoint={…}` + `OPENAI_API_KEY` injection is unchanged. Card copy drops the dual-mode wording.
- **kimi**: the OAuth flow (device-code `kimi login`, `credentials/`, `oauth/`, the credential-guard sentinel) is removed outright. The injection mechanism is kimi-native: kimi-cli ≥2.1 supports `api_key_env` on a provider (read the key from a named environment variable, mutually exclusive with an inline `api_key` — verified against the 2.1.1 binary's own validation text and its exact "declares api_key_env but the environment variable is not set" error). The managed provider `managed:kimi-code` in the scoped `config.toml` declares `api_key_env = "DSH_KIMI_ENDPOINT_KEY"`; the key lives only in endpoint-auth.json and the child process's environment, so `config.toml` stays secret-free and hashable. A surgical, idempotent migration (`migrateManagedProviderConfig`) rewrites an existing (or user-mirrored, redacted) config onto that shape — dropping the OAuth sub-table, replacing any inline `api_key` — at provision, at the card's credential save, and before every spawn (drift-only writes); the managed provider's `base_url` is pinned to the resolved endpoint there (absent = kimi's own service, so clearing the card's baseUrl reverts instead of leaving a stale relay). The provision sweep removes `credentials/` and `oauth/`.
- kimi ships **no** verify button in v1: kimi's coding service has no confirmed token-free model-list probe, and the card hides the button when the `checkEndpoint` face is absent (declared degrade). Follow-up if a probe endpoint surfaces.

## Alternatives considered

- **Keep codex's web login as a second mode** (the state shipped earlier the same day). Cut by the user for family uniformity: one auth story, one card shape, one eval story. The dual-mode code was hours old; removing it is cheaper than keeping the precedence question alive.
- **kimi: write the key inline into `config.toml`** (`api_key = "…"`). Rejected: `config.toml` is an evaluation-condition input (the snapshot reads it), so a key inside it would enter the condition fingerprint — the contract forbids hashing credential content. `api_key_env` keeps the file clean while the CLI reads the key from the environment.
- **kimi: keep OAuth and detect a config `api_key` for isAuthenticated** (the earlier "minor add" plan). Rejected by the same uniformity decision; the guard's whole reason to exist (the CLI's empty-shell wipe, now twice reproduced on demand by a dead grant's refresh attempt) disappears with OAuth.

## Verification

- kimi 2.1.1, fresh `KIMI_CODE_HOME`, config with the managed provider on `api_key_env`: the CLI's own error names the missing variable — the indirection is honored; a `type=kimi` round against a relay answered at the protocol level (model-level 404, i.e. transport+auth fine). An end-to-end 200 needs a real kimi-for-coding platform key, which the deployment owner supplies at the card.
- kimi OAuth rotation probe (two copies of the 3080 scoped credential): BOTH report `The provided authorization grant is invalid` — the grant was already dead server-side — and BOTH attempts wiped `credentials/kimi-code.json` into the empty shell, reproducing the guard's bug signature on demand (2/2). Rotation timing itself is unmeasurable from a dead grant; the fragility conclusion stands without it.
- codex-cli 0.163.0 end-to-end through the relay was verified for the endpoint mode the day before (2026-10-20 codex note); this change only removes the second leg.
- Package suites: codex 246 green, kimi 255 green (new endpoint-auth + surgery specs included), builds green in the worktree.

## Consequences

- Breaking change on both packages (major at the next release wave): a deployment on either web flow must configure `baseUrl` + `apiKey` before upgrading; both READMEs carry the migration note. The 3080 instance needs fresh kimi and codex credentials saved on their cards (the kimi OAuth grant was already dead before this change — measured during the probe).
- kimi's `credential-guard.ts` and its spec are deleted; the wipe bug becomes unreachable (no credential file exists for the CLI to wipe).
- All four harnesses now share one credential file name (`endpoint-auth.json`), one card form, one grade/recovery semantics (file mtime stamps, rewrite = recovery), one container story (name-only env forwarding, zero in-container authorization).
