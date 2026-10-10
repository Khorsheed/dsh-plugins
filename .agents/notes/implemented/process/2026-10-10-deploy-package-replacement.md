# Agent Note: explicit package replacement in the 3080 flow

Status: implemented

## Problem

Context Lens changes the installed identity of request-inspector while retaining its service name. Adding the new package beside the old one would register the service twice; manual profile edits would bypass the deployment lock and gates. The user requested deployment after the ordinary merge gates passed.

## Decision

`deploy:3080 --replace OLD=NEW` replaces a direct community package with an explicitly co-deployed, self-mounting target. Validation rejects chains, duplicate identities, a target absent from the deployment and old names referenced by the custom profile patch. Build and pack complete before any replacement writes. Within the existing deploy lock the flow backs up package/workspace/patch configuration under the host state directory, removes the old direct dependency, bundles entry and flat override pin, then uses official add and the existing clean install. The old tarball remains available.

Replacement is idempotent so a failed install can be repaired by rerunning the same command. Installed identities are verified before proof, preflight and restart; the normal canary gate remains mandatory. Context Lens uses this path together with the Canvas error-outcome fix.

## Alternatives considered

**Manual profile editing.** Rejected because only the flow owns profile mutations and restart validation.

**Mount both identities temporarily.** Rejected because they register the same service.

**A fake family bundle.** Rejected because the packages are alternative identities, not a composition family.

## Consequences

Integration tests exercise actual orchestration against isolated command stubs: successful replacement and retry, retained backups, build failure preserving the old registration, invalid targets and custom patch refusals. This is the smallest deployment-flow extension needed for the user's requested rename rollout; shared-flow ownership should review it before reuse for other migrations. A failure after profile refresh may still require rerunning the flow, like an ordinary deployment; the backup is recovery evidence, not a promise of automatic rollback. No credentials or session data are copied.
