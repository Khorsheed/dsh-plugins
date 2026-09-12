# Mobile shared header acceptance — 2026-09-13

## Environment

Candidate mobile client substituted only in the test browser, with the official running 3080 Host and its existing session APIs. WebKit viewport: 393 × 852; a second 393 × 500 viewport checks the rename dialog under keyboard-sized height. Public transport was separately exercised in clean WebKit and Chromium contexts. No model prompt or real session rename was submitted during this acceptance.

## Results

- Package build passed; 82 tests passed. Coverage includes Rooms/ordinary header parity, retaining unknown plugin actions and lineage, official rename binding/pinning/refusal/retry, duplicate-submit protection, horizontal versus vertical/multi-touch motion, tap suppression, sidebar owner callbacks, pinned wide layout, and nested preset menu cleanup.
- The reported Room shows workspace and development mode in the subtitle. Finder is hidden; the remaining header preserves Room/child and branch controls. Body width equals the 393 px viewport.
- Rename is a modal with no Host inline header input. Its input receives focus while the composer does not. The document remains at scrollY 0. Dialog rectangle is 353 × 262 at x=20, y=295 in the full viewport; y=119 in the 500 px viewport. Dark and light surfaces were visually inspected.
- Dragging a conversation row left closes the library and returns the main panel to x=0. The following unrelated button remains usable. Wide layouts retain their fixed two-column geometry.
- Preset option border widths are 0, 1, 1, 1, 1 px. Existing option callbacks and selection behavior are retained.
- Public WebKit and Chromium both loaded the reported Room with 1,961 transcript-area characters and no observed Remote stream carrier error. This is successful reloading evidence, not proof of the original incident's cause or repair.

## Limits

Browser-dispatched touch events verify gesture ownership and resulting geometry; physical finger inertia and native keyboard animation still need user/device confirmation. The new UI does not include a speculative gateway repair. The error text originates from the gateway's stream-frame receive/parse/dispatch catch and alone cannot identify which payload, parser or client condition failed.

## Production receipt

- Implementation commit: `f261e98d`; integrated with current main in `4007236a`. Scoped pre-merge gate passed all 14 steps. Docker integration remained skipped because no Docker daemon was available.
- A fresh task appeared after the first idle check; deployment was deferred until a second authenticated check reported zero running sessions and zero jobs.
- `pnpm deploy:3080 --package packages/mobile` completed successfully: package build/tests, composition preflight, guarded restart and authenticated canary all passed.
- The unmodified public WebKit page then repeated the header, rename, library gesture, preset divider and Host workspace-sidebar checks successfully, with no page errors. Preset dividers measured 0/1/1/1/1 px; the workspace sidebar opened visibly and closed through its owner callback.
- The Host's internal-test notice appeared again when entering a new conversation; acceptance used its normal Continue action before checking the picker. This was not a mobile picker failure.
- No native reinstall or Host source edit was required for this batch. Physical finger feel remains a device acceptance item.
