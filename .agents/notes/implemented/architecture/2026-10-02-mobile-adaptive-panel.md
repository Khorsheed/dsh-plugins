# Agent Note: Retained adaptive file panels

Status: implemented

## Problem

The local-files sidebar kept a 300-pixel tree beside its preview in phone-sized containers. The remaining preview became unreadably narrow. Repeating mobile-only copies of every plugin view would multiply maintenance and risk losing selection or drafts on layout changes.

## Decision

The source-plane content-preview library exports `AdaptiveSplit`. It observes its own container, shows one retained surface below 560 pixels, and shows both surfaces above that threshold. Opening a detail on a narrow container focuses its back action; returning restores the originating control when available. Both surfaces stay mounted, so child state and scroll containers survive navigation and resizing. Zero-width observations from a hidden tab are ignored. Without ResizeObserver, the initial measurable width is used; if it cannot be measured, both surfaces remain available.

Local-files uses this component with its existing FileTree and ContentPane. File selection opens detail; the back action restores the tree. Session or root changes return to the tree. Wide mode retains the existing divider, with the master capped at 45% to reserve room for content. No runtime plugin dependency or host API is added.

The runnable fixture imports the actual shared component and uses mock file/content data. Start it from the repository root with `node packages/ui-content-preview/examples/adaptive-split/serve.mjs` after installation. It listens only on loopback at port 8873; `MOBILE_PREVIEW_PORT` overrides the port. The runner reuses Vite from the workspace's Vitest dependency. It does not connect to a host instance, change a profile, or represent full plugin integration acceptance.

## Deferred

This branch is the first shared-layout slice, not a completed mobile migration. Remaining scope is grouped by owner:

| Owner | Remaining work | Acceptance |
| --- | --- | --- |
| mobile chrome | Put a panel action beside new conversation; title rename remains discoverable; use an optional public sidebar service with a fallback | Both actions fit at 320 pixels; no missing-capability boot failure |
| official sidebar shell | Full-width mobile panel page, compact tab switcher, add/close panels, return to chat | Preserve tab selection and nested navigation; host changes use the upstream pipeline |
| shared file surfaces | Adopt retained master/detail in worktrees and other eligible surfaces; responsive content controls and overflow; touch-sized actions | Files, diffs, tables and preview controls remain readable; no duplicate mobile renderer |
| canvas | Preserve board, links, lanes, drafts and manuscripts; use full-page detail, explicit selection/connect modes, touch pan/zoom | Creating/removing links and returning from draft editing preserve existing state; coordinate with in-flight canvas work |
| terminal and embedded content | Fit terminal dimensions, keyboard accessory actions and viewport; full-width embedded content with existing sandbox boundaries | Keyboard and safe areas do not hide input; content security remains intact |
| state and device acceptance | Distinguish first loading, stale cached content and actual disconnect; retain useful state while refreshing | Verify reconnect logs, background/resume, keyboard, scroll and gestures on iPhone/WebView |

Canvas visual sketches are mock interactions, not a claim that production canvas touch handling is complete. The existing canvas implementation remains untouched. Browser preview covers layout and interaction review without installing an app; real-device acceptance follows through a reachable test instance. Web-only changes normally require updating that instance, while native bridge changes require an app build.

## Alternatives considered

**A separate mobile renderer for each plugin.** Rejected because it duplicates content behavior and makes mobile/desktop feature parity harder to maintain.

**Global CSS that hides arbitrary plugin children.** Rejected because the shell cannot infer each plugin's selection, navigation or draft ownership. A shared layout needs a small explicit master/detail contract.

**Unmount the inactive surface.** Rejected because filter, expanded tree, focus and unsaved local state would reset. Retention keeps the existing component owners responsible for their state.

## Testing

The shared component tests cover narrow/wide transitions, retained element identity, draft/filter retention, focus return, zero-width observations, observer cleanup and missing-observer fallback. The existing local-files suite verifies its file/store behavior. Browser checks exercise the standalone fixture; no production deployment or phone acceptance is claimed.

## Consequences

One source implementation owns the layout transition and remains inlined into each consuming plugin. Retained surfaces continue their existing effects while hidden, which avoids remount churn but does not reduce their memory usage. Adoption is explicit; specialized canvas and terminal gestures remain module-specific. The demo runner depends on Vitest continuing to expose Vite as a dependency.
