# Agent Note: Desktop file editing counts the packaged application as on-host

Status: implemented

## Problem

`local-files` already shipped text editing, an atomic `writeFile` Remote, and conflict protection. Desktop did not show the edit action because `WorkspaceView` supplies `onSave` only when `browserOnHost()` is true. That predicate recognized loopback hostnames, while the packaged desktop document is `dsh-app://app/`. It therefore treated the desktop application as a remote browser and hid the save gesture.

This was a host-detection error, not a missing editor implementation, a filesystem restriction, or a publication omission. Remote read-only behavior is intentional and must remain unchanged.

## Decision

`browserOnHost()` recognizes `dsh-app:` with hostname `app` as an on-host document. Loopback names and the existing unreadable-location fallback stay unchanged. Other origins, including the desktop shell's update documents and remote tunnels, are not promoted to host access.

The desktop application now receives the same complete-text editor as loopback web access. There is no new write channel and no change to `localFiles.writeFile`, conflict handling, or remote read-only behavior.

## Alternatives considered

- **Enable saving for every origin.** Rejected: the existing host-only boundary deliberately keeps remote browser sessions read-only.
- **Work around the launch argument.** Rejected: the missing editor is caused by the UI hiding `onSave`, not by CLI discovery or a bad write path.
- **Recognize every `dsh-app` hostname.** Rejected: only the packaged application document is the local workspace. Shell and update documents do not need edit access.

## Consequences

Desktop users can edit complete text files and save them through the existing Remote. Remote browsers remain read-only, and no new credential or host-version requirement is introduced. The empty inspiration state also presents its existing add action as a centered card with an explicit 「新增灵感」 label; its panel-centered dialog positioning is unchanged.

## Testing

`packages/client-ui-panel-kit/tests/host.client.spec.ts` covers the packaged application, loopback, remote origins, and the update shell. `packages/local-files/tests/workspace-view.client.spec.tsx` renders a JSON text file under `dsh-app://app/` and verifies that the edit action appears. Those 21 panel-kit tests and 20 workspace tests passed.

## Related

- [Panel design](../../../../docs/panel-design.md) — host-only actions and panel-local dialog positioning.
