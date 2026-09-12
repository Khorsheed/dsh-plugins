# Mobile preview return and iOS icon — 2026-09-12

## Scope

Prepared for the next maintenance window; no Host restart, profile reinstall or phone installation in this batch.

## Results

- The existing narrow preview click already closed navigation in the production composition. The update gives it an explicit full-conversation label, keeps navigation focus suppression, removes the hidden return control from wide layouts, and adds a 220 ms reduced-motion-aware transition.
- A real WebKit browser loaded the candidate mobile bundle against the running Host. Touches at 4%, 50% and 90% of the preview height each closed the library, returned the toolbar to x=0 and left the editor unfocused. Reduced-motion computed transition duration was 0s. These reads did not submit messages or interrupt the active task.
- The navigation regression preserves the exact editor node and unsent draft, does not call openSession when tapping the preview, and leaves the wide-screen chat interactive.
- Mobile build and 74 tests pass. Native HostAddress validation passes 26 checks.
- The icon is generated blue/white D/chat-bubble artwork, resized to an opaque 1024×1024 PNG for the asset catalog. The app target includes the catalog in Resources and names AppIcon in Debug and Release.
- Simulator and signed device builds succeed. The resulting Info.plist contains primary AppIcon declarations for iPhone and iPad; Assets.car and generated 120px / 152px icon files exist. The 120px icon was visually inspected.

## Pending

The subsequent [September 13 maintenance](mobile-http2-cutover-2026-09-13.md) installed the signed native app and deployed this mobile bundle with the HTTP/2 ingress cutover. The icon changes only after installing the new native app; refreshing the Host page cannot install an iOS icon. Physical touch/animation acceptance remains for the user after unlocking the phone.
