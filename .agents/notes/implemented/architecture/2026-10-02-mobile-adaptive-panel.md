# Agent Note: Retained adaptive panels

Status: implemented

## Problem

Desktop sidebars squeeze file previews beside a 300-pixel tree on phones. Desktop tab strips, split panes and floating windows also compete for that width. Duplicating every plugin in a mobile renderer would multiply maintenance and lose parity for canvas links, lanes and drafts.

## Decision

The source-plane content-preview library exports `AdaptiveSplit`. It observes its container, shows one retained surface below 560 pixels and both above it. Opening detail focuses its back action; returning restores the originating control when available. Both surfaces stay mounted, preserving child state and scroll containers. Zero-width observations from hidden tabs are ignored. Without ResizeObserver the initial measurable width is used; an unmeasurable surface keeps both panes available.

Local-files and worktrees adopt it with their existing trees and ContentPane. Selection opens detail; back returns to the retained tree without clearing the selection or fetched content. Session, root, mode or worktree changes reset the appropriate detail navigation. Wide mode retains its divider and caps the master at 45%. ContentPane uses a container query to wrap controls. Its compact title-action group uses 32-by-40-pixel targets without extra inter-button gaps, leaving more room for filenames; file-workspace breadcrumb actions also lose the extra gap. Wide-container spacing stays unchanged. These are source imports, not new runtime plugin dependencies.

Mobile adds a panel action beside new conversation. An optional structural `sidebarRight` service probe supplies mounted-session inventory, focus, expand, close and guide-opening operations. Checked sidebar/dock anchors provide presentation notifications where the public feed does not report layout changes. The full-width mobile shell replaces the desktop tab strip with back, horizontally scrollable named tabs and add. Close belongs inside the active tab. Tabs are flat equal-height labels: the active one is bold with an accent underline spanning its label and close button (2026-10-06, replacing the desktop-style raised box). A dedicated 52-pixel panel bar holds them; the connection banner reserves its own space without stretching the tabs. It presents only the active pane, including a floating pane, without rewriting the host's saved splits or floating geometry. Content stays in its original host; retention follows the host's policy. Missing capabilities or anchors leave the native chrome available. Failures retain selection and show a retryable error. Chat becomes inert while the replacement panel is open; keyboard focus returns to its entry. Managed panels and explicit gesture-owner surfaces do not trigger global navigation swipes.

Mobile fullscreen is independent of the frame's reserved right track. An open managed panel anchors its column to the complete frame with automatic grid placement, including when the host reports a collapsed zero-width track. Percentage panel width then resolves against the full frame. The mobile entry replaces the native `data-sidebar-right-expand` affordance only while that entry exists; withdrawal restores the host button. On the new-session page, the hidden compose action takes no layout space, leaving the sole panel entry aligned to the trailing edge.

Repeated selection is idempotent: selecting the same file, diff view or commit cannot clear fetched data when the effect key has not changed. The preselected first commit follows the same rule. Pending file reads show loading; pending or failed commit reads do not fabricate zero-file details. The shared back control uses a separate chevron and a 10-pixel gap with a 48-pixel minimum target.

Touch/pen long-press belongs to native text selection. Mobile no longer opens a competing message dialog on the same gesture; original message action rows remain available. Existing pointer context menus close on text selection. Quote ignores selections in UI controls and uses a bottom action dock on coarse pointers, leaving the native selection callout near the text. Actual iOS callout interaction still requires device acceptance. Reader translation is unchanged: it depends on the browser Translator API and has no server fallback; mobile capability absence hides its translation actions.

Canvas keeps its existing board, link, lane, drawing and manuscript models. LinkView adds compact pan/select/move/connect modes, two-tap linking, a relation selector for deletion, and 50–200% zoom buttons. World coordinates are independent of zoom; each completed move still writes once. Pointer cancellation, a second pointer, blur and unmount cancel pending writes. Zoom is remembered per board alongside selection and scroll. Compact controls expose previously hover-only actions. The tab toolbar wraps, and detail split mode stacks source and preview on narrow containers. Pinch zoom is not implemented; buttons provide scaling. No canvas schema, Remote contract or host source changes are required.

