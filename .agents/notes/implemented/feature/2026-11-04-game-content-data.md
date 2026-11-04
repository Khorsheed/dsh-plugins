# Agent Note: game content data in design JSON, and preview states

Status: implemented

## Problem

The 3D game being built with the plugin outgrew writing content in code. Its scenes, quests, element interactions and world states moved into JSON (`design/scenes/*.json`, `design/quests/*.json`, `interactions` fields in element files), and an interpreter in `src/` executes that data. Two plugin walls showed up. First, the build left out all of `design/`, so the game could not fetch its own data and kept a hand-copied module in `src/`, plus a test asserting the two copies stayed equal. Second, the turn checks run only browser `tests/*.test.js`, so the game's node `.mjs` tests over that data never gated a version. The game also implemented `dshGame.preview({ scene, state })` to jump straight into a world state, which the panel had no way to reach.

The game agent first proposed that the plugin ship a fixed vocabulary of conditions and effects (`setFlag`, `giveItem`, `grantSketch`, curiosity thresholds…). That vocabulary belongs to one game's subject matter, and the [boundary note](../architecture/2026-10-25-game-plugin-boundary.md) keeps the plugin generic.

## Decision

- **The vocabulary is the project's.** The game defines its own conditions, effects and their parameters, and its own interpreter runs them. The plugin ships no subject-matter vocabulary. Data never carries JavaScript.
- **Design JSON is built.** `isBuildFile` now accepts `.json` files anywhere under `design/`; design prose (`.md`, concept `.html`) still stays out. A change to one counts as a code change: it goes through the checks and becomes a candidate. The sandbox's `fetch` shim already serves any built file, so `fetch('design/…json')` works in play and in the checks. The data checks fail a design JSON file that does not parse; its meaning stays the game's to test.
- **Preview states.** A game may expose `dshGame.previews` (an array, or a function returning one, of `{ scene, state, label }`) and `dshGame.preview({ scene, state })` (returns `false` when it refuses). On every run the panel asks for the list through the bridge (`previews` message). When the list is non-empty, the play view's stage bar shows a 预览状态 menu. Choosing an entry restarts the run and, once `dshGame.ready` is true, sends `enter-preview`; the bridge reports `previewed` with `ok` and `supported`, which become a toast. Restart and Stop return to a normal run.
- **Declared vocabulary, checked references** (C2). A project may add `design/schema.json`. `src/content-schema.ts` reads it and, during the data checks, reports every reference that does not resolve, with its file and path. The declaration lists `ids` (namespaces taken `from` a data path or `"elements"`, a fixed `list`, or a `map` of aliases to element ids), `refs` (which paths must hold which namespace), `conditions` and `effects` (parameter tables), and `slots` (which paths hold conditions or effects). The plugin itself knows only the grammar: `file-glob#path` sources with `name[]`, `*` and `@`; the types `string / number / boolean / any`, `a|b`, `map<T>`, `list<T>` and `?`; the built-in `all / any / not`; and `clip(param)`, which reads clip names from the glTF that an element (or alias) points to. Values starting with `$` are runtime parameters and are skipped. Undeclared effect parameters are errors, so a typo cannot pass. Near misses get a «是不是…» hint. The draft was checked against the game's real data, which passes.
- **Tests can import project modules.** Test files get `importModule(path)`, so a game can test its interpreter directly instead of reaching for the loader's internal `window.__dshFileUrl`.
- **Skill.** `gamedev` gains a 内容数据 section (scenes, quests and interactions as data, an interpreter in `src/`, load-time validation, fetch instead of copying, reachability as tests). It also documents the two optional `dshGame` members and says plainly that only browser `tests/*.test.js` run in the checks, so data tests should be written there. It also documents the `schema.json` grammar with a subject-neutral example, and `importModule`.

## Alternatives considered

**A plugin-defined condition/effect language.** This was rejected because it ties the plugin to one genre: the next game would either not use it or need the plugin extended for every new verb. A declared, project-owned schema that the plugin can check references against is the planned next step instead.

**A separate `content/` folder outside `design/`.** The game had already put its data under `design/`, next to the design chapters it is described in, and only JSON files enter the build, so the design prose stays out of versions.

**Run the project's node tests in the checks.** The host would run project code outside the sandbox. Browser tests can already read the data through `fetch`.

**Enter the preview in the running game without a restart.** A preview reached from a fresh run is reproducible. One layered over whatever the player had been doing is not.

## Consequences

- The game can drop its copied data module and its consistency test, and rewrite its data tests as `tests/*.test.js`.
- Next: the element page shows and edits nested interactions by the declaration (C3), and warns which data references an element before it is deleted.
- The preview menu appears only when the running game offers a non-empty list; older versions and games without the hook show nothing new.
