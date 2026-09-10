# Agent Note: local-files external-open gestures ride the official open-in-app routes

Status: implemented

English | [中文](2026-09-10-local-files-open-in-app-restore.zh.md)

## Problem

Host 0.1.2 folded the connection's host facts into the generation's opening frame and `canOpenPath` left the wire, so local-files' loopback gate (`isLoopback && hostDescription.canOpenPath === true`) could never confirm and the workspace browser's "open folder / open in IDE" gestures hid permanently. The assumed restoration seam — an official `remote.session.canOpenWorkspacePath` RPC — does not exist and will not: host 0.1.5 ships the capability as open-in-app instead (`@deepseek-ai/dsh-host-open-in-app` + `@deepseek-ai/dsh-client-ui-open-in-app`, both in the default web bundle). The [0.1.5 adaptation proposal](../../../proposals/active/2026-09-10-host-015-adaptation.md) fixed plan A for local-files: the package keeps its `conversation.view` tab; only the gestures move onto open-in-app.

## Decision

The client gains `src/client/open-in-app.ts`, a mirror of the official browser half's wire face. The route constants (`/open-in-app/apps`, `/open-in-app/open`) and payload types mirror `@deepseek-ai/dsh-host-open-in-app`'s `./shared` verbatim — the client bundle purity gate forbids a value import of a host package, and a mirrored constant degrades to "gestures hidden" if the routes ever move, never to a boot failure. `OpenInAppProbe` GETs the apps route once per page into a snapshot store (null until answered; any failure — a 404 from a host without open-in-app, a network error, a malformed payload — publishes an empty list, the same degrade the official header split button renders) and POSTs `{app, path}` to the open route on a gesture. Both calls are same-origin fetches: the host routes sit behind the connection service's `requestRejection` trust fence (Host/Origin + login-token cookie), which same-origin browser traffic already passes.

Visibility gating replaces the dead `canOpenPath` check: a gesture renders only when the probed id list resolves a backing app — `finder`/`explorer`/`filemanager` (in catalog order) for "open folder", the editor/IDE ids (cursor, vscode, …, the JetBrains family, in catalog order) for "open in IDE". The official open route accepts directories only, so both file gestures open the selected file's parent directory (the folder gesture already did; the IDE gesture previously passed the file itself, which a 0.1.5 host would refuse). The dead loopback gate is gone with it: the official header button does not gate on loopback either — a remote browser's click launches on the host, which is the capability's defined semantics — and the now-unused `connection` service, the mirrored `host-description.ts` module, and the `@deepseek-ai/dsh-client-connection` dependency leave the package together.

## Alternatives considered

**Waiting for / proposing `remote.session.canOpenWorkspacePath`.** Rejected: the seam does not exist upstream and the 0.1.5 open-in-app capability is the official answer; a proposal would re-litigate a shipped decision.

**Importing `@deepseek-ai/dsh-host-open-in-app/shared` instead of mirroring the constants.** Rejected: the specifier is not a platform module, an inline-safe wire layer, or a generated `/remote` contribution, so the bundle purity gate fails the build; adding the package to the inline-safe list for three strings buys nothing over a provenance-commented mirror.

**Depending on `@deepseek-ai/dsh-client-ui-open-in-app` and reading its controller state.** Rejected: cross-plugin runtime coupling for a probe that is twenty lines of fetch; the independence rule allows integration only when the sibling's absence is invisible, and here the sibling adds nothing we need.

**Keeping the loopback conjunct in the gate.** Rejected: open-in-app's routes authenticate through the connection trust fence, not loopback, and the official consumer shows the button to any authenticated browser; a local-files-only loopback rule would diverge from the capability's semantics for no gain.

## Consequences

On hosts ≥ 0.1.5 the gestures return; on 0.1.2–0.1.4 hosts the probe fails and the gestures stay hidden, so `minHost` stays at 0.1.2-rc.1 and the Compatibility tables gained a per-line verdict instead of one blanket degrade. The gestures now open directories only — opening a single file in an IDE is not expressible through open-in-app. App choice is fixed by catalog order (first resolved file manager / IDE); the official split button's per-user choice menu was deliberately not ported — if users ask to pick the IDE, that menu is the follow-up. Coverage: `tests/open-in-app.client.spec.ts` pins the probe outcomes (ok / 404 / network failure / malformed payload), the shared-read invariant, the open-route POST shape, and both pickers' preference order. ui-file-preview and worktrees carry the same dead gate and their own `dsh.compat.notes` follow-up; they move onto the same pattern in their own changes.
