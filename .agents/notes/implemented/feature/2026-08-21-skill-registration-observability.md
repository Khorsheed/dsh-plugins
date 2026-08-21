# Agent Note: skill registration is observable (check-env line + loud absence)

Status: implemented

English | [中文](2026-08-21-skill-registration-observability.zh.md)

## Problem

A host migration (the 0.1.1-rc.1 adaptation) lost the shipped restart-protocol skill, and nobody noticed until a human looked: the unit test, the pack smoke, and the runtime-degrade warning all guard the package inside its own repository, but a migration that repackages or rewires the host never runs those gates. The skill's absence produced no signal anywhere — the optional-consumption pattern (`ctx.get('skills')` → silently skip) made even the "capability gone" case invisible.

## Decision

- Every boot records the registration outcome to `skill-registration.json` (`writeSkillRegistration`, atomic, best-effort): `registered: true`, or `false` with a reason (`skills service absent`, `SKILL.md` malformed/unreadable).
- `check-env` prints it as the `skill:` line — registered / NOT registered (with reason) / not recorded — next to the supervision and start-command answers, so any agent touching the deployment sees the state in one call.
- A composition without the skills service now logs a boot warning instead of skipping silently.

## Alternatives considered

- **More repository-side tests** — they only guard code that stays in the repo; the loss happened exactly outside that perimeter. (The complementary repo-side gate — `files` must cover every runtime-read asset directory — and the migration smoke checklist were handed to the monorepo maintainer.)
- **Querying the live registry from the CLI** — the CLI runs outside the instance process; a durable boot-time record is the only channel both sides share.

## Consequences

- `check-env` output gains one line; parsers scraping it positionally should switch to key prefixes.
- The marker is observability, never a gate: registration still degrades rather than blocking boot.
