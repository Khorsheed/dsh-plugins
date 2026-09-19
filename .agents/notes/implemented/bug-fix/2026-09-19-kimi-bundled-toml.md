# Agent Note: Ship the Kimi native configuration parser

Status: implemented

## Problem

Both fresh and upgrade candidate tarball preflights failed to import Kimi with `Cannot find package smol-toml`. The source manifest declares the dependency, so linked development and all package tests passed. The repository packer removes ordinary dependencies under its bundled-runtime contract, while the default Node bundle left this new import external.

## Decision

Kimi's package-level configuration uses the shared client bundle helper's Node overrides to always bundle `smol-toml`. Native model/effort configuration parsing therefore ships inside the provider artifact. Official host modules and sanctioned family dependencies keep their existing resolution behavior.

## Alternatives considered

**Install the parser manually in each profile.** Rejected because that hides an incomplete plugin artifact and contradicts independent installation.

**Change the shared packer's dependency policy.** Not required for this package-local defect. The packer's established contract already requires ordinary runtime libraries to be bundled; changing that shared policy belongs to mainline ownership.

## Consequences

The provider artifact grows by the parser's implementation and no longer requires an undeclared consumer installation. Fresh/upgrade preflight on the npm host is the relevant verification; linked tests alone cannot establish this property.
