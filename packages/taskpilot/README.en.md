# @khorsheed/dsh-taskpilot

English | [中文](README.md)

See every background job and subagent at a glance above the composer — and stop any of them on the spot.

Once the agent starts background jobs or fans out a tree of subagents, you used to dig through the header list to follow along. This plugin puts two small capsules above the composer: one lists the current session's background jobs, the other the full subagent lineage, each with live timing and token spend. Stop any of them with one click; for a closer look, open the detail tab in the right sidebar — command, status, and the execution trail are all in there.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/taskpilot1.png" width="640" alt="the subagent pill rides above the composer — open it to inspect or interrupt runs">

## Features

- **Jobs capsule** — all background jobs of the current session, ticking once per second, a stop verb on running rows, click-through to the detail tab; same source as the header list.
- **Subagents capsule** — the whole subagent lineage (deep descendants included), with live duration and token spend, an interrupt verb on running rows, click-through to the subagent conversation. One-shot external-CLI rows delegated to the local-agent family (which have no live agent) are recognized through the family's read-only delegation poll and carry the interrupt verb while their run is in flight.
- **Detail tab** — a page-type tab in the official right sidebar with command/kind/status/start-end/duration plus an execution trail folded from the session log, collapsed by default. Opening another job re-navigates the same tab; the sidebar owns all geometry (width, fullscreen, docking), so the plugin ships no overlay or push-layout code of its own.
- **Session-scoped visibility** — switching sessions switches data; each capsule renders only when its own data is non-empty.
- **Zero intrusion** — product extension points only (slots, commands, mirrors, session log); no new RPC, no product files touched.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/taskpilot2.png" width="640" alt="background-job pills and the job detail tab">

## Install

```sh
dsh plugin --profile web add @khorsheed/dsh-taskpilot
# or from GitHub (built via prepare on install):
dsh plugin --profile web add github:Khorsheed/dsh-taskpilot
# uninstall:
dsh plugin --profile web remove @khorsheed/dsh-taskpilot
```

Restart the host afterwards; re-running add is safe (deduped by package name).

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`): ✅ full — the detail drawer migrated to the official right-sidebar tab surface (a page type registered into `ctx.sidebarRightTabs`, its body in the keyed `sidebar.right.pane.tab` seat), full build+test green; minHost moves up to 0.1.5-rc.1 — older hosts stay on the previous release line.
- source line (deepseek-harness master): ✅ (verifiedHost: 0.1.5-rc.1)

**Version line mapping**: the first release after `0.2.0` supports host `0.1.5-rc.1` and later; hosts on `0.1.2-rc.1` stay on `0.2.0`, hosts on `0.1.0-rc.6` ~ `0.1.1-rc.2` stay on the 0.1.x release line (last release `0.1.0`).

## Known Limitations

- The detail tab's **execution trail is model-perspective**: only the `job_output` deltas the model actually read (and that survived log truncation); full raw output (spill files) is not shown.
- After log compaction, older jobs may show only summaries.

## How it works

<details>
<summary>Internals (click to expand)</summary>

The capsules are pure presentation over the product's existing mirrors and projections:

- Jobs: `useSessions(jobsBySession[sessionId])`, same source as the header job list.
- Subagents: the whole lineage folded from session summaries `byId` (`indexSubagentDescendants` count matches the header tree; four-bucket token sum, `settledMs + active` duration).
- Stop/interrupt: verbs registered on the `commands` extension point (`/taskpilot-stop <jobId>`, `/taskpilot-interrupt <childId> [parentId]`), authorized through the dispatching session agent (deep subagents pass their direct parent); the UI calls them via `ctx.remote.commands.execute`. For a one-shot row with NO live agent (most commonly a local-agent family member — its child session is a pure CLI transcript container with no dsh agent), `/taskpilot-interrupt` routes the stop through the commands seam to `/local-agent stop <childSessionId>`, cancelling the family's in-flight delegation for that child; when the local-agent core is absent (the command does not resolve) it degrades to an explicit "cannot stop" error rather than pretending success.
- Trail: replays the session log through `sessions.history` RPC — never touches the consumptive `jobs.read` output cursor.

No configuration. The capsules register at `conversation.input.dock` order 30; the detail view is a page-type right-sidebar tab (kind `taskpilot`, opened via `ctx.sidebarRight.openTab`), alongside todo/goal/queue. Custom profiles can compose the row by hand:

```yaml
- insert:
    - id: taskpilot
      name: '@khorsheed/dsh-taskpilot'
```

Build and test: `pnpm install && pnpm run build && pnpm run typecheck && pnpm test` (tsc types + tsdown bundles; host/client aggregates; vitest covers trail folding and components).

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/taskpilot`). Issues and contributions welcome there.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
