# Agent Note: story-bible's agent surface is preset-only, and bundle-writing is the grant

Status: implemented

## Problem

M1/M3 shipped the agent surface the canvas way: the `story-bible-agent` row live at the profile root, so EVERY session — a debugging chat, a translation task, an unrelated code review — carried three novel-writing tools in its tool list, a story:pointer prompt section, and a story skill in its catalog. Tool-list pollution is not cosmetic: every registered tool is schema the model reads every turn, and a writing tool offered out of context invites the model to file memories into a work the user never meant to touch. The requirement landed explicitly: story's agent capabilities (story_read/write/extract, the pointer section, the story skill) must exist ONLY inside a writing preset's scope; the core (store, Remote, the two tabs) stays global.

## Decision

### The shipped default is "root row disabled, grant by preset"

story-bible's `cordis.patch.yml` keeps the core row enabled and ships `story-bible-agent` with `disabled: true` at the profile root. Installing the package therefore grants nothing — the only correct enablement is a preset naming the same composition entry (`@khorsheed/dsh-story-bible/agent`) in its own scope, exactly the recipe canvas's patch documents for `@khorsheed/dsh-canvas/agent` (and exactly how `@khorsheed/dsh-presets`' `preset-dsh-writing` grants it). The patch's comments spell out the one misconfiguration that breaks boot: the root row enabled AND a preset grant live at once register the same tool names twice. No runtime defense is added — canvas carries the same rule as documentation, and the failure is loud at boot, not silent.

### bundle-writing is a declarative preset bundle, not a family bundle

`packages/bundle-writing` (@khorsheed/dsh-bundle-writing) is `dsh.bundle.kind: 'preset-declarations'`: ONE `@deepseek-ai/dsh-agent-preset` row, loader id `preset-writing`, no runtime code. The preset config composes:

- **persona** — the collaborative-editor stance (task draft: probe ideas, ledger-and-cast on the table when planning, canon and consistency when writing, honest reconcile reports; assets come from the story_* tools, never from conversation memory), kept light and single-voice English per the community preset convention — the workflow stays the story skill's, uncopied;
- **the grant** — `story-bible-agent` mounted in scope (the entry resolves `storyBible` up the scope parent chain from the global core row; with story-bible absent the grant stays inert — zero registration, no throw);
- **the writing tool list** — tool-fs (the manuscript's read/write/edit), skill-filesystem + tool-skill (how the story skill loads), tool-ask-user (the human gates), and the compaction group copied verbatim from preset-dsh-writing's proven shape. Shell, fs-search, delegation, jobs, todo, web, goal and agent-instructions stay out: the writing flow never drives them, and a preset's value is precisely the tools it does NOT offer.

The reference is one-way data: `dsh.references: ['@khorsheed/dsh-story-bible']`, never an npm edge — installing bundle-writing alone must stay inert (a dependency would pull story-bible's module in without mounting its core row, composing a preset whose grant points at a service nobody provides; the profile's two-package install is the honest contract: story-bible gives the surface, bundle-writing gives the grant).

### Proof is composition-level, not shape-level

`tests/preset-scope.spec.ts` boots REAL registries (SystemPrompt + ToolRuntime) with the story core and mints a scope with dsh-scope's `createScope` — the same mechanism the preset realm uses — then asserts: the shipped default leaves the root assembly with no story_ tool, no story:pointer section, no story skill; mounting `./agent` inside the scope grants exactly that scope (all three, the pointer as a function section rendering '' unfocused and the one focus line once focused) while the root assembly stays clean. `tests/patch.spec.ts` (story-bible) and `tests/bundle.spec.ts` (bundle-writing) freeze the patch shapes and the references contract (the presets.spec idiom).

## Alternatives considered

**Keep the canvas default (root row enabled) and let profiles opt out.** The M1/M3 status quo. Every profile that installs story-bible pays the pollution unless it hand-edits a disable — the wrong default for a capability whose whole point is a scene boundary. The writing preset only composes cleanly when the community default is "not granted".

**Ship no agent row in the patch at all.** Cleaner still, but the row's existence and its enable path would be invisible to operators; the disabled row documents the grant point where the loader reads it, and enables the one-line "every session" opt-in for profiles that want it (with the double-mount warning attached).

**Make bundle-writing a family bundle depending on story-bible.** A family edge would install story-bible's module transitively — but `dsh plugin add` reconciles only DIRECT dependencies, so story-bible's core row would never mount and the preset's grant would point at an absent service. The AGENTS.md reference-not-edge rule exists for exactly this shape; the two-package install is documented in both READMEs.

**Copy preset-dsh-writing's full tool list (shell, web, todo).** Its contracts serve general writing; the novel flow's model writes only the manuscript and the store. Shell invites filesystem drift outside the fenced store, and every kept row is a row the model can reach for instead of story_* — the diet is the design.

## Consequences

- story-bible alone now delivers UI + data with zero agent trace; bundle-writing is the smallest possible grant. The two READMEs carry the install/enable recipe; the proposal's §0 table gained the bundle row (gitignored, edited in place).
- The canvas-recipe documentation finally has a second consumer, which validates the convention: `./agent` entry, root-disabled row, preset-scoped grant.
- `docs/packages.md` regenerated (39 packages); no other repo-level registration was needed (a preset-declarations bundle carries no typert face, no client half, no invariant).
- Unchanged and deliberate: the pointer section stays a function section evaluated per assembly, so even inside the writing preset an unfocused session costs zero tokens; the double-mount rule remains documentation-level (canvas's own stance) because the failure mode is a loud boot error, not a silent one.
