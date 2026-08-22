# dsh-taskpilot

English | [中文](README.md)

Two capsule entries above the composer card — "Background jobs" and "Subagents" — for viewing, stopping, interrupting, and opening a job detail drawer.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/taskpilot1.png" width="480" alt="the sub-agent pill rides above the composer — open it to inspect or interrupt runs">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/taskpilot2.png" width="480" alt="background-job pills and the job detail drawer">

## Features

- **Jobs capsule** — all background jobs of the current session, ticking once per second, a stop verb on running rows, click-through to the detail drawer; same source as the header list.
- **Subagents capsule** — the whole subagent lineage (deep descendants included), with live duration and token spend, an interrupt verb on running rows, click-through to the subagent conversation.
- **Detail drawer** — right-side overlay with command/kind/status/start-end/duration plus an execution trail folded from the session log, collapsed by default. While open on a wide viewport it **pushes the conversation and composer left** by the drawer width so nothing sits underneath it; on narrow viewports (where the remaining chat column would be too cramped) it overlays instead.
- **Session-scoped visibility** — switching sessions switches data; each capsule renders only when its own data is non-empty.
- **Zero intrusion** — product extension points only (slots, commands, mirrors, session log); no new RPC, no product files touched.

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

- npm release line (`@deepseek-ai/dsh@0.1.1-rc.1`): ✅ full — built and tested against the rc.8 type surface. This build REQUIRES rc.8: the `commands/execute` Remote gained a required `images` argument (rc.6/rc.7 hosts would receive shifted arguments) — stay on the previous build there. — also verified on 0.1.1-rc.1 (additive audit, 2026-08-21)
- source line (deepseek-harness master): ✅

## Known limitations

- The drawer's **execution trail is model-perspective**: only the `job_output` deltas the model actually read (and that survived log truncation); full raw output (spill files) is not shown.
- After log compaction, older jobs may show only summaries.

## How it works

<details>
<summary>Internals (click to expand)</summary>

The capsules are pure presentation over the product's existing mirrors and projections:

- Jobs: `useSessions(jobsBySession[sessionId])`, same source as the header job list.
- Subagents: the whole lineage folded from session summaries `byId` (`indexSubagentDescendants` count matches the header tree; four-bucket token sum, `settledMs + active` duration).
- Stop/interrupt: verbs registered on the `commands` extension point (`/taskpilot-stop <jobId>`, `/taskpilot-interrupt <childId> [parentId]`), authorized through the dispatching session agent (deep subagents pass their direct parent); the UI calls them via `ctx.remote.commands.execute`.
- Trail: replays the session log through `sessions.history` RPC — never touches the consumptive `jobs.read` output cursor.

No configuration. The capsules register at `conversation.input.dock` order 30 and the drawer at `shell.overlay` order 120, alongside todo/goal/queue. Custom profiles can compose the row by hand:

```yaml
- insert:
    - id: taskpilot
      name: '@khorsheed/dsh-taskpilot'
```

Build and test: `pnpm install && pnpm run build && pnpm run typecheck && pnpm test` (tsc types + tsdown bundles; host/client aggregates; vitest covers trail folding and components).

**Type resolution during development**: the product's npm release chain is not complete yet (client packages depend on unpublished `@deepseek-ai/dsh-compact`), so tsconfig `paths` resolve product types into a local deepseek-harness checkout's `lib/types` artifacts; the path map is gitignored — regenerate with `node ../../scripts/sync-harness-paths.mjs` (honors `DSH_HARNESS`, default `~/code/deepseek-harness`).

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/taskpilot`). Issues and contributions welcome there.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
