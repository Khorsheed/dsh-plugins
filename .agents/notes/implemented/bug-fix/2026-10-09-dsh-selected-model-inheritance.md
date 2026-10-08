# Agent Note: Local DSH inherits the selected model route

Status: implemented

## Problem

The local DSH model directory and default selection came from the parent instance, but its separate headless profile only received a DeepSeek credential. Selecting the parent's Kimi route therefore produced `NO_ADAPTER`. The live mirror then replaced that native failure with `UNKNOWN`, hiding the cause.

## Decision

Local exec and resident launches snapshot the selected model's effective settings through the public settings service. Native DeepSeek and official pi-ai routes with an explicit API-key reference are supported. Only the selected route is copied, and only its named credential is resolved. The generated profile contains environment expressions; concrete configuration and credentials travel in the explicit launch environment, never argv or the profile file. The native DeepSeek credential override remains supported.

A private in-memory fingerprint covers both configuration and resolved credential. If either changes, the next round replaces the resident process and resumes the same session. The current round keeps its existing configuration. Authentication status checks the selected route, so Kimi does not require an unrelated DeepSeek key. The catalog omits adapters without this inheritance contract and marks its result incomplete. Native live failures retain their original error code and message.

Container execution and remote targets retain their own configuration and credential paths. The official subagent tool's model-selection allowlist is a separate policy; it does not govern the community `subagent_dsh` tool.

## Alternatives considered

**Copy the full parent profile or credential store.** Rejected: it transfers unrelated secrets, UI services and persistent settings into a separately owned home. OAuth grants also have refresh ownership that cannot safely be duplicated as static keys.

**Show only DeepSeek.** Rejected: the parent's API-key routes are usable by the same native adapters once their selected configuration is present. Hiding those routes would remove the user's intended model choice.

**Build a model proxy.** Rejected for this repair: a new transport, streaming implementation and authentication boundary are unnecessary for native API-key adapters. OAuth-only routes and other adapter families remain unsupported until they have an explicit inheritance mechanism.

## Consequences

The child keeps independent sessions and profile storage while using the parent's selected local model route. Configuration and key changes reach the next round without a parent restart. This does not guarantee a key has quota or network access, and it does not claim support for every host adapter. Processes receive the selected credential, as they already did for DeepSeek; full process isolation from the same OS user is not provided.

Tests cover selection-only credential resolution, missing and unsupported routes, authentication without a DeepSeek key, native error retention, profile expressions and resident replacement with session continuation. Real Kimi execution and continuation are checked separately before deployment.
