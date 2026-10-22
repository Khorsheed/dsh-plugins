# Agent Note: Endpoint-sourced model catalogs for kimi and codex

Status: implemented

## Problem

The「可用模型」add dialog's candidate vocabulary must be what the configured endpoint actually serves — claude-code proved the pattern (its catalog is `GET <baseUrl>/v1/models` against the resolved credential, plus the card's「验证端点并获取模型」verify button riding the same probe). The other two harnesses lagged: **kimi** read the scoped `config.toml`'s `[models.…]` tables — a local list that proves nothing about the endpoint and parades entries a dead credential cannot run — and had no verify button at all; **codex** had the button but spawned `codex app-server` to ask `model/list`, i.e. the CLI's LOCAL registry, which equally cannot prove what the relay serves (and let an invalid credential hide behind it).

## Decision

Both harnesses' non-native catalog path now takes its vocabulary from the endpoint — `GET <baseUrl>/v1/models` with the resolved credential's `Authorization: Bearer` header, the same probe the verify button runs — exactly like claude-code. Local sources survive only as metadata enrichment.

**kimi** (`packages/local-agent-kimi`):

- `endpoint-auth.ts` gains the probe pair: `EndpointServedModel` / `EndpointModelsResult` / `fetchEndpointModels` / `checkKimiEndpoint`, mirroring claude's structure. The parse reads kimi's own fields — `display_name`, `think_efforts.valid_efforts` + `default_effort` (a sibling `reasoning.effort.valid`/`default` carries the same data; `think_efforts` is the field read), `context_length` — and tolerates a generic OpenAI-shaped relay answering ids only. `KIMI_MANAGED_BASE_URL` moves here (the definition home: the check and the catalog need it without a cycle; provision.ts re-exports it, so existing importers are untouched).
- `KimiModelCatalog(context, deps)` probes the endpoint like `ClaudeModelCatalog`: no credential / 401/403 / other HTTP / malformed / zero models each fold to an `unsupported` directory with the reason (cached as data); a transport failure THROWS so the shared cache keeps the last good list. A member's ACP runtime configOptions stay authoritative for that member (the native short-circuit is unchanged).
- The kimi-specific fold: kimi-cli ≥2.1 REQUIRES a `[models."<name>"]` table for `-m <name>` (verified 2.1.1: `kimi -m k3` fails with `Model "k3" is not configured in config.toml` when only `[models."kimi-code/k3"]` with `model = "k3"` exists), so a served id matching a managed table's `model` takes the TABLE KEY as its value — the runnable name; endpoint display/effort metadata wins, the table's `display_name`/`support_efforts`/`default_effort` fill what the endpoint omits; a served id with no managed table stands as the bare id. Success answers `customInput: false` — kimi rounds run listed/configured models only, free-typed values are not runnable.
- `ensureKimiModelTables` (provision.ts) is the write face's other half: after each `models.json` write it appends a managed `[models."<value>"]` table (the minimal config's shape, the catalog read's metadata riding along) for every listed value the config does not key yet — the add gesture makes the id runnable in the same write. Idempotent; an absent config is left to provisioning.
- The card gains codex's verify-button block verbatim (dirty-draft disable + hint title, verdict inline), the client wires `checkEndpoint` over the gateway with declare-and-degrade, and the harness descriptor declares `checkEndpoint` — session-less, probing the SAVED endpoint.

**codex** (`packages/local-agent-codex`):

- `CodexModelCatalog.probe` splits into `probeNative` (the app-server body, unchanged) and a new `load`: the endpoint fetch runs CONCURRENTLY with the native probe (`probeNative(...).catch(() => undefined)`, one warn). Served ids the native registry knows carry its `label`/`description`/`hidden`/`reasoning` over; ids only the endpoint serves are plain entries; registry entries the endpoint does NOT serve are dropped. `defaultModel` stays the native probe's `isDefault` slug (the CLI's compiled default — unchanged semantics). The same failure folds as kimi apply; the unreachable throw is not academic — the openproxy relay 500'd once during verification and recovered on its own (2026-10-22), which is exactly the keep-last-good case.
- The card, the gateway wiring, and the `checkEndpoint` descriptor already existed; only the warmup comment was re-read (it now warms an HTTP probe plus a spawn probe).

## Verification (probes against the real deployment, 2026-10-22)

- kimi `https://api.kimi.com/coding/v1/models` with `Authorization: Bearer <key>` answers 200 (x-api-key also works; Bearer is the convention sent). Served then: `kimi-for-coding` (think_efforts low/high/max, default max, context 1048576), `kimi-for-coding-highspeed` (no think_efforts), `k3`, `k3-256k`.
- kimi-cli 2.1.1: `kimi -m k3` fails without a matching `[models.…]` table — endpoint ids are not directly runnable, table keys are.
- codex `https://openproxy.to/openai/v1/models` with Bearer answers 200 in the plain OpenAI shape (139 entries, no display names or effort metadata); it transiently 500'd once and recovered — the retry/keep-last-good semantics exist for this.
- Package suites green: kimi 274, codex 242; both `tsdown` builds and `pnpm check:plugins` clean.

## Alternatives considered

- **kimi: list bare endpoint ids as catalog values without table provisioning.** Rejected: `kimi -m <value>` resolves against the scoped config's model tables, and a bare endpoint id has none (verified against kimi-cli 2.1.1) — the picker would offer models that fail the moment they run. The table-key mapping plus on-add provisioning is what keeps "the list holds only what the endpoint serves" compatible with "everything in the list runs".
- **codex: keep the native app-server registry as the vocabulary.** Rejected: a local list cannot prove what the endpoint serves — a credential the endpoint rejects would still show a full picker (claude-code's catalog note owns the precedent). The endpoint's answer is the only honest vocabulary.
- **codex: drop the native probe entirely.** Rejected: it alone carries the reasoning-effort options and the `isDefault` slug (the CLI's compiled default), which the member picker's effort control and the `cli-builtin` resolution layer both consume; the endpoint's plain OpenAI shape carries neither.
- **kimi: probe with x-api-key as well as Bearer.** Rejected: Bearer was verified sufficient against the managed endpoint (x-api-key merely also works), and one header is the simpler contract.

## Consequences

- A scope with no endpoint credential now sees an EMPTY add dialog with the save-a-key reason on both harnesses (kimi previously showed the config's tables as configuration-sourced candidates; codex showed the CLI registry). That is the intended honesty: nothing listed, nothing fake-runnable.
- kimi's `models.json` write face now mutates the scoped `config.toml` (appending managed model tables) — the first write-through beyond `default_model`. The file stays user-authoritative for existing tables: only missing values gain a table, and a hand-edited table is never rewritten.
- The kimi catalog's `customInput` flips to false (free-typed values are not runnable); codex keeps true (any id reaches the endpoint by argv).
- `KimiModelCatalog`'s constructor gains a deps parameter (endpoint resolver, fetch, ttl, warn) — an internal signature; the gateway-facing surface is unchanged, so an older family core simply never calls the new paths.
- A degraded endpoint read (401/403/HTTP/malformed) is cached as data with its reason; only a transport failure retries on the cache's schedule. Card credential writes re-key the cache through the fingerprinted `endpoint-auth.json`, so a save re-probes immediately.
