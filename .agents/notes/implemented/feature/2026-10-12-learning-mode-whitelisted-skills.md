# Agent Note: learning mode's whitelisted skill face

Status: implemented

## Problem

bundle-learning's preset dropped the skill surface wholesale (`tool-skill` + `skill-filesystem`) because the skill registry would surface every unrelated local skill into a learning session. The cost showed up once [preset-scoped delivery](../../proposed/feature/2026-09-13-capability-catalog-preset-scoped-skills.md) existed: a skill explicitly scoped to `learning` (weread-skills) was delivered correctly into the preset's scope layer, yet the session had no skill tool and no catalog injection — the model could never know the skill existed.

## Decision

The preset mounts `tool-skill` only — never `skill-filesystem`. With no default-root provider in the composition, no local skill enters the registry from this preset at all; a learning session sees exactly the skills the capability catalog's managed delivery scopes to `learning`. Scoped delivery turns the old all-or-nothing choice into a whitelist. `tool-skill` injects `agents`/`tools`/`skills`, all resolvable up the scope chain (the registry is root-mounted), so the row needs no config and no companion provider. The catalog refreshes the session's catalog at every pre-step boundary and the registry has no per-session cache, so a newly scoped skill reaches already-open learning sessions on their next step.

## Alternatives considered

**Keep learning skill-free and guard the catalog UI** (mark skill-less presets as not scope-able). Rejected as the primary move: scoping a skill to learning mode is a legitimate intent, and the whitelist composition makes it safe. The guard remains a valid complement for future skill-less presets.

**Mount the standard pair (`tool-skill` + `skill-filesystem`).** Rejected: it re-opens the floodgate the diet was created to close — every default-root local skill would surface in learning sessions.

## Consequences

Skills become a deliberate grant in learning mode instead of an impossibility, at the price of one more mounted row. Because fs stays dropped, a scoped skill's bundle files (`search.md`, `notes.md`, …) stay unreadable — only its SKILL.md reaches the model; whether a read-only bundle-file channel is worth adding is deferred to observed need. The bundle spec now pins `tool-skill` present and `skill-filesystem` absent.
