# Agent Note: Bundle an identifiable iOS app icon

Status: implemented

## Problem

The iOS development app had no asset catalog or primary icon, leaving an empty-looking launcher entry despite the mobile UI having its own visual treatment.

## Decision

Bundle one opaque 1024px blue-and-white D/chat-bubble image in AppIcon.appiconset. Include the asset catalog in the app Resources phase and select AppIcon in both build configurations. Xcode owns device-size generation and iOS owns the outer mask. The static glass-style artwork follows the mobile palette without requiring runtime rendering or a Host connection. Track this specific production PNG through a narrow ignore exception; keep debug screenshots ignored.

## Alternatives considered

A runtime or downloaded logo cannot supply the installed launcher icon. Separate theme variants add artwork maintenance without being necessary to remove the blank icon, so this version provides one universal image.

## Consequences

The native app must be rebuilt and installed to update its icon; a Host deployment alone is insufficient. The image is an app identity asset, not a claim of native liquid-glass rendering or App Store distribution readiness. Simulator and signed device builds compile the catalog, and the generated small icon was visually inspected. Physical installation is deferred to the user-authorized maintenance window.
