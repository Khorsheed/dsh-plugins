# Agent Note: web-eval supports host 0.2.0 and later only

Status: implemented

## Problem

The web-eval pack was built and verified on host 0.1.5-rc.1. Its `eval` agent preset was a directory (`presets/eval/{agent.cordis.yml,preset.yml}`) that the install scripts copied into `$DSH_HOME/.agent-presets/eval`, and its pin set `agent-presets.default: eval`. Host 0.2.0 dropped both: presets are declarative `@deepseek-ai/dsh-agent-preset` rows, and the default lives on the `agent-preset-registry` row. The 0.2.0 toolchain ships `dsh-agent-preset` and `dsh-agent-preset-registry`, but not `dsh-agent-presets`. On 0.2.0 the pack therefore booted without its preset, which is frozen decision 12's execution point (no shell, no container controls for the evaluation agent). The 3171 instance on `~/.dsh-lab` still holds the line's real data on 0.1.5.

## Decision

The user decided on 2026-10-01 (T82): **web-eval supports host 0.2.0 and later only**, with no dual line and no directory-style preset.

- **Preset bundle.** The pack's `presets/` is a profile-local declarative bundle: package `@khorsheed/dsh-web-eval-preset`, `private`, `dsh.bundle.kind: 'preset-declarations'`, one top-level row `preset-eval` (`@deepseek-ai/dsh-agent-preset`, `id: eval`, display name 评测模式). The profile depends on it as `file:presets` and lists it in `dsh.profile.bundles`.
  - Its `plugins:` block is byte-identical to the last directory version (sha256 `ee5e6f48…` at 8fe63e72).
  - `scripts/web-eval-preset-bundle.spec.ts` pins that digest, the single row, and the absence of host-command rows.
- **Default pin.** The profile's `cordis.patch.yml` pins `agent-preset-registry.default: eval`, and the `agent-presets` pin is gone.
- **Install gate.** `install.sh` and `update.sh` exit 2 before writing anything when `dsh --version` is below 0.2.0-rc.2, and name `~/.dsh-toolchains/rc-0.2.0-rc.2`.
  - Source mode also refuses a `DSH_HARNESS` checkout below that line, because typert generation reads it.
  - The `.agent-presets` copy and its backup are gone. A leftover `$DSH_HOME/.agent-presets/eval` gets a removal note; the scripts never delete it.
- **Compatibility.** eval, eval-tool, datasets and datasets-tool carry `dsh.compat` `minHost` and `verifiedHost` 0.2.0-rc.2. Both of their READMEs state the same in `Compatibility`. The web-eval READMEs gain a Compatibility section, the 0.2.0 host line in Install, and a dump count of 25 names (22 bundles, `local-agent-dsh-headless`, and the two companion tool rows the preset names). After merging main, whose README said 23 (counted on the 0.1.5-era composition with the directory preset), a `--source --fresh` reinstall of the merged tree into a new temp home measured 25 names and 205 rows. The merge left `UNPUBLISHED_DIRS` identical on both sides, and the measured figures are the ones the docs carry.

### The tested dsh follows the instance

`local-agent-dsh` pins `cliLaunch: [dsh]`, so where the tested CLI comes from depends on the round:

- **Host rounds** resolve `dsh` on the instance process's PATH. On the 0.2.0 temp instance that is 0.2.0-rc.2.
- **Container rounds** use the image's `/opt/dsh-headless`.

No condition field selects a toolchain. Following the user's 10-01 rule ("if it follows the instance, add 0.2.0 conditions and keep the old ones"):

- **New conditions.** `dsh-lean-0.2.0-rc.2` and `dsh-full-0.2.0-rc.2` (scopes `d-*-020rc2`, `home.sha` null until provision) sit on dataset branch `t82-host020` (b40ab01), unmerged.
- **Old conditions stay.** The 0.1.5-rc.1 conditions and the experiments that use them are unchanged.

Three observations decide how the switch is run:

- **Order of checks.** Provision checks the credential before the effective-config check. Without credentials it stops at `CREDENTIAL_ABSENT`, and a `harness.version` mismatch is only a warning that comes after.
- **Old locks.** The conditions page shows old locks (CLI 0.1.5-rc.1) as ready without re-probing. A run report records the delegation's cliVersion without comparing it to the condition.
- **dsh switch.** On 0.2.0 the dsh provider registers only while its volatile `enabled` is true, and the default is false. 0.1.5 kept that flag in the legacy settings file. 0.2.0 imports `$DSH_HOME/settings.yaml` once at boot. Until it is on, provision reports `unknown harness dsh`.

