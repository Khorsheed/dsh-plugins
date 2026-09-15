# Agent Note: Core admission leases and native provider configuration binding

Status: implemented

## Problem

A durable pending slot cannot protect actual execution when only the facade consults it: provider starts also originate from direct subagent tools. Creation-time configuration is not validated by a controller that only validates later selections. Defaults may change while the member is idle.

## Decision

Core owns member execution bindings, validates their provider, parent, cwd, scope and creation configuration, and acquires a whole-turn lease at the provider boundary. Current provider adapters are resolved per operation so a settings reload cannot leave a disposed driver captured. The provider result releases the lease; failed starts release it as well. Preparation validates and resolves defaults before admission. A newer selection arriving during preparation is applied before the prompt starts, without concurrent native preparation and application.

The registry and gateway expose one durable configuration state and correlated select, cancel, retry and subscription operations. Compatibility model writes use that same slot for an adapter-enabled provider. Creation requests can carry native effort and a frozen-condition lock, both retained in the delegation record; resume inherits these instead of accepting an unrecorded override.

Codex is the first provider wired through this boundary. Its adapter distinguishes member inheritance from harness defaults, validates explicit effort against the selected native directory entry, and retires idle runtimes on changes. Its next live round carries the admitted model and effort on native `turn/start`; the same snapshot supplies process overrides and the exec argv. This protocol shape was checked against the installed CLI's generated JSON schema. Requested/resolved configuration remains separate from observed generation facts.

DSH and Claude now use the same provider admission lease. DSH passes effort through the owned headless launch and validates it against the actual sub-instance adapter before Agent creation/resume. Claude initializes its native control channel and requires a successful `set_model` response before sending a user prompt. Its controlled path skips shared model scratch writes; the compatibility path remains pending authenticated acceptance. Claude effort uses the documented per-process `CLAUDE_CODE_EFFORT_LEVEL`, including native `auto` reset, because a local isolated probe confirmed `set_effort` is unsupported ([official model configuration](https://code.claude.com/docs/en/model-config)).

Resident reuse compares the complete admitted configuration, including absent values. A change to effort defaults or clearing a model cannot leave an earlier process binding active. Native acknowledgement failures stop admission without an exec retry of that prompt.

## Alternatives considered

**Guard only facade starts.** Rejected because direct tool starts would bypass the consistency contract.

**Resolve mutable broker overrides inside each generation step.** Rejected because one model/tool round must retain its admitted configuration.

**Replay an uncertain native prompt after restart.** Rejected. Recovery retires an idle Codex runtime and prepares persisted configuration; it does not replay generation.

## Consequences

The shared picker, Kimi admission adapter, evaluation frozen-condition callers and full runtime acceptance remain in progress. A configuration acknowledgement is not an observation of the generated model. Existing live scope guards and native default-resolution limitations still need their dedicated integration work. No production profile or authentication state changes in this slice.

## Testing

Core full suite: 299 tests. New admission tests cover provider-result release, failed starts, identity/scope/lock mismatch, default refresh and selection during preparation. Codex: 222 tests, including native effort validation, resumed `turn/start` configuration, and changed/cleared defaults. DSH: 184 tests; headless: 54 tests, including sub-instance validation and launch effort propagation. Claude: 230 tests, including pre-prompt native controls, scratch avoidance and rejection without generation. Core and all affected provider/headless builds pass.