## Preview and acceptance boundary

The original shared-layout fixture runs with `node packages/ui-content-preview/examples/adaptive-split/serve.mjs` at loopback port 8873. The integrated fixture runs from `packages/mobile` with `pnpm exec tsx examples/panels/serve.ts` at loopback port 8875. It imports actual MobilePanelNavigation, host DockLayout, AdaptiveSplit and LinkView, using in-memory sample data. It imports the host's actual AppFrame and SidebarRight styles, includes their retained session wrapper and panel body, and defaults to a collapsed zero-width track with only the guide open. A track toggle covers both geometry states; a new-session toggle covers entry placement. A dark/light toggle and the full file-action group cover chrome contrast and spacing. Its file browser and worktree view use the actual plugin components and stores with delayed sample Remote replies; only the card editor remains a fixture control. It does not read production files or commits. The source-plane resolver is shared with tests. Only the existing ingress `.mjs` examples ship in the mobile package; the repo-only preview is excluded.

Terminal content benefits from the full-width owner container and existing viewport handling; global swipe interception excludes xterm. A terminal key accessory is not added: it needs an official input capability rather than synthetic DOM keystrokes. Embedded content retains existing sandbox boundaries. Real iPhone/WebView keyboard, safe-area, background/resume and terminal acceptance remains pending. The component fixture is not a deployed Host or a phone test.

The reported first-load information disappearance has not been reproduced with connection logs. This change does not claim to fix its cause or change reconnect policy; initial loading and transport failure must be distinguished during instance acceptance. The adaptation needs no native app rebuild; production acceptance uses the repository deployment flow.

## Alternatives considered

**Separate mobile renderers per plugin.** Rejected because they duplicate content behavior and make feature parity harder to maintain.

**Global CSS hiding arbitrary plugin children.** Rejected: the shell cannot infer plugin selection, navigation or draft ownership. Shell CSS only handles checked host containers; master/detail requires an explicit shared contract.

**Unmount or reparent inactive content.** Rejected because drafts, filters, scroll, iframe and terminal state may reset. Shared panes remain mounted, and shell adaptation preserves the host's content tree.

**Rewrite saved docking state for phones.** Rejected because desktop splits and floating positions would be lost when switching devices. Mobile presentation changes neither.

**Patch the upstream host or synthesize terminal input.** Rejected because host source is tracked read-only and terminal input belongs to its owner. Missing capability work follows the upstream pipeline.

## Testing

Shared-layout tests cover retained element identity, draft/filter retention, focus return, width transitions, zero-width observations, observer cleanup and fallback. Local-files and worktrees integration tests cover detail navigation, repeated selection, delayed reads, and an eight-file preselected commit reopened from its retained list. Mobile tests cover visible tab inventory, keyboard navigation and touch-selection ownership; quote tests reject UI-label selections. Mobile tests cover owner operations, missing capabilities/anchors, failed operations, listener cleanup and gesture ownership. Canvas tests cover desktop gestures plus two-tap link creation/deletion, pan without writes, scaled movement, cancellation and read-only behavior. A regression reproduces the collapsed-track failure as a zero-width body before the fix and a full-width body afterwards. Computed-style tests cover collapsed-track open/return, native-entry fallback and the hero action footprint. Browser checks use the integrated fixture for actual DockLayout presentation and component interactions; phone and production acceptance are separate.

## Consequences

One shared implementation owns the master/detail transition and is inlined into consumers. Specialized canvas gestures remain canvas-owned. Retained surfaces keep their effects and memory usage. The mobile shell uses checked host DOM anchors as a fallback notification seam; a future anchor change must withdraw replacement chrome rather than break native access. Preview tooling depends on the workspace's Vitest/Vite source resolver and the read-only harness checkout.
