# Agent Note: the sub-dsh's preset on host 0.2.0 is a package copied into the scope

Status: implemented

English | [中文](2026-10-01-sub-dsh-preset-package-host-020.zh.md)

## Problem

[The sub-dsh's preset travels inside the scope directory](2026-09-18-sub-dsh-preset-in-scope.md) was built on host 0.1.5's preset mechanism: a preset is a directory (`preset.yml` + `agent.cordis.yml` + `skills/`) under `$DSH_HOME/.agent-presets/<id>`, and the scope's sub-profile patch carries one `@deepseek-ai/dsh-agent-presets` roster row whose `default` names it. Host 0.2.0 has neither half. The roster module is absent from the 0.2.0 toolchain, the registry that replaced it (`@deepseek-ai/dsh-agent-preset-registry`, service `agentPresets`) neither scans directories nor accepts preset paths, and a preset exists only as a declarative `@deepseek-ai/dsh-agent-preset` loader row. On a 0.2.0 evaluation instance, every dsh condition that declares a preset therefore failed to compose (T82's known gap).

Two further facts of the 0.2.0 line bear on the same code path:

- The instance's own profile is where the evaluation installs everything, and since T82 the instance runs the 0.2.0 toolchain. A host round should follow it. The pinned `/opt/dsh-headless` path ([dual-filesystem pin](2026-09-09-dsh-headless-bundle-dual-filesystem-pin.md)) instead tied host rounds to whatever the machine-level symlink happened to point at.
- Delegation tools are sealed: a community delegation tool row is absent unless a preset names it. Any change to how a preset reaches the sub-dsh must be checked against what the evaluation presets intend.

## Decision

**The preset layer is a registry row.** When a scope composes a preset, `provisionDshSubProfile` appends one `insert` of `{id: agent-preset-registry, name: '@deepseek-ai/dsh-agent-preset-registry', config: {default: <id>}}` to the sub-profile patch, after the headless patch and before the permission layer. The headless agent loader `mount`s the default preset in agent setup, so the headless bundle needs no change. `readSubProfilePreset` reads that row back by its package name; the eval probe (`packages/eval/src/sub-profile.ts`) does the same. The 0.1.5 roster row is neither written nor recognized.

**The preset definition is a package.** A preset package is a `package.json` declaring `dsh.bundle.patch`, whose patch carries an `@deepseek-ai/dsh-agent-preset` row with `config.id` equal to the preset id. `@khorsheed/dsh-presets` has this shape, and so do the dataset's `env/presets-0.2.0/{eval-lean,eval-full}`. Its skills root resolves through the package itself, using the official presets' `createRequire(baseUrl).resolve('<pkg>/package.json')` expression. On 0.2.0 `baseUrl` is the profile root, not the composition's own directory.

**The scope keeps a copy of the package.**
- `provisionDshScope(home, config, {preset, instanceProfileDir})` looks in the evaluation instance's own profile for the one direct dependency that declares the id. It scans `package.json` dependencies, resolves `node_modules/<name>` through its realpath, and requires a unique match.
- It checks the package (name, patch files, no absolute path, the id actually declared) and mirrors it byte for byte to `<scope>/preset-packages/<id>`.
- The sub-profile lists the package in `dsh.profile.bundles` after `@deepseek-ai/dsh-base`. Its `node_modules/<name>` is a **relative** symlink to that copy, so the host and a unit (which bind-mounts only the scope) resolve the same directory.
- The refresh, keep-and-report and persistence rules are unchanged from the 09-18 note. One exception: an explicit request now snapshots before it persists, so a failed request writes nothing into the scope.

**The instance profile directory comes from `ctx.baseUrl`.** The loader sets it to the directory of the profile's `cordis.yml`. Before T91 the plugin carried a separate preset-root resolver, `defaultPresetRoot`, with the order settings home → non-blank `DSH_HOME` → `~/.dsh`. That resolver is **deleted**, not kept with its priority order: the source of a preset is now a package the instance installed, and the instance's profile directory is the only place to look for it.

**Host rounds follow the instance; container rounds keep the pinned path.**
- The new config key `unitHeadlessBundleDir` names the in-unit headless path. When it is set, provisioning writes two sub-profiles:
  - `<profileName>` links to this instance's own headless bundle (host rounds);
  - `<profileName>-unit` links to the unit path (container rounds).
- The twin's patch is read from the unit path when the host can read it there, and from the host bundle otherwise.
- The provider picks the `-unit` profile exactly when the round carries `exec`.
- The web-eval profile moved its pin from `headlessBundleDir` to `unitHeadlessBundleDir`. `headlessBundleDir` keeps its old meaning for deployments that still want one shared target.

