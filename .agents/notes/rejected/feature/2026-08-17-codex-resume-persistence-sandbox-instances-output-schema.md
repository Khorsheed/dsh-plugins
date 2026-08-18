# Agent Note: codex resume 持久化、双 sandbox 实例与 output-schema 结构化结论

Status: rejected — item 1 (delegation-mapping persistence) absorbed into proposals/active/2026-08-18-local-agent-delegation-api.md (M4); items 2-3 (dual-sandbox instances, output-schema) dropped with this note, re-file standalone if needed

English | [中文](2026-08-17-codex-resume-persistence-sandbox-instances-output-schema.zh.md)

## Problem

Three deferred items from the local-agent codex harness review, each a real capability gap:

1. **Resume dies on restart even though the CLI side can continue** — the `childSessionId → cliSessionId` mapping lives only in the in-memory `LocalAgentRegistry.delegations` Map (`local-agent/src/index.ts:221`), lost on process restart; `startCodexResume` also requires a live in-process child session (`codex-cli-provider.ts`). But codex's thread is durable on disk (rollout files), `codex exec resume <thread_id>` reads it directly, and `listCodexSessions` already scans it. The blocker is the dsh-side mapping never persisting, not a CLI capability gap. The same holds for kimi (session dirs on disk) and claude (project jsonl on disk).

2. **Sandbox is a single global setting** — the codex provider's sandbox comes from one plugin Config (`index.ts`), and `CodexCliProvider.name = 'codex-local'` is hardcoded, so only one instance can register per process. A mutual-review scenario wants the reviewer read-only and the implementer write-capable; today a profile must pick one.

3. **Final answers are unstructured text** — review scenarios need a structured conclusion (`{verdict, findings[], required_fixes[]}`). `codex exec --output-schema <FILE>` exists and constrains the model's final response to a JSON Schema; parsing structured conclusions out of free text is less reliable.

## Proposal

### 1. Persist the delegation mapping (childSessionId → cliSessionId)

Persist each delegation record to a harness-level file in the scoped home, one per provider (e.g. `$DSH_HOME/local-agent/<harness>/delegations.jsonl`, append-only, keyed by childSessionId), written when the fresh round records the CLI session id. On `startXxxResume`, when the in-memory registry has no record or the child session is not live:

- recover the mapping by reading the harness's `delegations.jsonl`,
- **keep the `resolveDelegation` parent-session ownership check intact** — the caller's parent session id must still match the recorded one, preserving the cross-session context-hijack guard,
- rebuild/re-attach the child session from the durable header (or lazily re-create it) so the resumed round appends into the same dsh child session.

The file lives in the scoped home because the mapping is harness-level bookkeeping ("which dsh child session maps to which CLI thread"), the same domain as `session_index.jsonl` / rollout files; putting it in the child session log would entangle it with dsh session-domain semantics and cleanup.

### 2. Two fixed-sandbox codex provider instances

Parameterize the provider name so a composition can register two instances, each with a fixed sandbox:
- `CodexCliProvider` name from config (e.g. `codex-local-readonly` / `codex-local-write`), or two Config fields on one plugin,
- the bundle patch mounts two tool rows (`subagent_codex_readonly` / `subagent_codex_write`) or one row whose profile picks the instance,
- **never expose sandbox as a model-facing tool parameter** — that is self-escalation; the sandbox is fixed by composition, chosen by the operator, not the model.

### 3. Structured final answers via `--output-schema`

Add an optional `outputSchemaPath` provider/plugin config: when set, the provider passes `codex exec --output-schema <FILE>` and the final `agent_message` is validated against the schema, surfacing a structured result (parsed JSON) instead of free text. Review presets ship a `{verdict, findings[], required_fixes[]}` schema.

## Alternatives considered

### Why not store the mapping in the child session log?

The child session log is dsh session-domain data — its lifecycle (reopen, cleanup, compaction) is owned by the dsh session system, and the mapping is really "CLI thread identity for a dsh delegation", which is harness bookkeeping. A scoped-home file keeps the two domains separate and survives any session-store reorganisation. The child-log option was not chosen.

### Why not a single provider instance with runtime sandbox switching?

A sandbox chosen at runtime (per call) is a privilege-selection surface — the model could request write access when the operator intended read-only. Fixed-per-instance sandbox keeps the decision at composition time where the operator owns it. Two instances with distinct names also make the review workflow explicit in the preset ("reviewer tools vs implementer tools").

### Why not parse structured conclusions out of the text answer?

Text parsing is fragile across models and phrasings; `--output-schema` is native, validated by codex, and gives the parent a reliable JSON object. The cost is one schema file per review preset, which is exactly the durable artifact a review workflow wants anyway.

## Acceptance criteria

- Restart the profile, then resume a codex/kimi/claude delegation: the mapping survives via the scoped-home file, the parent-session ownership check still rejects a cross-session forged handle, and the resumed round appends into the same dsh child session.
- A composition can mount a read-only and a write-capable codex delegation side by side, each tool row bound to its fixed sandbox, and the model cannot change it via the tool.
- With an output schema configured, codex's final answer returns a validated structured object, and a schema-violating answer surfaces as an error rather than free text.

## Risks

- Persisting delegation mappings grows the scoped home with bookkeeping files; rotation/cleanup policy needed for long-lived profiles (same question as session_index/rollout growth — acceptable, but must be documented).
- Two provider instances double the surface (two tool rows, two provider names) and must not collide with the official `codex` provider name in compositions that mount both.
- `--output-schema` constrains only the final answer; intermediate tool use remains free-form, so the schema must be written to be satisfiable by the review workflow's final response.
