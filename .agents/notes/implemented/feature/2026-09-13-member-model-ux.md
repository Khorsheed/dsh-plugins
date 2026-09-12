# Agent Note: member-level model surface for the local-agent family

Status: implemented

English | [中文](2026-09-13-member-model-ux.zh.md)

## Problem

The family had four model/UX gaps. The settings card's default-model field was a blind free-text input — it never showed what model would actually run (settings value? scoped-config default? CLI built-in?) and suggested only recently typed values. A delegation naming a model was hard-refused under the live driver (`assertModelExecOnly`), so "keep this member, switch its model" — the most common member UX — was an error, not an action. The settings card still offered the 输出粒度 (liveMirrorGranularity) radios the family no longer wants as a user-facing choice. And the kimi/claude-code mirrors still dropped content codex had just learned to keep (file-edit args reduced to a bare path, claude's server-side web tools invisible, kimi's ACP plan updates folded nowhere).

## Decision

**Core contract (`local-agent`).** `LocalAgentModelBroker` (`modelInfo(childSessionId?, delegationModel?)`, `setMemberModel(child, model?)`) registered as an optional `modelBroker` on `LocalAgentHarness`; the gateway routes three new remotes — `harnessModel(name)` for the settings card, `memberModel(childSessionId)` and `setMemberModel` for the member composer. The resolution order is fixed and documented on `LocalAgentModelSource`: session-level override → delegation record → plugin-config `model` (settings) → scoped-config default (cli-config) → CLI built-in (names nothing).

**Member composer picker (`local-agent` client).** A chip left of Send shows the effective model (localized 默认/Default for cli-builtin, a per-source title explains WHY); the dropdown lists the broker's `choices` plus a 跟随设置 reset shown only while an override is active. Selection is never optimistic — the authoritative surface is re-read after `setMemberModel`; errors ride the same inline line promptMember uses. Disabled while a round runs or `switchable` is false (the broker's `reason` explains). The surface re-fetches on run start/finish edges, no timer. Null info (non-member, brokerless harness, older core) renders no picker.

**Room invite-time model (`room`).** `RoomInviteRequest.model?` (blank rejected, trimmed, journaled on `room/member-added`, passed as `facade.start`'s model option on the first dispatch); the invite dialog's advanced drawer carries a text input whose datalist the client feeds from `harnessModel(<harness>).choices`, degrading to a plain input when the gateway is absent.

**Provider brokers (all four).** Each provider implements the same shape: an in-memory override map (`Map<childSessionId, string>`, deliberately lost on host restart) shared BY REFERENCE with the exec provider (per-round resolution) and the live driver (spawn binding); member start models recorded when a delegation names a model; `choices` = the deduped union of settings + cliDefault + scoped-config discovery + recentModels — never a hardcoded catalog (kimi parses `[models."…"]` tables, codex the top-level `model` plus `[profiles.*]` model keys — `[model_providers.*]` names providers, not models, and is never collected —, claude the scoped settings.json, dsh the host adapter enumeration read through the public `ctx.llm` surface (`listProviders` × `listModels` spelled `provider/model`, refreshed on `llm/adapters-updated` — the same trio the host's own model picker is built on, public and stable since 0.1.2). `setMemberModel` throws while the member has an in-flight round (`activeDelegations()`), is a no-op on a same-model set, and retires the member's live runtime when the new effective model differs from the one the runtime bound at spawn.

**Member-aware live drivers.** Each spawn binds the member's resolved model (kimi: scoped `default_model` rewrite; codex: the app-server's `-c model=…`; claude: scoped settings.json scratch plus an in-memory `ClaudeScopedModelMemory` keeping the person's configured value as the honest cli-config layer so one member's scratch never leaks into another's runtime; dsh: the headless launch's `--model` under `--serve`). Each runtime records its `boundModel`; `ensureRuntime` retires a runtime whose bound model differs from the round's start model before respawning — the CLI session itself carries over (thread/rollout/on-disk resume).

**The exec-only refusal is gone for models** (`assertScopeExecOnly` stays; the core's exported helper is untouched): a delegation naming a model under live mode becomes the member's start model instead of an error. On the exec path the override outranks even the recorded delegation model (`resolveRoundModel(override ?? recorded, settings)`) — the documented order — so a composer switch reaches the next round of either drive.

**Settings cards (all four).** The 输出粒度 radio row is removed entirely (locale keys, dead CSS); the YAML/schema knob stays for deployments. The default-model block fetches `harnessModel('<name>')`: an effective-model line under the input (settings value → 跟随 CLI 配置/宿主默认 → CLI 内置/宿主实例默认) and datalist choices from `info.choices`. A null answer degrades to the old bare input. recentModels persistence is unchanged.

**kimi/claude content completeness.** kimi: `argsOf` renders Edit/MultiEdit as `update: <path>` with `@@`/`-`/`+` hunks and Write as `add: <path>` with `+` lines (codex's apply-patch idiom), then a `key=value` fallback for tools outside the four scalar keys; user-message dedup compares kind AND text; unknown `content.part` types and non-text ACP chunks fold visible placeholders; ACP `plan` updates fold as plan lines (the wire never records plans — surveyed ~70k real events). claude: Edit/Write/MultiEdit/NotebookEdit render the same apply-patch idiom; `server_tool_use` / `web_search_tool_result` / `web_fetch_tool_result` map to tool cards paired by id; `redacted_thinking` folds a placeholder think line; live `control_request` (`can_use_tool`) is auto-answered allow (a subagent has no approval surface — a `permissionMode: 'normal'` spawn would otherwise hang), unknown subtypes get an error answer.

## Alternatives considered

**Per-delegation model stays exec-only (keep `assertModelExecOnly`).** Rejected: it made the composer's whole model story lie in live mode — the most common member UX is exactly "keep this member, switch its model", which the refusal turned into an error instead of a respawn.

**Rank the recorded delegation model above the session override** (the shorthand `resolveRoundModel(recorded, () => override ?? settings)`). Rejected: it contradicts the documented order and makes a composer switch a no-op on the exec path for any delegation that named a model at start. The override is the first layer on every path.

**Driver reads the delegation record itself for the spawn model.** Rejected: the record does not exist at a fresh round's spawn time (codex learns its thread id from the wire), so the provider passes the start model explicitly through the round spec; the resolver chain (override → settings) stays the driver's only config read.

**Retire-and-respawn on every model-affecting settings write.** Rejected: a settings-level model change keeps the pre-existing semantics (applies at the next natural respawn — idle reclaim, crash, live toggle); only the explicit per-member switch and the start-model mismatch force a retire, so a harness-wide change never kills members' runtimes wholesale.

## Consequences

The composer picker, the settings card's effective line, and invite-time model work across all four providers; a delegation can name a model under either drive. Costs: one more shared mutable map per provider (owned by the broker, read by provider and driver), and a resident runtime may now be recycled by a UI gesture — bounded by the in-flight refusal and the same-model no-op. Overrides are in-memory: a host restart returns every member to the settings layer. Tests: core client 244 green (picker 10 new), room 199 green (invite model 5 new), kimi 219 (broker 13, completeness +~10), claude-code 195 (broker 16, fold completeness 7, control_request), codex 189 (broker 12), dsh 171 (same shape).
