# Agent Note: activate account notifications with their plain-Web provider

Status: implemented

English | [中文](2026-11-13-account-notifications-web-activation.zh.md)

## Problem

The Web launch overlay disabled `ui-settings-account` while `ui-account-notifications` remained enabled. The notification client's `inject` requires `accountUi`, which the settings client provides, so the built-in Plugins page reported that account notifications was waiting for activation forever. The overlay's rationale was an older assumption that account settings only supported Desktop; the current official implementation explicitly registers account UI on Desktop and plain Web clients.

## Decision

Enable `ui-settings-account` on the plain Web client and keep `ui-account-notifications` and the account backend enabled. Do not change upstream source or bypass the notification plugin's required dependency. The launch overlay now documents that the two clients are a matched pair. A backup of the previous overlay was retained under the deployment state's replacement backups before changing it.

## Alternatives considered

**Disable account notifications too.** Rejected: it would only hide the error and remove the feature, not repair the dependency. Enabling the provider restores the official interaction without weakening the required `accountUi` contract.

**Shim or bypass `accountUi` in a community plugin.** Rejected: it would duplicate the official owner and hide a configuration mismatch behind another compatibility path. The official settings client already supports plain Web.

## Consequences

The built-in settings client now supplies `accountUi`, allowing the notification client to activate normally. No account credential is read or synthesized by this change, and notification polling still follows the account's signed-in state. The fix is in the production launch configuration, not a fork of the official packages.

## Testing

A real rc.2 Web scaffold opened the built-in Plugins inventory, expanded the global plugin group, displayed `Account notifications`, and found no `waiting for activation` message or page error. The test is in `packages/basic/tests/account-notifications.host.spec.ts`.

The rc.3 rerun checks the signed-out sign-in menu item, the exact Host-manifest version, active account notifications and zero page errors. A signed-out client intentionally has no Account settings section. The test does not start external authorization or read credentials.

## Related

- [Host 0.2.2-rc.2 adaptation](../process/2026-11-12-host-022-rc2-adaptation.md)
- [Complete client builds preserve version metadata](2026-11-13-complete-client-build-metadata.md)
