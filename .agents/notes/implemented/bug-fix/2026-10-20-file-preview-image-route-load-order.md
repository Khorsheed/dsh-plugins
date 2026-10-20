# Agent Note: file-preview image route survives load order

Status: implemented

## Problem

`@khorsheed/dsh-file-preview` serves image bytes (png, jpg, svg, …) to the browser through a host route, `/file-preview-image/<session>/<path>`. The `read` verb answers an image with that route's URL; with no route it answers `kind: 'binary'`, and the detail view shows "binary file, no text preview".

The constructor decided whether the route exists with a one-shot `ctx.get('webServer')` / `ctx.get('agents')` probe, while `static inject` named only `fs`. Cordis load order is not guaranteed: when the service applied before either optional service, the probe saw `undefined`, the route was never registered, and nothing ever looked again. On prod 3080 (2026-10-20) every session-product image read as binary — a request to `/file-preview-image/…` got the same empty 404 as an unknown path. The game-dev mode, whose products are sprites and SVG art, made it visible.

## Decision

The route lives in a `ctx.inject(['webServer', 'agents'], …)` sub-fiber. Cordis applies it whenever both services are up, in any order, and disposes it when either leaves. Its effect registers the route and stores the agents registry on the service. Disposal unregisters the route and clears the registry, and image reads degrade back to `binary`. Whether a route URL is issued is now "is the sub-fiber live" (`this.agents !== undefined`), not a constructor-time flag.

Headless compositions are unchanged: without `webServer` the sub-fiber never applies and images read as `binary`, as before.

## Alternatives considered

**Add `webServer` and `agents` to `static inject`.** Cordis 4 has no optional-inject form (the object form maps names to intercept config, all required), so headless faces with no web server would never load the service and would lose the text preview. Rejected.

**Keep the probe and retry on a timer, or probe again on every read.** Probing at read time can issue a URL, but the route still has to be registered at the moment the service arrives, so a lifecycle hook is needed anyway. `ctx.inject` is that hook, and the repo already uses it (`ankh-guard`, `canvas-novel`). Rejected as reinventing the fiber.

**Render SVG client-side from its text, bypassing the route.** Useful as a headless fallback for one format, but it leaves raster images (and future audio/video, which need the same byte channel) broken. Deferred, not rejected.

## Consequences

- Image previews no longer depend on plugin apply order; a host whose web server or agent registry restarts gets the route back automatically.
- The sub-fiber applies asynchronously (one task after the services are present). Tests that construct the service and read an image wait a tick first. `tests/read.spec.ts` pins late arrival and withdrawal: binary before, a route URL after both services arrive, binary again after one leaves.
- The same route is the planned byte channel for audio/video previews (range requests); that work builds on this lifecycle rather than a second probe.
