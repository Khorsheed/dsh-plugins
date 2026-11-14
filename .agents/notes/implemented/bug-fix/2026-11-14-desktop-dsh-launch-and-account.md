# Agent Note: Desktop DSH launch and account delegation

Status: implemented

## Problem

The local DSH provider treated `process.argv[1]` as the CLI entry. In packaged Desktop that is the Electron Host entry, so a working bundled CLI was reported missing. Account sign-in was also unusable for delegation: the selected-route transfer supported only API-key references, while the official account provider requires an account token in `x-dsh-auth-token`.

## Decision

`dshLaunchArgv` retains an explicit `cliLaunch` override, then probes the official `runtime/cli/bin/dsh` (`dsh.cmd` on Windows) under Electron's `process.resourcesPath`. A missing resource retains the existing parent-entry fallback. Version detection and actual delegation use the same resolved argv, and container launches keep their explicit target configuration.

The selected `deepseek-account` route uses the parent's `deepseekAccount.resolveToken(url)`. Only the account route admitted by the public provider directory is inherited; hosts without the account service or method retain the API-key-only behavior. The token, its approved origin and the selected public configuration travel in the explicit launch environment. The fingerprint includes them, so the next round replaces a resident process after a change without losing the session.

The generated sub-profile configures the official account provider without embedding a credential. For account launches, the headless bundle disables the base account service and mounts a scoped subclass of the official `DeepSeekAccount`. Only token resolution changes: it reads the launch grant for the already-approved origin. Official model and web providers keep their authentication protocols. Rejection cannot revoke the parent's grant; the next launch resolves it again. No child credential record or interactive login flow is introduced.

This extends [selected model inheritance](2026-10-09-dsh-selected-model-inheritance.md) without copying the parent profile or credential store.

## Alternatives considered

**Pass the account token as `DEEPSEEK_API_KEY`.** Rejected: the account route uses a different header and failure semantics. Relabeling would bypass the official origin check and could send the grant to the wrong destination.

**Copy the parent credential record.** Rejected: it exposes unrelated storage and confuses ownership of reauthentication and revocation. A launch-scoped grant resolved through the official service is sufficient.

**Hardcode one Desktop installation path or suppress the version error.** Rejected: installation locations and platforms vary, and hiding the error would leave delegation broken. The packaged resource location is stable and the explicit override remains available.

**Change the upstream host.** Rejected: the official Desktop CLI resource and account service already provide the required seams.

## Consequences

The child process receives a usable account token just as API-key children receive their selected credential; this is not process isolation from the same OS user. The child cannot invalidate the parent's token after a 401, so reauthentication remains parent-owned and takes effect on a subsequent launch.

Verification covers API-key preservation, missing-account failure without API-key fallback, origin restrictions, no credential-store writes, official account discovery, packaged launcher selection and overrides. The suites pass with 250 local-agent-dsh tests and 60 headless tests. Electron Node resolves the bundled CLI and returns `0.2.2-rc.3`. A real Desktop CLI sub-profile completes its handshake and account model preparation; the committed real-CLI integration test also completes a local mocked live round and checks `x-dsh-auth-token`, the answer, settlement and shutdown without using a real grant.
