# Agent Note: The local-agent cards keep their settings in the harness's own store

Status: implemented

English | [中文](2026-10-27-local-agent-card-settings-store.zh.md)

## Problem

The local-agent settings cards stored their switches and the dsh default model as volatile fields of each provider's row config, written into the profile patch through the host's settings form. On a profile with several mode suites, each suite inserts the same family rows. The host's write check compares against the first duplicate and refuses every write (see [2026-10-27-settings-write-refused-by-duplicate-rows](../bug-fix/2026-10-27-settings-write-refused-by-duplicate-rows.md)). On 3080 and on any community install with two suites, the switches could not be changed.

The dsh card also had a 启用 switch, off by default. The owner found it an extra step: installing the plugin is the intent.

## Decision

- **A per-harness store.** The cards' values live in `card-settings.json` in the harness's default scoped home (`card-settings.ts`), the same place the endpoint credential and the model list already live.
  - The core registry exposes it as `cardSettings` / `setCardSettings` / `onCardSettings`, and the gateway as Remotes of the same names.
  - The provider settings face takes `harness:` and layers the stored overrides over the row config. A stored write reaches the next round through the face's watch.
  - The cards bind `bindCardSettingsScope`: the host form's value with the stored overrides on top. Writes go to the store only.
  - A field absent from the store falls back to the row config, so values a profile already carried keep working without migration.
- **dsh is always on.** The 启用 switch is gone and the harness is always registered; a leftover `enabled: false` is ignored. `subagent_dsh` now ships as the package's `./tool` entry, like the other providers, and the dev, gamedev and video suite presets grant it (`tool-subagent-dsh`). It is no longer mounted at the profile root, which used to grant every session while the switch was on.
- **Resident mode defaults on** for all four providers (`live` schema default and fallback `true`). The switch stays, for falling back to exec when a CLI's resident runtime misbehaves.

## Alternatives considered

**Wait for the host fix.** Rejected: community installs with two suites stay broken until an upstream release; the host fix is still worth filing, since other shared rows (room, worktrees) have the same problem.

**Keep the profile-root tool mount with dsh always on.** Rejected: every session, in every mode, would see `subagent_dsh`.

## Consequences

- The host's generic settings inventory no longer shows changes made on these cards; the cards are the place to edit them.
- The dsh README screenshot still shows the old 启用 switch; retake it at the next README pass.
- Sessions outside the dev, gamedev and video modes no longer get `subagent_dsh`, even on profiles where someone had switched it on.
- Tests cover:
  - the store's read/write and null removal;
  - the face merge and watch;
  - the card scope (form value under the overrides, writes to the store only);
  - dsh always registering, with no root tool;
  - the `./tool` entry registering `subagent_dsh`;
  - the store driving `live` in the real composition.
