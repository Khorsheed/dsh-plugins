# Agent Note: Kimi session configuration and DSH adapter directories

Status: implemented

## Problem

Kimi discarded native session configuration and its model broker read the default scope. DSH reduced adapter enumeration to identifiers, losing names and reasoning capabilities. Long-running directory subscriptions could also retain every obsolete configuration identity indefinitely.

## Decision

Kimi captures native configuration from session/new, session/load and config_option_update, including updates between turns. It maps the first model and thought_level select categories, retains native control IDs separately, and associates dependent reasoning choices only with the currently selected model. Older models metadata remains a read-only fallback. A directory read does not create a throwaway ACP session: before a live session supplies metadata, it exposes the actual scoped configuration as an explicitly incomplete, configuration-sourced candidate set.

DSH uses the public host adapter enumeration and optional resolveModelInfo to retain route IDs, labels, descriptions and adapter-owned reasoning values. Missing capabilities stay unknown. Failed provider groups mark enumeration incomplete; a failed full refresh retains the previous data as stale. This is the host catalog used by sub-profile provisioning; it does not prove that a separately changed scoped runtime still has identical configuration.

Both providers use the same core cache, refresh Remote and subscriptions as Codex and Claude. Cache retention now evicts unused old identities while preserving open subscriptions and in-flight probes.

Protocol reference: [ACP v1 session configuration](https://agentclientprotocol.com/protocol/v1/session-config-options). The local Kimi 0.42.0 isolated probe completed initialize, while session/new without credentials returned authentication required. Native authenticated model/configuration behavior remains an acceptance item; implementing the protocol parser is not that evidence.

## Alternatives considered

**Open a new Kimi session whenever the picker opens.** Rejected because discovery should not leave disposable sessions or require generation merely to show configured candidates.

**Apply the current session's effort list to every model.** Rejected because ACP configuration options may depend on the current model and may change together.

**Treat a host DSH catalog as scoped runtime proof.** Rejected. Runtime admission and subsequent observations must establish what the member actually uses.

## Consequences

All four family providers now implement rich directory reads and subscriptions. The shared picker, durable selection state and executable effort channels are still being integrated. No selection semantics change in this commit. Provider-specific unknowns remain explicit instead of inventing a common model or effort vocabulary.

## Testing

Kimi tests cover native and legacy parsing, configured fallback, native replacement, current-model reasoning options, and configuration notifications between turns with session filtering. DSH tests cover route/name/effort preservation, partial enumeration, refresh failure and absent public capabilities. Core verifies that unused identities are evicted without dropping a viewed directory.
