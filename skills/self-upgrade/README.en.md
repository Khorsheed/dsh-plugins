# @khorsheed/dsh-self-upgrade

[English](README.en.md) | 中文

Host-upgrade self-guidance skill pack. Once installed, telling the agent "upgrade this instance to 0.1.2" is enough for it to run the whole playbook autonomously: **fetch the new host into a separate checkout → inventory the plugin breakage surface → apply dual-line-compatible fixes → verify on a live instance → safely self-restart and resume the conversation**.

## Form

A plain skill directory (no plugin wrapper): `SKILL.md` plus `reference/` docs and executable `assets/`. Install it by importing through capability-catalog (zip or GitHub) or dropping the directory into the host's skills directory; an agent **pulls** it whenever a task smells like an upgrade. No host half, no client face, no config, no persistent state.

Skill outline (full text in `skills/self-upgrade/SKILL.md`):

- **Ground rules**: never modify the running host's checkout in place; probe features, never version numbers; green typecheck is not runtime-clean.
- **Breakage inventory**: externalized deps / the module seed table, slots, Remote, settings, skills, command signatures, DOM anchors, prompt-order anchors — plus the compile-time blind spot where deleted named exports still typecheck.
- **Fix discipline**: dual-seat probing, anchoring renamed brand types to consumer APIs, inlining deleted value imports (only when no cross-boundary identity), degrade-never-explode.
- **Verification ladder**: package level → composition level → live acceptance (fresh home + zero plugin errors in the browser console) → delivery level (install from zero via the README).
- **Self-restart**: with ankh-guard, ride its guarded restart; without it, write the handoff note first, then spawn a fully detached supervisor (`skills/self-upgrade/assets/restart-resume.mjs`: self-detaching on any platform with node — waits for the old process to die → boots the new host → health-checks, treating any HTTP answer as alive so the 0.1.2 token gate is not misread → rolls back to the old checkout on failure). Trial boots use `trial-boot.mjs` in the same directory.
- **Failure fallback**: any failed rung stops the line with a report; a failed restart is rolled back by the supervisor.

## Install

```sh
Import through capability-catalog (zip / GitHub import) or drop this
directory (minus `tests/`) into the host's skills directory — no package
machinery involved.
```

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.1-rc.2`): ✅ full — consumes only the skills registry (`ctx.inject(['skills'])`, wait-style registration), unchanged within this API audit.
- Source line (deepseek-harness master): ✅

## Known limitations

- In a minimal composition without the `skills` capability the skill is simply not registered (no error — one discovery channel fewer).
- The skill is **process guidance**, not a substitute for judgment: it hands the agent the methodology and the supervisor script; the concrete migration map for a given target version is still produced on the spot.
