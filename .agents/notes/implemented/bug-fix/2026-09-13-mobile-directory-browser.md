# Agent Note: Mobile directory selection stays on the phone

Status: implemented

## Problem

The mobile workspace flow accepted a typed computer path, but Room's pure-path picker called uiWorkspace.pickDirectory directly. A native-picker host therefore opened a chooser on the computer when a mobile member's working directory was selected. Host native and browse capabilities are mutually exclusive for the shared instance.

## Decision

Use one mobile directory sheet for the two original workspace directory flows, the optional reusable-picker flow and pure path selection. Host 0.2.2-rc.3's reusable `workspace.picker` Factory joins the original hero and sidebar flows, so its consumers, including the optional official Session importer, inherit the same mobile presentation. `injectMobileDirectoryFlow` forwards the version-dependent key through the public `slots.inject`; a missing declaration stays inert, while a later declaration activates the same contribution and its lifecycle. It does not call the internal core's dynamic-spec helper or augment the older host's SlotMap. Adding a workspace opens computer folder browsing immediately; member path selection starts with the official saved workspaces. Both offer parent navigation, hidden-directory visibility and filtering. Manual absolute-path entry stays in a collapsed secondary control. Only a successfully listed current directory can be confirmed. The existing owner still adopts the workspace or updates the member; selecting a path alone never changes a Room or creates a workspace.

Until a pure path-selection UI slot exists, temporarily wrap this browser's public uiWorkspace.pickDirectory method. Mobile calls share one pending selection; desktop calls delegate to the original method with its original receiver. Cancel, mobile deactivation and service unload settle the pending promise with null. Unload restores the original own property or inherited method only if the wrapper is still installed. A future read-only facade must not break plugin loading. Do not replace Room callbacks, add a Room dependency or change the shared Host picker capability.

The mobile host companion supplies an authenticated, read-only Connection Fetch route. It returns one directory level using Node filesystem operations, follows enterable directory symlinks, exposes hidden names only as flagged rows and bounds both scan and result size. Full paths are validated for the current platform; errors omit raw OS messages. The official carrier applies authentication and Host/Origin checks before dispatch, including on the mobile public ingress. It neither reads file contents nor creates folders. Browser reads are abortable; stale results cannot replace a newer navigation. Failure retains retry and manual-path entry without falling through to the native chooser.

## Alternatives considered

Switching the shared instance to the browse backend would change desktop behavior and would not itself turn Room's native-only pick call into an in-app flow. Maintaining a second Room form would duplicate member mutations. Copying a directory path alone would leave phone users unable to browse. Modifying the Host source would create a deployment fork. A reversible public-method adapter is a bounded fallback until an upstream presentation seam replaces it.

## Consequences

This adds one read-only filesystem route under the existing operator authentication, with the same whole-filesystem scope as the official directory browser. Listings stop after 1,000 directory rows or 10,000 scanned entries and report truncation; complete-path entry reaches omitted directories. Native disk permissions still apply. The route requires the served HTTP carrier and its companion package; offline or missing-companion cases show an error instead of opening a computer window. Retire the method wrapper when the Host provides a pure path-selection UI slot. Tests cover real filesystem filtering and failures, route lifecycle, asynchronous cancellation, validated adoption and desktop restoration.

The optional-slot tests use a real SlotRegistry to prove inert absence, immediate declaration, later declaration and cleanup. Both rc.2 and rc.3 pass the mobile build and 33 files / 179 tests with one version-specific skip. Real rc.2 Chromium boots the mobile layout without the importer or page errors; real rc.3 Chromium completes the importer's mobile Workspace-creation flow. The host floor stays unchanged and no real-device verifiedHost is claimed.
