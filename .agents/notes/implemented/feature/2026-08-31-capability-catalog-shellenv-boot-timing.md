# Agent Note: capability-catalog shellEnv contributor registration is boot-timing robust

Status: implemented

English | [中文](2026-08-31-capability-catalog-shellenv-boot-timing.zh.md)

`@khorsheed/dsh-capability-catalog`'s credit-env injection contributor (`installSkillEnvInjection` in `shellEnv.ts`) registered its `ctx.shellEnv` contributor from an async refresh that held a service reference captured at install time. On the alpha host's reordered app-boot that reference could point at a fiber that is no longer active, so `shellEnv.register()` (which runs `ctx.effect(...)` internally) threw `INACTIVE_EFFECT` and the contribution silently failed at boot on every start.

## Problem

Production (rc.2) boot timing left the shell-env fiber active when the catalog's first refresh ran, so the register succeeded. The alpha full-build (0.1.2) reordered `app-boot` (extra `AppReady`/command-line wiring), and the catalog's **detached async refresh** reached `shellEnv.register()` in a window where the fiber was inactive. The log showed it on every boot:

```
capability-catalog: skill env contributor register failed (Error: cannot create effect on inactive context)
```

Root cause: the contributor's effect is created on the registry's own backing fiber, but `installSkillEnvInjection` cached the registry once (`const shellEnv = ctx.get(...)`) and re-used it after several `await`s. If the host reloads/reorders that service's fiber between the initial read and the register, the cached reference is a stale fiber → `ctx.effect` throws `INACTIVE_EFFECT`.

## Decision

Never call an effect-creating registration on a reference captured across an `await`. `installSkillEnvInjection` now:

- **Re-resolves `shellEnv` / `credentials` / `skills` fresh on every refresh pass** (and again immediately before `register`), via `ctx.get` — strict, so it returns the implementation only while its providing fiber is `active`.
- **Degrades to a bounded self-retry** (`scheduleRetry`, 300 ms × up to 30) instead of dropping the pass when a required service is momentarily inactive, or when `register` throws `INACTIVE_EFFECT` (`err.code === 'INACTIVE_EFFECT'`). It self-heals once boot stabilizes; `retries` resets on a successful register.
- Keeps the existing degrade-safe path (a genuine owner collision still just logs and leaves `refreshKey` unset so the next pass re-registers).

## Alternatives considered

- **Keep the cached reference, only add a `try/catch`.** Rejected: the catch already existed and only logged — the boot-time registration silently stayed unregistered (and the log is noisy on every boot).
- **Wrap registration in `ctx.plugin(...)` to own a stable fiber.** Considered; upstream `shellEnv.register` scopes its effect to the *registry's* ctx fiber, not the caller's, so a nested plugin does not change which fiber the effect lands on. Re-resolving the active registry is the only reliable control, and it directly addresses the activation-timing dependency.
- **Retry indefinitely.** Rejected: a genuinely absent service (composition without shellEnv) must not keep a timer alive; capped at 30 retries (~9 s).

## Consequences

- On alpha's reordered boot, the credential-env injection now either registers immediately (fiber active) or retries a few times until it is — no `INACTIVE_EFFECT` on boot, no permanent drop.
- Added `tests/shellEnv.spec.ts` (3 tests): registers the resolved `DSH_` set; self-recovers when `shellEnv` is momentarily inactive; self-retries when `register` throws `INACTIVE_EFFECT`.
- Build + 76 host-side tests + `check:plugins` green. Version bumped to `0.1.94`.
