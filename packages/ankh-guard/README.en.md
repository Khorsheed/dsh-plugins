# @khorsheed/dsh-ankh-guard

English | [中文](README.md)

Let the agent change its own code and restart itself, without taking the service down.

Having an agent edit dsh's own code is handy; the risky moment is the restart. If the change is broken, the service goes down along with every conversation in progress, and you're left to clean up. With the restart guard, the agent has to show that the build and tests passed before it may restart. After the restart it checks the new service on its own, falls back to the last working version if it won't come up, and the conversations that were cut off carry on.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/ankh-guard.JPG" width="640" alt="A guarded restart: the checks are announced before the restart, and afterwards the canary wakes the session with context so it can keep verifying">

## What it does

- **No tests, no restart**: if the build or tests didn't pass, the agent's restart is refused and the old service keeps running.
- **A dry run first**: before anything stops, the new version is booted once in the background; if it can't start, the running one is left alone.
- **Falls back on its own**: if the new version keeps failing to start, it goes back to the last version that started cleanly; if a newly installed plugin broke the service, that plugin is removed and you're told which one.
- **Reports back when it's done**: the session that asked for the restart gets the result, so there's no log digging.
- **Conversations pick up where they left off**: sessions cut off by the restart come back and continue what they were doing.
- **Pages come back by themselves**: open browser tabs refresh once the new service is ready and return to where you were.

## Install

In DSH, open Plugins → Add plugin, enter this package name, and press Install:

```
@khorsheed/dsh-ankh-guard
```

It also comes with the Dev Suite (`@khorsheed/dsh-dev-suite`). Once installed, have the agent follow the bundled "safe restart" guide.

## Before you start

- **The deployment directory is a git repository**: the "tests passed" proof and the fallback to an earlier version both rely on git.
- **The agent runs without a sandbox**: start DSH with `DSH_PERMISSION_MODE=danger-full-access`, or type `/permission danger-full-access` in the session; otherwise the agent cannot stop and start the service.
- **The first restart goes through the command line**: after installing, run `dsh-ankh-guard supervise` once to hand the service to the guard; from then on the agent can restart on its own.

## Known limitations

- It only covers restarts that go through the guard; stopping the service by hand can still break it, and the automatic fallback is the safety net there.
- After a crash (rather than a normal stop), interrupted sessions don't continue on their own; they recover when you open them.
- macOS and Linux only.

## Compatibility

Needs DSH 0.1.5 or later; verified on 0.2.1.

## For developers

- Every `dsh-ankh-guard` command, the six-step self-restart protocol, the watchdog and launchd / systemd deployment shapes, launch-config cutover and all configuration options are in the [full reference](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/ankh-guard/docs/reference.en.md).
- Entry points: `src/index.ts` (the in-app service and guide), `src/cli.ts` (the CLI), `scripts/dsh-watchdog.sh` (the watchdog).
- Developed in [dsh-plugins](https://github.com/Khorsheed/dsh-plugins), with a single-plugin mirror at [dsh-ankh-guard](https://github.com/Khorsheed/dsh-ankh-guard). Changes: [CHANGELOG.md](CHANGELOG.md).
