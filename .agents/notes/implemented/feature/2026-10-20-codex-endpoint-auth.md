# Agent Note: Codex endpoint-key authentication alongside the web login

Status: implemented

## Problem

The codex harness authenticated only through the device-code/browser login (`codex login`, grant in the scoped `auth.json`). A deployment that routes every other Claude/Codex client through a relay (an OpenAI-compatible proxy, e.g. `ANTHROPIC_BASE_URL`-style env for claude) had no equivalent here: the only endpoint route was a hand-edited custom provider in the scoped `config.toml`, and the only credential the CLI accepted was the interactive grant. Evaluations inside docker units had to authorize once more inside the unit.

Unlike claude-code (2026-10-19 note, OAuth removed outright), codex KEEPS the web login: the user asked for both modes with an explicit choice, so this change is additive, not breaking.

## Decision

`@khorsheed/dsh-local-agent-codex` authenticates by endpoint key when one is configured, and by the existing web login otherwise. Two modes coexist; the endpoint credential WINS at spawn.

- The deployment credential lives in the plugin config pair `baseUrl` / `apiKey`; a scope's own `<scopedHome>/endpoint-auth.json` (mode 0600) overrides it field by field — **scope file > profile config**, the whole precedence. The settings card edits exactly this file for the default scope through the family gateway's session-less `endpointAuth` / `configureEndpoint` Remotes (the same channel claude-code uses; the card adds a verify button riding `checkEndpoint`). The filename matches the evaluation contract hash's credential denylist (`auth`), so key material never enters a condition fingerprint.
- At spawn the resolved credential becomes an argv fragment plus one env var: `-c model_provider="dsh-endpoint"` and `-c model_providers.dsh-endpoint={name, base_url, env_key="OPENAI_API_KEY", wire_api="responses"}`, with the key in the process environment under that `env_key` name. Nothing is written to `config.toml`, `auth.json` is never consulted, and with no key the argv/env are byte-identical to the pre-change shape. The exec path, the resident app-server (`live-driver`), and the model-catalog probe all inject the same layer; container rounds carry the value through `containerExecSpawn`'s name-only `-e` forwarding, so a unit authenticates with the host's credential and nothing is authorized inside.
- A key without a `baseUrl` targets OpenAI's own endpoint — an official platform key needs no custom provider at all (the built-in one reads the same variable), so the override fragment is empty then and only the env rides.
- `wireApi` is a file-only escape hatch (default `responses`, codex's native wire): the card never edits it, and the harness's whole-file writes preserve it through the read-merge-write cycle.
- Auth state is mode-aware: `isAuthenticated` = endpoint key present OR `auth.json` present; `credentialStamp` = the endpoint file's mtime, falling back to `auth.json`'s — a rewrite of either marker is the recovery gesture for a `rejected` grade. `logout` clears BOTH files and refuses with guidance when the credential comes entirely from the profile row. The settings card publishes the authenticated flip on save, but never publishes a clear as anonymous — the web login may still be present, which only the next scheduled probe can tell.
- The probe for the card's verify button is `GET <baseUrl>/v1/models` with `Authorization: Bearer`, folding every failure into the verdict text (unreachable / HTTP status / malformed / models). The URL builder accepts the base with or without the `/v1` suffix (codex's own `base_url` convention includes it; relay conventions vary).

## Verification (probes run before the implementation)

- `https://openproxy.to/openai/v1/models` answers 200 with the relay key (139 models; `gpt-5.3-codex`, `gpt-5.1` etc. serve `POST /v1/responses` with 200 — the Responses API is live, so `wire_api = "responses"` is viable and `chat` stays the escape hatch).
- codex-cli 0.163.0, fresh `CODEX_HOME`, only `OPENAI_API_KEY` plus the two `-c` overrides: `codex exec -m gpt-5.3-codex --json` completes a round end-to-end with no `auth.json` and no login. (The CLI warns "Model metadata not found, defaulting to fallback" for relay-served ids — cosmetic, the round completes.)
- The local codex install had gone stale (broken symlink); `@openai/codex@0.163.0` was reinstalled from npm for the probe.

## Alternatives considered

- **Remove the web login like claude-code did.** Rejected by the user: codex keeps both modes with an explicit choice. The claude note's removal rationale (OAuth incident density) does not transfer one-to-one — codex's device-code flow is a plain file grant, not the keychain/two-store reconcile claude had.
- **Write the endpoint into `config.toml` at provision time.** Rejected: the config is explicitly user-authoritative in this package ("an existing config is respected untouched"), and a written key would sit in a file the evaluation contract hash does NOT denylist. The per-spawn `-c` override is also exactly what the member bridge already does — one mechanism, no file mutation.
- **`OPENAI_BASE_URL` env instead of `-c` overrides.** Rejected: the package already documents that codex ignores it for the built-in provider route; the explicit custom provider is the verified path.

## Consequences

- Additive, non-breaking: a deployment with only the web login behaves byte-identically (no endpoint key → no argv/env change).
- The hand-edited custom provider in `config.toml` keeps working and stays authoritative whenever no endpoint key is configured; with a key, the argv provider outranks the file's `model_provider` selection (documented in both READMEs).
- Card titles unify the family naming: codex/kimi/dsh cards and plugin-manager locale entries read 「本机 Codex/Kimi/DSH 委派」 / "Local … Delegation" (claude-code renamed in the earlier wave). All three already report `cliVersion` through `effectiveSettings`, which the shared `ProviderAuthBlock` renders — no code change needed for the version tag.
- The eval package's `claudeScopeDiagnostics` relaxation remains scheduled (its premise — OAuth refresh-token forking — is gone on the claude side); codex never had that guard.
- A dead endpoint key costs the CLI's retry budget (minutes) before the 401 surfaces; documented in both READMEs' Known Limitations / endpoint sections.
