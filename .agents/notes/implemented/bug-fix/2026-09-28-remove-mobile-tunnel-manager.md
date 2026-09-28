# Agent Note: Remove automatic mobile tunnel deployment

Status: implemented

## Problem

The desktop tunnel manager treated public reachability failures as permission to deploy and restart 3080. Repeated failures, domain rotation and expensive isolated preflight made this disruptive. The user's required workflow is a reachable desktop entry followed by manually rescanning its QR on the phone.

## Decision

Remove scripts/mobile-tunnel.mts, its lifecycle tests and the mobile:tunnel package command. Unload and disable the installed com.dsh.mobile-tunnel service, delete its plist, and stop its remaining processes. Keep diagnostic logs. No replacement health-check daemon or restart trigger is installed.

Retain anonymous reachability checks and withdrawal of invalid QR codes from the [public-entry work](2026-09-27-mobile-public-entry-recovery.md). Retain deploy:3080 --mobile-origin only as an explicitly invoked operator action, with the existing build/test, authority validation, preflight and canary. The user separately authorized one manual restoration after removal; subsequent outages do not authorize another restart. Ordinary tunnel forwarding is separate from automated deployment.

## Alternatives considered

Increasing the retry cooldown or improving failure classification still lets networking trigger unattended host restarts, so neither satisfies the requested boundary. Removing QR validation would restore misleading codes for unreachable addresses. Keeping automatic recovery disabled by default would leave an unnecessary accidental activation path; remove the implementation instead.

## Consequences

Public tunnel failures require operator action. After the desktop entry is restored, the user rescans the QR; the phone does not discover rotated domains. Stopping the old manager can stop its owned tunnel too, so availability must be reported separately for local 3080 and public ingress. Future automation requires a new explicit product decision and cannot silently inherit authority to restart the host.

Verification checks that the LaunchAgent and manager processes are absent, that local 3080 remains available during removal, and that no executable manager or package script remains. Existing QR/connect and manual rotation tests remain relevant; removed manager tests no longer represent supported behavior.