### 3171 data trial

3171's `state/{eval,datasets,mission}` was copied read-only into a temp home (`/private/tmp/dsh-t82-home`, port 3185) and checked against 3171: 23 result rows, an identical dataset registry, and a clean `diff -rq`. The formal switch steps are in the web-eval README, 「把 0.1.5 实例切到 0.2.0」. A person stops the instance by hand. The steps were written, not executed.

Two items were not migrated, because the permission layer denied copying them:

- **Sessions** (personal data).
- **The legacy settings file** (credential-adjacent).

The switch steps therefore turn on DeepSeek delegation in the UI, or have the user place the settings file for the one-shot import.

## Alternatives considered

**Dual line (0.1.5 and 0.2.0 side by side).** The pack would have kept the directory preset for 0.1.5 and added the bundle for 0.2.0, with the install scripts branching on `dsh --version`. This was rejected for four reasons:

- **Two compositions.** The two hosts compose presets through different contracts: a directory roster scanned per home versus declarative rows. The apparatus would exist twice, and a byte-equivalence spec could only guard one of them per checkout.
- **Doubled acceptance.** Every acceptance pass (a–e, T86 and T87 retakes, two widths) would have to run on both hosts.
- **Code already dual.** The family code already carries 0.1.5 branches (dual-name probes, dual typert codecs, `readOutput`), and a dual line would freeze them in place.
- **One instance to move.** The only instance on 0.1.5 is 3171, and it can be migrated.

The user chose 0.2.0-only on 2026-10-01. The 0.1.5 branches in package code stay for now, as listed under Consequences.

**Keep the directory preset and copy it on 0.2.0 too.** Rejected because 0.2.0 never reads `$DSH_HOME/.agent-presets`. The preset would be installed and inert, and every session would run on the shipped `standard`, with Bash.

**Publish the preset bundle as its own npm package.** Rejected for now because the preset is part of this pack's apparatus and has no meaning outside it. The profile-local `file:presets` dependency keeps it versioned with the pins that reference it.

**Pin the tested dsh CLI per condition.** This would add a condition field that names a toolchain. It is out of scope for T82, which changes no schema, and the user's rule was to add per-version conditions instead.

## Consequences

**What it bought:**

- One composition contract and one acceptance matrix.
- An install that refuses a host it cannot serve before writing a byte. This was proven on the rc-0.1.5-rc.1 toolchain: exit 2, empty home.

**What it cost:**

- **Locked out of the new release.** An instance on 0.1.x cannot take this release and must migrate (README steps) or stay on the old line.
- **Old locks stay.** They keep reading as ready.
- **Version follows the instance.** After a host jump, every dsh run tests the new CLI until conditions are reprovisioned.

**Follow-ups** (old-host branches and gaps left in code; not part of T82):

- **local-agent-dsh `provision.ts`** (the important one). `PRESET_ROSTER_MODULE = '@deepseek-ai/dsh-agent-presets'` and `USER_PRESET_DIR = '.agent-presets'` compose scoped-home presets the 0.1.5 way. Preset-bearing dsh conditions are expected not to compose on 0.2.0 until this is ported to declarative `@deepseek-ai/dsh-agent-preset` rows. The plan was to verify this live once credentials are configured.
- **eval code still shaped for 0.1.5:**
  - `sub-profile.ts`: `PRESET_ROSTER_MODULE`.
  - `preset-snapshot.ts`: `USER_PRESET_DIR`.
  - `job.ts`: the 0.1.5 `readOutput` pull path.
  - `slash.ts`: the `agentPresets` probe.
- **Dual-name probes and codecs.** The dual-name preset-registry probes (380a469c) and gen-typert's dual-shape codecs (00cfa1d6) can retire once no 0.1.5 consumer remains.
- **UI.** The DSH 委派 card shows an unexpanded `{harness}` placeholder (a UI bug in the local-agent-dsh client).

## Related

- [The eval agent preset ships with the pack](2026-09-08-web-eval-agent-preset.md). This note supersedes its directory form and keeps its decision (frozen decision 12's preset).
- [Evaluation pins belong to the pack](2026-09-07-web-eval-pins-belong-to-the-pack.md).
