# Agent Note: hotfix — the shipped skill failed to LOAD (missing `source` in the registration)

Status: implemented

English | [中文](2026-08-22-skill-source-hotfix.zh.md)

## Problem

Published 8.9 listed `dsh-self-restart-guard` in the skill catalog, but invoking it failed with `loaded skill "dsh-self-restart-guard" source must be a string`. The registry validates `source` at LOAD time, not at registration: the catalog path never checks it, so the omission was invisible in every earlier verification (catalog listing passed; nobody invoked the skill in the fresh-machine runs until a user typed "重启你自己" on the demo instance). Root cause on our side: a structural `SkillRegistrySlice` cast narrowed the registration to `{ name, description, content }`, bypassing the real `SkillRegistration` type where `source: SkillSource` is required.

## Decision

- The registration passes `source: 'runtime'` (the runtime bucket — consistent with the registry's own runtime-provider default).
- New round-trip test against the REAL `SkillRegistry` (`@deepseek-ai/dsh-skill`, added as a devDependency): catalog list AND `registry.get` body load. Negative-verified: reverting the fix reproduces the exact production error.
- The payload assertion (`source: 'runtime'`) stays as the cheap contract pin.

## Alternatives considered

- **Fixing it in the harness instead** (default `source` inside `register()`) — that is the better upstream hardening and goes through the upstream-change pipeline, but the published artifact needs the explicit field regardless; both are worth doing, ours ships now.
- **Waiting for the composition-rollback branch** — no: 8.9 is published and the skill is broken for the community; this is a standalone hotfix branch off main.

## Consequences

- Any other runtime-skill registration anywhere must carry `source`; the round-trip pattern (list + get against the real registry) is the template for testing them.
- The hotfix needs a patch release over 8.9; version cutting stays with the maintainer.
