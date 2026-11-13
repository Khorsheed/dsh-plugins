# Agent Note: Complete client builds preserve account and version metadata

Status: implemented

English | [中文](2026-11-13-complete-client-build-metadata.zh.md)

## Problem

Running the Host's `build:web` script directly does not supply the complete client build environment. A resulting browser bundle can omit `DSH_CLIENT_VERSION`: General Settings then intentionally omits its version row, while `accountClientMetadata()` throws when an account operation needs that metadata. The absence of generated files is not a sufficient readiness check.

This was distinct from the production launch overlay that had disabled `ui-settings-account` and left account notifications waiting for its `accountUi` provider. It is also distinct from the official rule that hides the Account settings section while signed out. Treating all three observations as one upstream removal would misdiagnose the failure.

## Decision

Build the Host from its repository root with the complete `pnpm run build`, then use the repository's normal `deploy:3080` gate for deployment. Do not patch official account code, bypass version metadata, or treat a direct `build:web` invocation as the complete release build.

The complete build record at `.dsh-build/client-build-environment.json` must carry the actual Host version and commit. A browser smoke must check the visible version and the real account-menu path; it must not claim external account authorization succeeded without exercising it.

## Alternatives considered

**Inject an arbitrary version only for the production page.** Rejected: it would disguise an incomplete artifact and detach the visible version from the actual release.

**Change official account behavior or remove the missing-version exception.** Rejected: the community repository does not fork the Host. The supported root build already provides the required metadata.

**Explain the missing Account section solely by the build failure.** Rejected by source and browser evidence: a signed-out client intentionally shows the sign-in menu item without the signed-in Account section. The separate launch-overlay mismatch is recorded in the account-notification fix.

## Consequences

The 3080 candidate again carries `0.2.2-rc.3` and its matching commit metadata. Account settings, notifications and sign-in behavior retain official ownership. A real user sign-in remains a separate production confirmation, not something a build or keyless browser test can certify.

## Testing

The complete Host root build passed all ten build gates, followed by a successful gated deployment and canary. Its build record identifies version `0.2.2-rc.3`, commit `38a6a5c`, 371 client artifacts and their digest.

`packages/basic/tests/account-notifications.host.spec.ts` uses the real assembled client to check the signed-out sign-in menu item, the exact version from the Host manifest, active account notifications and zero page errors. It deliberately does not start an external authorization flow or read credentials.

## Related

- [Activate account notifications with their plain-Web provider](2026-11-13-account-notifications-web-activation.md)
- [Host 0.2.2-rc.3 adaptation](../process/2026-11-13-host-022-rc3-adaptation.md)
