---
name: 3d-artifact
description: Generate sandbox-runnable interactive 3D / digital-twin single-file HTML that obeys the strict sandbox CSP — self-contained, zero runtime network, GLB-inline zero-fetch models. Load when the task asks for a 3D visualization, simulation, digital twin, or WebGL scene delivered as one standalone HTML page.
---

# 3d-artifact — generating sandbox-runnable interactive 3D / digital-twin single-file HTML

## When to load

Load this skill when the task asks to produce a **self-contained HTML page that renders 3D content** — visualizations, simulations, digital twins, WebGL scenes (three.js, etc.) — that must run inside a sandboxed preview iframe under a strict CSP (e.g. the dsh file-view / deliverables preview).

## The hard contract — violations fail silently in the sandbox; this is the #1 cause of "dead" artifacts

1. **Single file, fully self-contained.** All JS/CSS inline. Images as `data:` URIs. No external stylesheets or fonts.
2. **Zero runtime network.** No `fetch` / XHR / WebSocket / EventSource. Never `loader.load(url)`.
   - 3D models MUST be inlined as **GLB base64** and decoded by hand: `atob` → `Uint8Array` → `GLTFLoader.parse(arrayBuffer, ...)`.
   - **Never** embed a `.gltf` JSON whose buffer uses a `data:...` URI. three.js's GLTFLoader resolves `data:` URIs through `fetch`, which the sandbox CSP (`connect-src 'none'`) blocks — verified against three r152.
3. **Libraries may load only from whitelisted CDNs** (the CSP's `script-src` allows exactly these): `https://cdn.jsdelivr.net` and `https://cdnjs.cloudflare.com`. Use ESM + an inline `<script type="importmap">`. Never derive a resource URL from user/data input at runtime.
4. **Embed this Tier1 CSP meta tag** in `<head>`:

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; worker-src blob:; object-src 'none'; base-uri 'none'; form-action 'none'; upgrade-insecure-requests; block-all-mixed-content">
```

5. **Size red lines**: GLB ≤ 6 MB raw (≈8 MB base64); total page ≤ 16 MB. Base64 inflates ×4/3. Prefer procedural geometry, SVG, and compressed textures (KTX2/DRACO) over big assets.
6. **Performance**: cap `renderer.setPixelRatio` (≤2); keep the scene interactive within ~1 s of load; prefer `InstancedMesh` for repeated objects (vehicles, clamps, turbines); defer heavy DOM with `content-visibility`-style techniques; merge many small geometries (e.g. `BufferGeometryUtils.mergeGeometries`).

## Recommended stack

- three.js ESM + OrbitControls via the importmap pattern:

```html
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.152.2/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.152.2/examples/jsm/"}}</script>
```

- Procedural geometry + vertex colors beat downloaded assets for reliability and size.

## Self-check before finishing

- [ ] No external URL anywhere except whitelisted CDN scripts used by the importmap.
- [ ] No `fetch(` / `XMLHttpRequest` / `WebSocket` / `loader.load(` anywhere in the page.
- [ ] Any model is GLB base64 decoded via `atob` → `parse(arrayBuffer)` — never a `data:` URI buffer.
- [ ] The Tier1 CSP meta tag above is present in `<head>`.
- [ ] Page + all inline assets ≤ 16 MB.
- [ ] Opens and renders in a plain browser within ~2 s — that is the sandbox experience.

## Authoring tips for realism (超写实 / 数字孪生 scenes)

- Golden-hour lighting: warm directional sun + hemisphere fill + exponential fog for depth.
- ACES filmic tone mapping + sRGB output (`renderer.outputEncoding`).
- Layered composition: hero object (bridge), midground (valley, road), background (mountain silhouettes, turbines, power towers), atmosphere (fog, mist).
- Digital-twin overlays read best as translucent DOM panels + in-scene markers (sensor nodes, point clouds, BIM wireframes, heatmaps, drone paths).
