# Agent Note: ship the supervisor installers — the recommended deployment shape was unreachable from npm

Status: implemented

English | [中文](2026-08-18-ship-the-supervisor-installers.zh.md)

## Problem

`package.json`'s `files` listed `lib/*.js`, `lib/types/**/*.d.ts`, `scripts/dsh-watchdog.sh`, and `cordis.patch.yml`. `scripts/install-launchd.sh` was not among them, so `npm pack` never included it. The README presents deployment shape C — launchd supervising the watchdog — as the recommended one and tells the reader to run that script: **the recommended shape referenced a file no npm consumer receives.** Only the watchdog shipped, and a bare detached watchdog is precisely the single point of failure shape C exists to remove.

systemd had no artifact at all. The README offered a command and left the unit to the reader, so the Linux half of the same shape was hand-assembly against prose.

## Decision

Add both installers to `files`, and give systemd the artifact it was missing. `install-systemd.sh` mirrors `install-launchd.sh` flag for flag (`--start`, `--port`, `--home`, `--repo`, `--cli`, `--label`, `--force`, `--uninstall`) and generates a **user** unit under `~/.config/systemd/user` — never a system unit, so it needs no root. The semantic mapping:

| launchd | systemd | why |
| --- | --- | --- |
| `KeepAlive SuccessfulExit: false` | `Restart=on-failure` | exit 0 is the deliberate `watchdog-stop`; anything else restarts the chain |
| `RunAtLoad` | `WantedBy=default.target` + `enable --now` | start now and on every login |
| `EnvironmentVariables` | `Environment=` | a unit starts with an almost empty environment, so PATH is snapshotted and `node` resolved absolutely — the same failure that produced exit 127 under launchd |
| `StandardOutPath` / `StandardErrorPath` | `StandardOutput=append:` / `StandardError=append:` | same log destinations |

Two systemd-specific choices:

- **`StartLimitIntervalSec=0`.** The default (5 starts / 10 s) moves a repeatedly restarting unit to `failed` and stops trying, which ends supervision silently — the exact failure this deployment shape exists to prevent. The retry budget belongs to the watchdog, which already carries backoff and gives up into a crash page.
- **`--print`.** Writes the unit to stdout and exits without touching systemctl. This package is developed on macOS, so it is the only way to review or check the generated artifact here; without it the systemd path would ship unexercised.

`Environment=` and `ExecStart=` values are quoted for **systemd**, not for a shell. systemd splits on whitespace and understands double quotes with backslash escapes; it does not parse shell quoting, so the `printf '%q'` form used for the inner `bash -c` string arrives as many arguments and truncates `ExecStart` at the first space. A `systemd_quote` helper wraps the whole program in one systemd argument, and the inner shell quoting survives inside it. `StandardOutput=append:` takes an unquoted path with no escaping of its own, so a `--home` containing whitespace is refused at generation time rather than producing a unit that fails to parse at start.

## Verification

- `bash -n` clean; `--print` output inspected.
- Round-trip parse of the generated `ExecStart`: splitting it under systemd's rules yields exactly three arguments (`/bin/bash`, `-c`, program), and running the third through shell parsing recovers the original `--start` string byte for byte. This is what substitutes for a Linux boot on a macOS development machine — it proves the quoting, not the runtime.
- Error paths: missing `--start` exits 2, unknown flag exits 2, a whitespace `--home` exits 2 with the reason, and a machine without `systemctl` exits 2 pointing at `install-launchd.sh` and `--print` instead of writing a unit it cannot enable.
- `npm pack --dry-run` now lists `scripts/dsh-watchdog.sh`, `scripts/install-launchd.sh`, and `scripts/install-systemd.sh`.
- `install-launchd.sh` still rejects a missing `--start` unchanged.

**Not verified:** no unit was bootstrapped on a real systemd host — this machine has no systemd. The generated unit is proven well-formed and correctly quoted, not proven to start a service. First use on Linux should be treated as the real test.

## Alternatives considered

**A `.service` template plus documentation instead of a script.** Lower risk to write, but it leaves the reader to substitute absolute paths, snapshot PATH, and quote the start command — the three things that broke the launchd install on its first run. The asymmetry with macOS would also be unexplained: the logic is the same, only the artifact differs.

**A system unit under `/etc/systemd/system`.** Survives logout without `enable-linger`, but requires root for an agent-owned developer service. The installer stays user-scoped and prints the `loginctl enable-linger` command for an administrator to run deliberately.

## Consequences

An npm consumer can now reach the recommended deployment shape on both platforms with the command the README already gives. The systemd path exists as an artifact rather than as prose, and its rate-limit and quoting decisions are recorded where the next reader will look for them. Neither installer registers anything automatically: installation stays an explicit user action.
