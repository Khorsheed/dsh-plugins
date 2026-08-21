# dsh-taskpilot

[中文](README.md) | English

Two capsule entries above the composer card — "Background jobs" and "Subagents" — for viewing, stopping, interrupting, and opening a job detail drawer. A pure plugin; zero product changes.

```
[● Background jobs 1]  [● Subagents 3]    ← resident entries, empty states stay visible
     ▼ expand                                    ▼ expand
  ● bash · pnpm build --watch · 1:02:33 [⏹]   ● analysis · 0:05:23 · 1.5K [⏹]
  ○ bash · older task      · 0:30          ○ docs · 0:30 · 60K
```

## Features

- **Jobs capsule**: all background jobs of the current session (live first), ticking once per second, a stop verb on running rows (same visual language as the composer stop button), and a click-through to the detail drawer.
- **Subagents capsule**: the current session's **whole subagent lineage** (direct children plus deep descendants, the same index the header tree counts), with live duration and token spend, an interrupt verb on running rows (deep descendants authorize through their direct parent), and a click-through to the subagent conversation.
- **Consistent with the title lists**: the capsules read the same `jobsBySession` / `subagentsByParent` mirrors and session summaries the header lists read — consistency by construction.
- **Detail drawer**: right-side overlay with the job's command/kind/status/start-end/duration plus an execution trail folded from the session log (the start row carries the full command and parameters exactly as the model issued them, followed by each `job_output` delta, stop, completion notice; collapsed by default, expand on click).
- **Session-scoped with per-capsule visibility**: switching sessions switches data; each capsule renders only when its own data is non-empty — no jobs, no jobs capsule; no subagent lineage, no subagents capsule; neither, nothing.
- **Zero intrusion**: rides product extension points only (slots, commands, sessions mirrors, session log); no new RPC surface, no product files touched.

## How it works

The capsules are pure presentation over the product's existing mirrors and projections:

- Jobs: `useSessions(jobsBySession[sessionId])` — same source as the header job list.
- Subagents: the whole lineage folded from session summaries `byId` (`indexSubagentDescendants` count matches the header tree; four-bucket token sum, `settledMs + active` duration).
- Stop/interrupt: two verbs registered on the product's `commands` extension point (`/taskpilot-stop <jobId>`, `/taskpilot-interrupt <childId> [parentId]`), authorized through the dispatching session agent (deep subagents pass their direct parent); the UI calls them via `ctx.remote.commands.execute`.
- Trail: replays the session log through the product's `sessions.history` RPC — never touches the consumptive `jobs.read` output cursor.

## Install

One command installs into a profile and activates the patch layer (`dsh.bundle` declared; idempotent by package name):

```sh
dsh plugin --profile web add @khorsheed/dsh-taskpilot
```

Or from GitHub (built automatically via `prepare` on install):

```sh
dsh plugin --profile web add github:Khorsheed/dsh-taskpilot
```

Restart the host afterwards. Uninstall:

```sh
dsh plugin --profile web remove @khorsheed/dsh-taskpilot
```

Custom profiles can compose the row by hand:

```yaml
- insert:
    - id: taskpilot
      name: '@khorsheed/dsh-taskpilot'
```

From source — clone, build, test:

```sh
git clone https://github.com/Khorsheed/dsh-taskpilot.git
cd dsh-taskpilot && pnpm install && pnpm run build && pnpm test
```

## Configuration

None (all defaults). The capsules register at `conversation.input.dock` order 30 and the drawer at `shell.overlay` order 120, alongside the other dock residents (todo/goal/queue).

## Development

```sh
pnpm install
pnpm run build     # tsc emits types (lib/types + lib/types/client), tsdown bundles (index.js + invariant.js + client.js)
pnpm run typecheck # host + client aggregates (mirrors the product split; avoids ctx merge conflicts)
pnpm test          # vitest: trail folding + capsule/drawer component tests
```

**Type resolution during development**: the product's npm release chain is not complete yet (client packages depend on unpublished `@deepseek-ai/dsh-compact`), so the two tsconfigs resolve product types through `paths` into a local deepseek-harness checkout's `lib/types` artifacts. The path map is gitignored and machine-local: regenerate it with `node ../../scripts/sync-harness-paths.mjs` (honors `DSH_HARNESS`, default `~/code/deepseek-harness`). Once the release chain is fixed, plain npm dependencies work.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.1-rc.1`): ✅ full — built and tested against the rc.8 type surface. This build REQUIRES rc.8: the `commands/execute` Remote gained a required `images` argument (rc.6/rc.7 hosts would receive shifted arguments) — stay on the previous build there. — also verified on 0.1.1-rc.1 (additive audit, 2026-08-21)
- source line (deepseek-harness master): ✅

## Known limitations

- The drawer's **execution trail is model-perspective**: it contains only the `job_output` deltas the model actually read (and that survived log truncation); the full raw output (spill files for over-cap streams) is not shown.
- After log compaction, older jobs may show only summaries or nothing.

## License

MIT
