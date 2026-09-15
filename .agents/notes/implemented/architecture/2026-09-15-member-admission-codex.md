# Agent Note: Core admission leases and Codex configuration binding

Status: implemented

## Problem

A durable pending slot cannot protect actual execution when only the facade consults it: provider starts also originate from direct subagent tools. Creation-time configuration is not validated by a controller that only validates later selections. Defaults may change while the member is idle.

## Decision

Core owns member execution bindings, validates their provider, parent, cwd, scope and creation configuration, and acquires a whole-turn lease at the provider boundary. Current provider adapters are resolved per operation so a settings reload cannot leave a disposed driver captured. The provider result releases the lease; failed starts release it as well. Preparation validates and resolves defaults before admission. A newer selection arriving during preparation is applied before the prompt starts, without concurrent native preparation and application.

The registry and gateway expose one durable configuration state and correlated select, cancel, retry and subscription operations. Compatibility model writes use that same slot for an adapter-enabled provider. Creation requests can carry native effort and a frozen-condition lock, both retained in the delegation record; resume inherits these instead of accepting an unrecorded override.

Codex is the first provider wired through this boundary. Its adapter distinguishes member inheritance from harness defaults, validates explicit effort against the selected native directory entry, and retires idle runtimes on changes. Its next live round carries the admitted model and effort on native `turn/start`; the same snapshot supplies process overrides and the exec argv. This protocol shape was checked against the installed CLI's generated JSON schema. Requested/resolved configuration remains separate from observed generation facts.

## Alternatives considered

**Guard only facade starts.** Rejected because direct tool starts would bypass the consistency contract.

**Resolve mutable broker overrides inside each generation step.** Rejected because one model/tool round must retain its admitted configuration.

**Replay an uncertain native prompt after restart.** Rejected. Recovery retires an idle Codex runtime and prepares persisted configuration; it does not replay generation.

## Consequences

The shared picker, other provider adapters, evaluation frozen-condition callers and full runtime acceptance remain in progress. A configuration acknowledgement is not an observation of the generated model. Existing live scope guards and native default-resolution limitations still need their dedicated integration work. No production profile or authentication state changes in this slice.

## Testing

Core full suite: 299 tests. New admission tests cover provider-result release, failed starts, identity/scope/lock mismatch, default refresh and selection during preparation. Codex tests cover native effort validation and admitted model/effort on a resumed thread's `turn/start`; both packages build successfully.
