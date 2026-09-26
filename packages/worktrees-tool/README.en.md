# @khorsheed/dsh-worktrees-tool

English | [中文](README.md)

Let the model manage git worktrees itself — but hand the key only to sessions that are granted it.

The core plugin `@khorsheed/dsh-worktrees` brings the worktree badge, the sidebar drawer, and the global service to every session; whether the *model* may create, switch, or remove worktrees should be a per-mode, per-session decision. This companion package is that key: a preset tool row that registers the model-facing `worktrees` tool — sessions whose preset names the row get the tool; everywhere else the model never sees it.

## Features

- **One tool, four actions** — `list` / `switch` / `create` / `remove` on the `worktrees` tool: enumerate the session repository's worktrees (path, branch, main?, dirty count, stale hint); switch which worktree the session follows (badge and drawer move with it); `git worktree add` a new one and switch to it; remove one after confirmation.
- **Removal has service-side hard gates** — `remove` requires `confirm: true`, and the service refuses the main worktree and any worktree with uncommitted changes — enforced in code, not merely requested in the prompt.
- **Granted per session** — the row lives only inside agent-preset compositions, never at the profile root: sessions of a preset that names it get the tool; every other session is unaffected.
- **Zero copied logic** — the tool-definition factory is exported by the core (`defineWorktreesTool(service)` from `@khorsheed/dsh-worktrees/tool`); this row is a thin adapter that registers the definition into the host tools registry.
- **Pending without the core, never broken** — the core service is a declared `inject = ['worktrees']` (the owning-family companion exception): while the core is unmounted the row stays pending (the registry audit shows `waiting for worktrees`), the preset still mounts cleanly and reports no error; once the core provides, the row activates and the tool registers. Registration goes through deferred `ctx.inject(['tools'])`, so compositions without a tools registry are equally safe.
- **Attributed to this package** — the tool carries the `dsh.tool.origin` tag (owner = `@khorsheed/dsh-worktrees-tool`), so the capability catalog attributes it to the row that mounts it, not to the core.

## Install

The core still installs globally as before (badge / drawer / service / Remote all live in the core); the companion row only needs to be resolvable in the profile's node_modules — it never self-mounts:

```sh
dsh plugin --profile web add @khorsheed/dsh-worktrees
dsh plugin --profile web add @khorsheed/dsh-worktrees-tool
```

Then name the row in the target preset's `agent.cordis.yml` (copy the shipped standard preset and edit it):

```yaml
- id: worktrees-tool
  name: '@khorsheed/dsh-worktrees-tool'
```

The web-dev pack's dev-mode preset (`profiles/web-dev/presets/dev`) already carries this row; its `install.sh`/`update.sh` drops the preset into `$DSH_HOME/.agent-presets/dev`.

Profile-composition changes (add/remove) take effect after restarting the web instance; a preset row takes effect as sessions of that preset mount. Before removing this package, drop the preset rows that reference it — a preset composition pointing at an uninstalled package reports `broken` (row-resolution failure): the instance boot is unaffected, but that preset's sessions don't get the intended composition.

```sh
dsh plugin --profile web remove @khorsheed/dsh-worktrees-tool
```

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`): ✅ full — the 0.1.5 plugin list renders this row in its "session plugins" group (short-name title, state badge, live-mount phase dot); with the package removed, a preset composition naming it reports `broken` (row-resolution failure) while the instance boots unaffected.
- source line (deepseek-harness master): ✅ (verifiedHost: 0.1.5-rc.1).
- Hosts below 0.1.5: preset compositions existed on earlier lines, but the session-plugins inventory view is 0.1.5 presentation — minHost pins 0.1.5-rc.1.

**Version-line map**: `0.1.0` and later support host `0.1.5-rc.1` and up.

## Known Limitations

- **With the core absent, the tool is not there** — the row stays pending (the registry audit shows `waiting for worktrees`) and the preset mount does not fail; the model simply has no `worktrees` tool in those sessions, and the row activates on its own once the core is mounted. That is the designed behavior, not a malfunction.
- **The session's own repository only** — the tool derives the target repo from the session cwd and cannot point at an arbitrary repository; a session without a working directory gets `{ error: 'worktrees: session has no working directory' }`.
- **"Ask the user first" is model discipline** — the service enforces three hard rules (`confirm: true`, never the main worktree, never a dirty one); "always confirm with the user before removing" lives in the tool description, and honoring it is up to the model.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**Row shape.** The Cordis entry exports `name = 'worktrees-tool'`, `inject = ['worktrees']` (a declared dependency on the core service), and zero `ctx.provide` — the preset mount plane's isolate-realm rule rejects only service rows, so a tool row composes bare (the official `tool-bash` shape). The package deliberately declares no `dsh.bundle`: `dsh plugin add` only makes the module resolvable (a plain dependency, the `@khorsheed/dsh-local-agent-dsh-headless` precedent) and auto-mounts nothing; the manifest's `dsh.composition.component: 'preset-composed-row'` marks the shape. This is the first link of the single-instance multi-mode chain (proposal 2026-08-26): community model tool rows live in presets, never at the profile root.

**One declared inject, one deferred injection.** The core's global service is a declared `export const inject = ['worktrees']` (the owning-family companion exception — `COMMUNITY_SERVICE_INJECTORS` in `scripts/check-plugin-independence.ts`): a preset's standing scope mounts at registry-activation time, before the profile's later bundle rows provide the core, so a one-shot `ctx.get` probe at apply saw ABSENT and nothing ever re-ran the row (the rc.1 boot order; observed in production on 3080, 2026-09-27). The declared inject pends the row until the core provides, then the body applies — while pending, the registry audit shows `waiting for worktrees` and the preset mount itself is unaffected. The in-body `ctx.get('worktrees')` guard stays as the defensive direct-call path (tests invoke `apply` without the loader's inject machinery). The tool still registers through deferred `ctx.inject(['tools'])`: a direct `ctx.get('tools')` at apply time races the tools registry's own mount order on the real composition tree and loses (silently never registering), while `ctx.inject` fires when the registry appears and never fires in a composition without one.

**Execute path.** The tool's `execute` is a thin adapter over the core service: it takes the session id and cwd from `exec.agent` and dispatches to `service.listWorktrees` / `switchWorktree` / `createWorktree` / `removeWorktree`; the return is always a JSON string (`{ ok: true, … }` or `{ error: … }`) rendered as plain text. `switch`/`create` set the session's active-worktree override so the badge and drawer follow; a successful `remove` clears the override when it pointed at the removed worktree.

**Plugin-list presence.** The package ships locale metadata (`meta.title`: Worktrees Tool / 工作树工具); the 0.1.5 plugin list renders the row in its "session plugins" group per preset composition.

**Exports.** The entry exports the loader contract trio (`name` / `inject` / `apply`); there is no browser half — the badge and drawer UI are the core's concern.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/worktrees-tool`). Issues and contributions welcome there.
