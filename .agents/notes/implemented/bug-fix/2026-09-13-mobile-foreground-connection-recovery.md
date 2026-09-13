# Agent Note: Foreground connection recovery without false restart screens

Status: implemented

English | [中文](2026-09-13-mobile-foreground-connection-recovery.zh.md)

## Problem

Opening the mobile app repeatedly showed a full-page connection-loss notice despite a healthy host. The guard counted suspended wall time as failure and retained up to 30 seconds of retry backoff; mobile also forced a reconnect for every native foreground signal, including healthy brief interruptions and startup.

## Decision

Refine the connection-notice portion of [boot-generation refresh](../feature/2026-09-09-ankh-guard-restart-trigger-and-boot-generation.md). The guard pauses requests and clears failure timing while hidden or offline, wakes immediately on visibility/online/native foreground signals, and coalesces duplicate wake signals. A 35-second request deadline exceeds the server's 25-second idle hold. Aborted or superseded requests are fenced before storage changes, authentication handoff or reload.

Only visible sustained failures produce a non-blocking, theme-aware Retry banner. A confirmed cutover keeps its full-page restart overlay and cannot be downgraded by a later network failure. Boot-id refresh, same-origin launch URL validation, capability handling and authenticated ACK remain unchanged. The guard remains independently installable; the optional native event adds no mobile package dependency.

Mobile skips reconnecting a healthy stream after a brief interruption or an initial connecting signal. Suspensions of at least five seconds and persisted-page restoration still reconnect through the official service, because a cached connected state does not prove that live reply baselines survived. Recovery never resends a user message.

## Alternatives considered

Removing foreground reconnect entirely would reintroduce stale assistant content after suspension. Removing guard polling would lose bundle refresh and cutover handoff. A full-page outage screen wrongly equates a network interruption with a restart.

## Consequences

This change improves lifecycle recovery, not tunnel latency or host startup time; real outages still require connectivity to return.

## Verification

Mobile tests cover healthy startup, brief and long suspension, broken connections, duplicate signals and disposal. Guard tests cover hidden/offline time, immediate retries, request timeout, stale-response fencing, notice promotion and existing secure handoff behavior. Browser acceptance checks the banner geometry and foreground recovery in mobile WebKit; production deployment still uses the normal idle-gated tarball flow.
