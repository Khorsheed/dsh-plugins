# Agent Note: datasets — the 添加题集 dialog picks the source and the repository location with the host's chooser

Status: implemented

## Problem

The 添加题集 dialog (`packages/datasets/src/client/AddDatasetDialog.tsx`) asks where the data is and shows where the new repository will go. Both were text only. 数据在哪 was a textarea a person had to type a path into. 新仓库放在 … was a hint computed by `repoPathFor(datasetsHome, name)`, and `datasetsHome` could only be changed through plugin config. On an instance whose `DSH_HOME` sits under a temporary directory, the new repository therefore always landed in that temporary directory, and the dialog offered no way out.

The plugin already reaches the host's directory chooser: `pickDirectory` in `src/client/index.ts` probes `ctx.workspaces.pickDirectory` and then `uiWorkspace.pickDirectory`, and the register form under 高级 shows its button only when `canPick` holds (loopback connection and `canOpenPath` in the host description).

## Decision

- **数据在哪 gets 「选择目录…」.** The textarea stays, because the field also takes a single file, a public dataset name or a link. The button sits beside it and writes the picked path into the field; the person can keep editing it. A cancelled pick (null) or a chooser that rejects changes nothing.
- **新仓库放在 … gets 「更改…」 and 「恢复默认位置」.** 更改… picks the PARENT directory; the repository is `<parent>/<name>`, the same rule as the default (`repoParentOf` + `repoPathFor` in `src/client/organize.ts`). 恢复默认位置 appears only after a pick and returns to the datasets home. Before a valid name is typed, the line reads with a `<题集名称>` slot so the person sees the parent they chose.
- **The pick travels with the request.** `AddDatasetFields.repoParent` carries it; `buildAddRequest` writes `<parent>/<name>` on the 新仓库放在 line instead of the default. Nothing else in the request changes.
- **Same probe, same degradation.** The dialog takes `canPick` and `pickDirectory` from `DatasetsView`, which already computed them for the register form. When `canPick` is false both buttons are hidden and the dialog is the T90 dialog. Picked paths go through `cleanPickedPath`, because the macOS chooser answers with a trailing slash.

### The probe was dead on 0.1.2 and later hosts

On the temporary 0.2.0 instance neither button appeared, and neither did the register form's 选择… button. The cause was in `canPick`, not in the dialog. Since 0.1.2 the client reads host facts from the connection generation's opening frame. That frame carries `home` but not `canOpenPath`, which became the `session.canOpenWorkspacePath` RPC probe. The datasets client never asked that probe, so `canOpenPath` was always missing and the picker was always hidden. The old comment called this "the intended degrade on 0.1.2". That was true for opening paths in an external app, but `canOpenPath` is the only thing that gates the picker. The 0.2.0 native picker itself has no availability gate.

`hostDescriptionSourceOf` now calls the probe once, when the first view subscribes, and folds the answer into the snapshot. It is the same verb the official open-in-app control reads. One source is created per mount, so every session's view shares the answer. The merged snapshot is cached by identity, because the hook compares snapshots by identity. While the probe is unanswered, or when it fails or reports `false`, `canOpenPath` stays missing and the buttons stay hidden, so the degrade still holds. A failed probe is retried on the next generation change. `remote.session` is read with `ctx.get` at call time, not injected. rc hosts that still expose `Connection.hostDescription` are unchanged.

### Does anything downstream assume the datasets home?

No, checked before building:

- `datasets_propose_registration` (`src/proposal.ts`, `resolve`) takes any `repo`, resolves its git common dir and checkout, and checks the mapping against the repository's objects. Nothing compares the path to `datasetsHome`.
- `registry.register` (`src/registry.ts`) refuses only a repository that is already registered or an id that is taken.
- The review page shows the common dir and checkout under 高级 as facts; it never compares them to a home.
- `datasetsHome` is read in exactly one place: the organizing setup the dialog uses for its default.

So there was nothing to relax. The one loose sentence is in the skill (`skills/dataset-authoring/SKILL.md`, step 3): it says the request names "the datasets home". The request names the full repository path, and with a pick that is the picked location. The skill still treats it as the recommended answer to ask the person about, so it was left unchanged; agent behavior was out of scope here (T94 owns the skill).

## Alternatives considered

**Replace the textarea with a picker-only field.** It is cleaner for the common case, but 数据在哪 also takes a file, a dataset name or a URL, and a directory chooser can produce none of those. The button augments the field instead.

**Let 更改… pick the repository directory itself.** The person would then pick or create an empty `gsm8k` folder. The host's chooser cannot create folders on every platform, and the path would drift from the name the person typed. Picking the parent keeps one rule, `<parent>/<name>`, for both the default and the pick.

**Change `datasetsHome` from the dialog.** That would be a persistent config write from a one-off dialog, and it would silently move every later dataset too. The pick is per request, and the config key stays the way to change the default.

**A second chooser probe for the dialog.** Duplicating the probe would let the two forms disagree about whether a chooser exists. The dialog reuses the register form's `canPick` and `pickDirectory`.

## Consequences

- On a temporary instance a person can put the repository under their home directory without editing config.
- A browser that is not on loopback, or a host without `canOpenPath`, still gets text-only fields. That is the register form's behavior, accepted for the same reason: the chooser opens on the host machine, not the viewer's.
- The chooser is the host's: on macOS it is `osascript choose folder`, opened on the host machine's desktop. Verification on a temporary instance replaced only that OS dialog with a stub on the instance's `PATH`; the button, the client probe, the Remote and the host's output parsing all ran for real.
- The [T90 note](2026-10-01-t90-dataset-journey.md) decision C now names the dialog's 更改… as the way to choose another location.
