# Agent Note: the connect-phone page settles after the quick tunnel starts

Status: implemented

## Problem

Enabling the one-click public entry in Settings → 连接手机 could leave the page on 「暂时无法读取连接信息」 over the stale 「请由部署者配置 publicOrigin」 text until the dialog was reopened. Two client faults in `ConnectPhone.tsx` combined. The tunnel supervisor's `bind` writes the new host into the connection row's `trustedHosts`, which reloads the host connection; the 5-second start-up poll's connect read that lands on that reload fails, and the page showed it as an error. Then the poll stopped on the tick that read the tunnel as `ready`, so the page never re-read the connect info that carries the new origin. Both are independent of the host version (observed on a 0.2.1-rc.3 check instance; the same code runs on rc.1).

## Decision

- `load(generate, background)`: the start-up poll reads in background mode, where a failed read is not shown; the next tick retries.
- When the tunnel state leaves `starting` / `recovering`, the page reads the connect info once more (foreground, so a real failure after settling still shows).

## Alternatives considered

- **Retry inside one read until it succeeds**: rejected. The poll already retries every 5 seconds; a nested retry loop adds timers to abort when the dialog closes.
- **Skip the trust write when the host already trusts the domain**: already done for an adopted tunnel; a fresh quick-tunnel domain must be written, so the reload cannot be avoided.

## Consequences

- A connect endpoint that is genuinely down during start-up stays silent until the tunnel settles; the settled read then shows the error.
- One extra connect read per start.

## Testing

`tests/connect.client.spec.tsx` adds a case where the start-up poll's connect read rejects while the tunnel turns ready: no error is shown, exactly one settled read follows, and polling stops. It fails on the previous component (the alert renders) and passes now; the mobile suite is green (167).
