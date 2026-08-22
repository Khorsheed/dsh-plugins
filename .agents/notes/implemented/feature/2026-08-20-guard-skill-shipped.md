# Agent Note: the restart protocol ships as a skill; the boot notice broadcast is retired

Status: implemented

English | [中文](2026-08-20-guard-skill-shipped.zh.md)

## Problem

The boot notice injected a "restarts go through the guard CLI" message into every root session at agent creation — unconditionally, on every boot. Since agents are recreated lazily after each restart, every session re-received the notice at its first message after every restart. The broadcast existed because fresh-machine agents, in the guidance vacuum, hand-rolled `sleep/kill/nohup` restart scripts that the instance's teardown reaped. But the push channel costs every session noise on every restart, and the guidance only matters when a task actually involves restarting.

Fresh-machine install testing also showed the pull channel working: the driving agent discovered the protocol through a `dsh-self-restart-guard` skill — but that skill lived in the developer machine's user-global `~/.agents/skills/`, not in the package, and its content hardcoded the development monorepo path (`GUARD="node $HOME/code/dsh-plugins/..."`). Community deployments had no such skill; the broadcast was their only in-session discovery.

## Decision

- The skill ships with the package at `skills/dsh-self-restart-guard/SKILL.md` (added to `files`) and is registered at apply via `ctx.skills.register()` (`src/index.ts` `registerRestartSkill`). The catalog surfaces it exactly when a task smells like a restart — pull replaces push.
- The boot notice (`ctx.on('agent/created')` inject + `bootNoticeText`) is removed. Post-restart followups are unchanged: the report still wakes only the initiating session, and the continue message only the sessions the restart interrupted. Every other session is now fully untouched.
- The skill content is generalized: the CLI resolves from the installed package (`$DSH_HOME/profiles/*/node_modules/@khorsheed/dsh-ankh-guard/lib/cli.js`), the monorepo path and the host-specific per-command escalation name are gone.
- Registration is optional and defensive: compositions without the skill capability skip it (`ctx.get('skills')`), and a missing/malformed shipped SKILL.md degrades to a warning — a discovery aid must never take a boot down. The pack-smoke test owns the file's presence in the tarball.
- The skills registry's runtime-entry rules make this safe on machines that already have a same-named user skill: runtime entries outrank user entries, and same-name runtime duplicates are first-wins with a warning, never an error.

## Alternatives considered

- **Keep the broadcast but deliver once per session ever** (a persisted delivered-set in the state dir) — keeps a push channel whose value is first-contact discovery, at the price of permanent per-session state and a versioning question when the text changes. The skill catalog already provides first-contact discovery with zero state, so the push channel has no remaining job.
- **Embed the skill text as a string literal in the source** — a shipped markdown file keeps the prose reviewable in the standard skill format and lets the pack-smoke test assert its presence; the apply-time read is a few KB once per boot.

## Consequences

- Compositions without the skill capability (exotic minimal trees) lose in-session discovery; the on-install stdout guidance, the CLI verbs' inline hints, and the README remain.
- The user's own `~/.agents/skills/dsh-self-restart-guard` copy is now shadowed by the shipped runtime skill (runtime outranks user); deleting the user-global copy is harmless cleanup.
- Followup wake semantics are intentionally untouched: initiator + interrupted sessions wake, all others stay unaware — now with no injection at all.
