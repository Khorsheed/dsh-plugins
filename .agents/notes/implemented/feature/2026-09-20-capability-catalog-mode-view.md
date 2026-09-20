# Agent Note: the capability catalog's mode view

Status: implemented

## Problem

`@khorsheed/dsh-capability-catalog` read the skill and tool registries at exactly
one read position: the **deployment default agent preset's standing scope**. That
is the view the settings tab has always shown, and `snapshotFor(presetId)` already
existed for the *fingerprint* path (an eval condition declares `preset: X`, and
something checks the claim instead of believing it), but nothing in the browser
half could ask it.

The question a user actually asks is comparative — 这个工具/skill 会在哪些模式下被
加载? The instance this was built against composes sessions from seven presets
(标准 / PTC / 极简 / 创造 plus 开发 / 评测 / 写作), and a capability only one of them
registers is invisible in the default mode's grid. In the old UI that is
indistinguishable from a capability that does not exist anywhere: the tab could
not say "this exists, in that mode".

## Decision

The tools-and-skills section carries a **mode control** beside the search and
sort controls, with one option per agent preset plus a comparison, and two new
Remote verbs behind it.

### `snapshotAt(presetId?)` — the listing at one mode's scope

`snapshot()` was `collect(undefined, workdir, false)`: the default preset's face,
as a listing. `snapshotAt(presetId)` is the same call with the scope named. The
listing/fingerprint split stays where it was — `snapshotFor` is still the only
verb that loads every skill body and stamps `sha`, because a viewer wants rows as
fast as the registries produce them.

A read that could not resolve the requested preset degrades exactly like
`snapshot` does: the global layer, with NO `preset` stamp. The stamp is therefore
the UI's honest signal — the card renders 「该模式当前无法加载…显示的是全局层」
instead of labelling the fallback with the mode's name (`modeFellBack`).

### `modeFaces()` — every mode in one call

`src/modes.ts` owns the whole answer and is pure over its inputs: `modeOptions`
projects the roster (preserving its order, marking `defaultId`) and
`readModeFaces` reads one face per option. The service supplies the reader, which
returns `undefined` whenever the read's own `preset` stamp is not the id it asked
for — so a degraded read becomes `unavailable`, never an empty face.

Two claims are deliberately not collapsed:

- a **broken preset** is not read at all (discovery already refused it; a mount
  attempt would be wasted) and keeps its row with the reason;
- an **unreadable preset** keeps its row with a reason too.

"This mode loads nothing" and "this mode could not be read" differ, and a union
that merged them would understate where a capability is available. The client
half's `buildModeComparison` (`src/client/mode-model.ts`) excludes unread modes
from the union, reports them separately, and gives each capability the **default
mode's row** when the default mode also has it — otherwise a card's prose would
depend on roster order.

### The cost is paid deliberately

Resolving a preset's standing scope MOUNTS its composition (the roster's
single-flight standing mount). There is no cheaper honest source: a composition
file names the plugins a mode loads, not the tools and skills those plugins
register once they run, and the origin tags that could approximate it cover only
tagged plugin tools — never skills. So the guarantee is about *who* pays:

- the default mode is already mounted in practice (the session runs on it);
- the comparison — the only path that composes presets nothing has mounted — is an
  explicit choice in the picker, and the note beside it says so.

### The read position follows the card

`detail`, `readSkillFile` and `deleteSkill` take an optional `presetId`, and the
card passes the mode it was opened from (in the comparison, the default mode when
it has the capability, else the first mode that does). The same skill name can
resolve to a different bundle in another mode, so a detail read or a delete that
silently used the default mode would act on the wrong file.

## Alternatives considered

**Derive the faces from `compositionInventory()` without mounting.** The official
session-plugins panel answers a neighbouring question this way, and it never
composes anything. It answers a different question: it lists the plugin ROWS a
preset names, not the capabilities those plugins register. Cross-referencing rows
back onto capabilities needs an owner per capability — the origin tag exists for
tagged plugin tools only, and a skill has no owner at all — so the answer would be
a partial attribution presented as a complete one. Rejected: the feature exists to
be authoritative about tool and skill membership.

**Read every mode eagerly on open, so the chips are always there.** Rejected: it
would compose every preset in the deployment (with its watchers and connectors)
merely because a settings tab was opened. The comparison is one click away and
says what it costs.

**Ship only the mode switcher and skip the comparison.** The switcher answers
"what does mode X have"; the ask was "which modes load X". Both are one control.

**A per-capability `presetScope` UI instead of a read position.** That already
exists for managed skills (the delivery policy), and it is a *different* claim:
policy says where a skill is delivered, the mode view says where it was actually
found. The two disagree exactly when the interesting thing happens (a conflict, a
broken mode, a plugin-provided skill), so the card shows both.

## Consequences

- `list_capabilities` and `snapshotFor` are untouched: the model-facing tool still
  answers in the caller's agent scope, and the fingerprint path still refuses to
  degrade.
- Reading a preset through the UI can compose it. That is a side effect a settings
  tab can have for the first time, and it is bounded by the roster size, paid
  once per process, and gated behind the explicit comparison choice.
- The mode control renders nothing when the composition mounts no agent-preset
  service (or supplies no presets), which is the same degradation the scope picker
  already had.
- The comparison's union is a **union**: a capability loaded by no mode (a managed
  skill scoped to a preset that is not in the roster, say) stays visible through
  the managed-root rows, as it was before.

## Related

- [preset-scoped skills in capability-catalog](../../proposed/feature/2026-09-13-capability-catalog-preset-scoped-skills.md)
  — the delivery-policy side of the same axis.
- [a preset scope only where the host will write one](../bug-fix/2026-09-20-preset-scope-editor-write-path.md)
  — the correction this work surfaced in that modal.