**The host profile copies the headless bundle instead of linking it.** Host 0.2.0's boot classifies each module path. A path under `$DSH_HOME/profiles/` is a *profile layer*, and its undeclared bare imports fall through to the installation's entries. A symlinked package whose realpath lies outside the profiles tree is a *linked root*, and only the names in its `peerDependencies` are routed. The packed headless bundle declares none of `commander`, `@deepseek-ai/schemastery` or `@deepseek-ai/dsh-cmdline`, because pack-dist strips `dependencies`. Linked from the scope into the instance's install, its startup and runner rows therefore fail to import, nothing calls `appExit`, and the sub-dsh hangs with no session. The first live readiness probe on 3185 hit exactly this and timed out at 420 s.
- Provisioning now mirrors the bundle's own files into `<profile>/node_modules/@khorsheed/dsh-local-agent-dsh-headless`. An identical copy is left alone, a changed install is re-mirrored, and a symlink from the earlier scheme is replaced without touching its target.
- No dependency closure is copied. `@deepseek-ai/*` still resolves from the installation running the sub-dsh, so the one-instance-per-package reason the dual-filesystem contract gave against copying still holds.
- The `-unit` twin keeps its symlink to the image path. So does the lone `headlessBundleDir` pin with no twin, the 0.1.x shared-profile form, whose point is one path that both filesystems resolve.
- Probe evidence: on the 0.2.0-rc.2 toolchain, the scope's full composition (headless patch, registry row, preset package, permission layer) hung with the link and exited with `MISSING_CREDENTIAL` (no key in the probe) with the copy. The same copy on the 0.1.5-rc.1 toolchain also reached `MISSING_CREDENTIAL`.
- `home.sha` now covers the bundle copy's `package.json` and `cordis.patch.yml`. An upgraded headless install therefore surfaces as drift until the condition is re-provisioned, which is right: the subject changed.

**Sealing changes nothing for the evaluation presets.** `eval-lean` and `eval-full` name only `persona`, `skill-filesystem` and `tool-skill`; their tools come from dsh-base's root rows, and they never named a delegation tool row. Their stated intent, "same tools, different skills", holds unchanged under 0.2.0's sealing. A preset that does want delegation names the provider's `./tool` row in its own composition.

## Alternatives considered

**Keep the directory form and add a 0.2.0 shim that registers each directory as a row.** It would have needed code in the sub-dsh (the headless bundle) to read directories the host itself no longer reads, keeping a second preset mechanism alive inside the subject under test. The subject would then not be a stock 0.2.0 dsh.

**Write the preset row inline into the sub-profile patch instead of copying a package.** This is the smallest diff, because the composition text moves into the generated patch. But the skills directory still has to live somewhere a unit can read, so a copy into the scope is needed anyway. The patch would also stop being a pure function of config, which [the restart landmine](2026-09-18-sub-dsh-preset-in-scope.md#who-writes-what-and-the-restart-landmine-that-decided-it) relies on. And the probe would lose the "the same package the instance's catalog measured" link.

**Symlink the instance's installed package into the sub-profile (no copy).** It works on the host, but the target lies outside the scope, so it dangles inside a unit. It also lets an instance reinstall move the subject under a run.

**Keep `defaultPresetRoot` (settings home → `DSH_HOME` → `~/.dsh`) and look for packages under it.** There is no 0.2.0 meaning for a "preset root" directory. A package is found where the instance installed it, so a second resolver would only be a way to find a different copy than the one the catalog measured.

**Keep pinning `headlessBundleDir` for both rounds.** It stays correct only while the machine-level `/opt` symlink tracks the instance. Switching the instance to a new host line then needs a privileged step, or host rounds silently test the old one. The unit path, by contrast, is fixed by the image and safe to pin.

## Consequences

- An evaluation instance must install each preset package it measures as a direct profile dependency, with a `file:` spec to the dataset checkout. That is a deployment step, not a pack member: the dataset owns the presets. On the 3185 temp instance this step was done by hand. The web-eval README states it.
- The instance's preset picker also lists those presets; this is harmless, and the same was true of directory presets on 0.1.5.
- A scope provisioned on 0.1.5 keeps its `.agent-presets/<id>` directory, which 0.2.0 ignores. The 0.1.5 conditions use their own scopes, and the `*-0.2.0-rc.2` conditions use new ones, so nothing is migrated.
- The scope's `home.sha` now also covers `profiles/<name>-unit/` and `preset-packages/<id>/` (their config-suffixed files).
- Host rounds no longer depend on the host-side `/opt/dsh-headless` symlinks. Those remain only for profiles still pinning `headlessBundleDir` (the 0.1.5 line); repointing them when 3171 switches is a manual, privileged step for the user.

## Testing

- `packages/local-agent-dsh/tests/provision.spec.ts`:
  - the registry layer;
  - the package bundle plus relative link;
  - a bad package name;
  - the `-unit` twin (unit patch absent and present).
- `packages/local-agent-dsh/tests/scope-preset.spec.ts`:
  - `findPresetPackage`;
  - snapshot copy / keep / heal-without-profile / refresh;
  - refusal of absolute paths, missing presets and symlinks;
  - resolution order, and the rule that a failed request persists nothing.
- `packages/eval/tests/{preset-snapshot,capability-probe,capabilities}.spec.ts`: the package form, the registry readback, and the "no preset row" refusal.
- `packages/local-agent-dsh/tests/provision.spec.ts` (bundle copy): refresh and drop, replacing an earlier symlink, refusing a non-plain tree, and the installation-resolved default.
- Live: on the 0.2.0-rc.2 temp instance (port 3185), both `dsh-{lean,full}-0.2.0-rc.2` conditions provisioned with `provisioned.capabilities`. The first one-cell run of `dsh-lean-0.2.0-rc.2`, made with the link, failed its readiness probe (the 420 s hang above). The outcome with the copy is recorded in the T91 report.
