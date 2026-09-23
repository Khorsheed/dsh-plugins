# Agent Note: a preset scope only where the host will write one

Status: implemented

## Problem

The skill detail modal in `@khorsheed/dsh-capability-catalog` grew an
「生效的 preset」 section with the preset-scope delivery work: a checkbox per
preset, a 保存 button, and — for a managed skill — 释放回用户技能目录. It rendered
that grid for **every** skill.

The host writes that scope in exactly one place: `setManagedPresetScope` rewrites
the `presetScope` frontmatter of a skill inside the plugin's own managed root, and
answers `"<name>" is not a managed skill` for anything else. A plugin-provided
skill (`source: runtime`, e.g. `3d-artifact` from `inline-html-render`) or a
built-in one (`source: bundled`) therefore got a control whose Save could only
fail, presented as if its modes were the user's to choose. Which modes load such a
skill is decided by the **plugin's own row in each preset's composition** — a
fact the UI had, and did not show.

The same modal also offered 保存 for a skill sitting in a user/project root, where
the only write path is `presetScopeAdopt`: the ticks are the scope the adopt would
install with, and Save was likewise a refusal.

## Decision

`scopeEditorFor` now carries `writable` (managed **or** adoptable) and `provider`
(the row's provider), and the modal branches on them:

| row | section |
|---|---|
| managed root | grid + 保存 + 释放回用户技能目录 |
| user / project / custom root | grid + 移入受管目录并可限定 preset, no 保存 |
| plugin-provided `runtime` | an explanation naming the plugin that decides |
| built-in `bundled` | an explanation that the deployment decides |
| no roster / no managed delivery | the existing unavailable note |

The section is kept rather than hidden for the non-writable rows: a skill that
silently has no editor is a question the user cannot answer from the UI, while the
one-line explanation ("由插件「inline-html-render」提供：…不能在这里单独限定")
answers it and points at the mode view, which shows where it actually loads.

## Alternatives considered

**Hide the section for non-writable skills.** Simplest, and the option the panel
owner's own wording invites. Rejected because the absence is the confusing state:
the same modal shows the editor for the neighbouring skill, and nothing on screen
says why. A stated reason costs one string per language.

**Keep the grid but disable it.** A disabled grid still claims the scope is a
thing this skill has; the claim is what was wrong, not the interactivity.

**Make the host write scopes for plugin-provided skills too.** Out of this
plugin's remit: those skills are registered by their plugin, and which modes load
them is composition, not a per-skill file the catalog owns. Reaching into another
package's skill source would also break the catalog's "consumer of the registry,
never a contributor" boundary.

## Consequences

- The preset-scope editor stops producing a class of avoidable write failures
  (`is not a managed skill`) and stops implying a capability the deployment does
  not have.
- One more field travels to the modal (`writable`, `provider`), so the card's
  scope-editor face is a description of the skill, not just of the deployment.
- A deployment with no roster still shows the unavailable note; the honesty fix
  does not change that path.
- Tested in `tests/capability-catalog-card.client.spec.tsx` (the plugin-provided
  and managed cases render the note / the grid and Save respectively) and in
  `scopeEditorFor`'s unit cases.
