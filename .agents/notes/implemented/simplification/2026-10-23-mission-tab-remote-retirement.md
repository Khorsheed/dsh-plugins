# Agent Note: the mission 任务 tab and its Typert Remote data face are retired

Status: implemented

## Problem

The mission package carried a web session tab (the 任务 tab: a five-bucket queue table with retry, release-check, and a per-guarded-layer export dialog) over its own Typert Remote data face (wire namespace `mission`). Three facts made that surface dead weight:

1. **The default evaluation preset has not shown it since I5 · T46** — ui-spec R6 settles that the word "mission" never appears in evaluation mode, so the tab's self-hide criterion (the preset composition naming the `@khorsheed/dsh-mission/tool` row) is never satisfied on the product's main line. It only appeared for overlay presets that re-grant the row.
2. **Every human gesture it carried already exists in eval's 实验室 tab.** The RunsPage drawer offers retry with reason and category, asks the release gate, and runs the export dialog with per-guarded-layer acknowledgement — forwarding through eval's own Remote to mission's service-face gate (`exportPlanGated` / `exportRunGated`), never touching mission's client half.
3. **Its Remote shape predates T97 and broke in subagent-routed sessions.** Every method takes `agent` as its first parameter, and the Typert gateway refuses to resolve an agent for a session owned by subagent routing (`session/agent-busy`), so the tab failed with 队列加载失败 in exactly the sessions a developer watches during multi-agent work. Fixing it meant a T97-style session-less reshape of a surface the default composition hides.

The Remote face had exactly one consumer: the tab. lab reads mission state through the CLI (`--json`), eval through the in-process structural face (`ctx.get('mission')`).

## Decision

The browser half and the Remote data face are removed; the package becomes host-only:

- Deleted: `src/client/` (the tab, its store, locales, preset-visibility), `src/remote.ts`, the `./client` / `./remote` / `./typert` exports, the `dsh.client` block, the typert artifacts from `files`, and the gen-typert build step (the package leaves `TYPERT_PACKAGES` in `scripts/gen-typert.mts`).
- The wire-only types (`MissionQueueRequest` / `MissionQueueResult` / `MissionGetRequest` / `MissionRefRequest` / `MissionRetryRequest` and the `*Wire` / detail types) leave `src/types.ts`; the export request/view types stay — the service face's gated export uses them.
- Unchanged: the service face, the `dsh-mission` CLI, the `/mission` slash face, and the `./tool` composition entry with its model tools and prompt section. mission remains the evaluation family's ledger and release gate exactly as [the seams note](../architecture/2026-10-01-eval-family-seams.md) scoped it.
- The peer dependency set shrinks to what the host half imports (cordis, dsh-commands, dsh-tools, schemastery); the client/remote-only peers and dev dependencies are gone.

## Alternatives considered

- **Keep the tab, reshape its Remote the T97 way (session-less methods).** Rejected: it invests in a surface the default preset hides and whose gestures the 实验室 tab already covers; the only unique feature was the cross-run raw queue table, and eval runs are the only runs in practice.
- **Deprecate the whole package, or fold it into eval or lab.** Rejected — this restates [the seams note](../architecture/2026-10-01-eval-family-seams.md): no capability moves between packages. eval's run verb creates one mission per cell rep and reads the ledger through the structural face; lab's release gate and CLI reads stand on it. Folding into lab would also make eval's host path depend on the container package, breaking the "host path works without Docker" layering.
- **Keep the Remote as a public headless data face.** Rejected: a data face with no consumer is a compat surface to maintain for hypothetical callers; the CLI already serves scripts, and a future surface (e.g. scheduled tasks) would get its own design rather than resurrecting this one.

## Consequences

- The conversation tab strip in evaluation sessions loses the 任务 entry (it was already hidden there); sessions on overlay presets that grant `mission-tool` lose the tab as well — the gestures remain available in the 实验室 tab (eval runs) and via CLI/slash (any run).
- The `session/agent-busy` load failure in subagent-routed sessions disappears with the tab.
- ~1,100 lines of client code, the typert generation step, and eleven client-only dependency entries leave the package; the published tarball no longer carries `lib/client.js` or the typert artifacts.
- `docs/plugin-visibility.md`'s inline preset-visibility copies drop from four to three (eval / datasets / room remain).
- gen-typert's spec fixtures move from mission to datasets; the remote-namespaces survey drops mission's row.
- Breaking for external consumers of `./client` / `./remote` / `./typert` (none exist in-repo; the wire namespace `mission` goes away). The next release line must note it.
