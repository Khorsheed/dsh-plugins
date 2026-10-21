# game probes (throwaway)

Pre-implementation probes for `proposals/active/2026-10-09-gamedev-mode.md` §8. Not a package; nothing here ships.

| File | Probe |
|---|---|
| `vfs-boot.js` | In-sandbox loader: blob URLs minted inside the opaque-origin frame, module/CSS rewriting, `fetch` / element `src` shims, bridge re-installed after `document.open()` |
| `fixture-game/` | Multi-file fixture (nested + dynamic imports, JSON via fetch, `<img>`, `new Image`, CSS `url()`) |
| `p0-1-sandbox.mjs` | P0-1: panel-like page + `sandbox="allow-scripts"` iframe, files by postMessage |
| `p0-2-headless.mjs` | P0-2: capture's `CaptureBrowserManager`, scripted playtest, determinism, error capture |
| `m1-walk/` | M1 walkthrough on a temp instance: `scripted-llm.mjs` (an OpenAI-compatible model that creates the project, writes a first version whose test fails, then reads and fixes it when the check comes back), `drive.mjs` / `prompt.mjs` (RPC), `shot.mjs` (UI screenshots), `game-files.mjs` (the demo game), `walk2.mjs` / `rows.mjs` (workbench walkthrough and conversation-row screenshots), `proto-shot.mjs` (screenshots of the interaction prototype for comparison), `hdr.mjs` (header layout measurement) |
| `probe-plugin/`, `fake-llm.mjs`, `p0-345-drive.mjs`, `p0-3-render.mjs` | P0-3/4/5 on a throwaway instance: `agent/pre-step` attach, `agent/turn-stopping` + `steer` with a cap of 2, `turn/end` logging; fake OpenAI-compatible model logs what the model received |
| `blender/` | 3D asset path B (2026-10-21): `bake.py` turns a parts recipe (`fox.recipe.json`, the nine-tailed fox) into a rigged, animated `.glb` with an inverted-hull ink outline plus a preview PNG, headless (`blender -b -P bake.py -- fox.recipe.json out`); `three-check/load.mjs` loads the glb through three.js `GLTFLoader` and steps the idle clip (`npm install` inside `three-check/` first; `out/` is scratch) |

Generate the fixture images first with `node gen-png.mjs` (images are gitignored). Run P0-1/P0-2 with `PUPPETEER_CORE=<path to puppeteer-core.js>`, `CAPTURE_LIB=<packages/capture/lib/index.js>`, `CHROME=<chrome executable>`.
