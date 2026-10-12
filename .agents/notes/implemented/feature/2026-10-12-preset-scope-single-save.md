# Agent Note: the preset-scope editor is one Save, the managed root invisible

Status: implemented

## Problem

The scope editor of [preset-scoped skills](../../proposed/feature/2026-09-13-capability-catalog-preset-scoped-skills.md) leaked the delivery mechanism into the user flow: an unmanaged skill offered "移入受管目录并可限定 preset" (adopt), a managed one offered "保存" plus "释放回用户技能目录" (release). Three mechanism-named buttons stood between the user and the one question the section asks — which presets is this skill effective in. "释放" in particular was unreadable without knowing the ownership rule: a managed skill's delivery dies with the plugin, while a released one rides the host's filesystem provider and survives it.

## Decision

The checkerboard is the whole interface. An empty pick means every preset; one Save applies the pick, routing invisibly: adopt for an unmanaged skill with a subset picked, re-scope for a managed one, release back to the user skill root when a managed skill's pick is emptied (an empty scope needs no managed delivery). The adopt/release buttons and their locale strings are gone; the hint states the empty-means-everywhere rule and that emptying + saving restores a plain user skill. Save is disabled while the pick is unchanged — except the managed empty-on-empty state, which stays actionable so legacy managed-unscoped skills keep a release path.

## Alternatives considered

**Keep an explicit release action.** Rejected: releasing is the same intent as "every preset again"; a second button forces users to learn the managed-root concept for one rare transition.

**An "all presets" sentinel chip.** Rejected: an empty pick already says it; a sentinel is a second way to express the same state.

**Default the pick to all-checked for unmanaged skills.** Rejected: all-checked reads as "scoped to everything currently existing", freezing the set against presets added later; empty is the honest unscoped state.

## Consequences

The managed root no longer appears in the primary flow (the "受管目录/释放" copy is gone; the conflict line still names the default root when delivery is refused). One known edge: a skill adopted out of a PROJECT root and later emptied releases into the USER root — the release target was always the user root, and the single-Save flow makes that relocation one click less visible; the hint states the restore. Tests pin the apply routing (adopt / re-scope / release / empty no-op) and both one-Save flows end to end.
