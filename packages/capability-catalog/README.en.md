# @khorsheed/dsh-capability-catalog

English | [中文](README.md)

Every skill and tool the running instance actually has — who registered it, which mode loads it — in one settings tab, with new skills and MCP servers installable in place.

dsh composes each session from an agent preset, and plugins, skill roots, and MCP servers all register capabilities into it — but the host ships no surface that lists them, so "what can this agent do, and where did that tool come from?" had no answer short of reading logs. This plugin adds a standalone settings tab (工具与技能) that answers it for a human, and a `list_capabilities` tool that answers it for the model.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/capability-catalog-1.png" width="640" alt="the 工具与技能 settings tab: a three-column skill grid with source badges, search and sort, and the mode picker">

## Features

- **Skills at a glance** — a three-column preview grid (name, one-line description, source/provider badge) with search, sort, and a 内置/插件/其他 segment filter. Click a card for the detail modal: full description and invocation meta, a unified source browser (bundle file tree on the left, content pane on the right — a content-only skill renders as a single virtual `SKILL.md` node), frontmatter metadata (secret-shaped values render as `···`), and a credential form for every env the skill declares, parsed from `metadata.credentials` and from `$ENV` / `process.env.X` / `env['X']` / `{{env:X}}` references in the body. Values land in the dsh credential store and never cross the wire.
- **Tools with channel attribution** — collapsible cards that say where each tool came from: the author-declared origin tag (exact), the `mcp__` prefix (exact), a generated official-tools whitelist (exact), or an apply-time baseline diff (inferred). A detail modal shows the parameter schema as a tree or raw JSON.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/capability-catalog-2.png" width="640" alt="the skill detail modal: bundle file tree on the left, content pane on the right, and the credential form for the skill's declared env vars">

- **Install a skill three ways** — one modal: upload (a `SKILL.md`, a `.zip` containing one, or a whole skill folder, read by a dependency-free `node:zlib` zip reader); install from source (an `owner/repo`, a git URL, or a whole pasted `npx skills add <repo> [--skill <name>]` command — GitHub in-repo paths and `tree/`/`blob/` URLs normalize to the same clone, and only `github.com` is split into owner/repo, so GitLab subgroups survive); or pick skills from a local directory. Each source chooses the target root (`$DSH_HOME/skills` or `.agents/skills`) and whether the skill enters the model catalog; the skill-filesystem watcher discovers the result on its own.
- **The mode view** — every session is composed from an agent preset (「模式」), and each preset registers a different set of skills and tools. The mode control beside the search box reads one preset's face (`snapshotAt(presetId)`) — the grid is that mode's face and nothing else — and 全部模式（对比） reads every mode in one call (`modeFaces`) and tags each card with the modes that load it, so "which modes does this capability appear in?" is one click. A mode that cannot be read is reported as unavailable, never rendered as an empty face.
- **Preset-scoped skills** — the plugin owns a managed root (`$DSH_HOME/capability-catalog/skills`) whose skills declare the presets they belong to in frontmatter `presetScope`; the detail modal edits it (save, adopt an installed skill into the managed root, release it back to the user root), and a diagnostic row keeps managed skills no mode loads reachable instead of hidden.
- **MCP server management** — paste an `mcp.json` server entry and the dialog parses the transport and detects credentials (a credential-looking field becomes a `secretRef:` marker in the stored config, and the Remote only ever reports `configured` state — values never reach the browser). Connect to discover a server's tools, toggle a whole server or a single tool, and every enabled tool is registered on `ctx.tools` as `mcp__<server>__<tool>` so the model can call it. Configured servers survive restarts through the settings service.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/capability-catalog-3.png" width="640" alt="MCP server management: a server added from a pasted mcp.json entry, connected, with its discovered tools and per-tool toggles">

- **`list_capabilities` for the model** — a model-facing tool that lists the skills and tools visible in the caller's own agent scope, stamped with the capability fingerprint tag.
- **A capability fingerprint** — `snapshotFor(presetId?)` loads every skill body and stamps a sha256 over the canonical capability face (names, sources, channels, parameters, body hashes — prose excluded), so two instances registering the same capabilities in a different order hash alike; `hashOf` / `capsTag` are exported for host-side readers.
- **Credential env injection** — a configured credential for a skill's declared env var is exposed to the model's shell as a trusted, per-execution `DSH_<KEY>` variable, referenced by shell expansion so the raw value stays out of the model's context by default; when the `skill` tool loads such a skill, a runtime hint tells the model each `KEY → DSH_<KEY>` mapping without touching the `SKILL.md`.
- **The tool-origin convention** — `setToolOrigin` / `TOOL_ORIGIN` are exported so any plugin can tag its tools before `ctx.tools.register` and be attributed exactly; the tab ships a help modal with a copyable prompt that teaches a coding agent to do the tagging.
- **Degrades, never explodes** — zero host edits; everything rides existing official services through `ctx.get`, and a composition missing `ctx.skills` / `ctx.tools` / `ctx.credentials` / `ctx.agentPresets` renders an empty state instead of failing boot.

## Install

```sh
dsh plugin --profile web add @khorsheed/dsh-capability-catalog
```

Restart the web instance to activate; the 工具与技能 tab appears in Settings, right after the Plugins section. Uninstalling removes the row exactly:

```sh
dsh plugin --profile web remove @khorsheed/dsh-capability-catalog
```

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`): ✅ full — 0.1.5-rc.1 full-line boot-verified (42 packages including capture, 2026-09-25) through three compat layers: the [preset-registry dual-name probe](../../.agents/notes/implemented/bug-fix/2026-09-25-preset-registry-dual-name-probe.md), [dual-shape typert codecs](../../.agents/notes/implemented/bug-fix/2026-09-25-typert-codec-dual-shape.md), and [typert faces carrying zod@4](../../.agents/notes/implemented/bug-fix/2026-09-25-typert-faces-carry-zod-v4.md). `minHost` is 0.1.5-rc.1, and 0.1.95 is this package's first published release — older hosts have no compatible line.
- source line (deepseek-harness master): ✅ (verifiedHost: 0.1.7-rc.1) — 0.1.7-rc.1 is also the 3080 production-verified line.

Per-mode capability reads (the mode picker, `snapshotAt` / `snapshotFor` / `modeFaces`, preset-scoped skill delivery) resolve a preset's standing scope through whichever roster face the host line offers: lease-free `standingKeyFor` on 0.1.5, the leased `acquireScope` on rc.1 — rc.1 removed `standingKeyFor`, and catalog builds before this dual-face fix silently read the global layer on rc.1. The lease is released after every read, on the listing and the fingerprint path alike. Machine-readable: `dsh.compat` in `package.json` (`minHost`, `verifiedHost`, `notes`).

## Known Limitations

- **Credential injection is default-hide, not a secret boundary** — a crafted prompt can still make the model `echo $DSH_KEY`. For "the model never holds the raw value", the [masked-credential-proxy proposal](../../proposals/active/2026-08-29-masked-credential-proxy.md) is the harder edge.
- **Untagged plugin tools fall back to heuristics** — a tool whose author did not set an origin tag may be listed under 内置/builtin; the tab's 「为什么我的插件工具不在这里？」 modal (and [docs/tool-origin-guide.md](../../docs/tool-origin-guide.md)) explains the one-line fix.
- **The MCP bridge covers the text-result case** — discovered tools are registered text-in/text-out, without image/attachment projection; and on a composition without the settings service, MCP server state is in-memory only and resets on restart.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**Architecture.** The host half is `CapabilityCatalogService`, a Typert Remote service in the `capabilityCatalog` namespace; the browser half mounts the generated Remote via `ctx.remote.$mount` and registers a standalone `settings.section` slot (id `capabilities`, order 20 — right after Plugins) through `slots.inject`, so apply order never matters. The identity triangle is the `capability-catalog` row id in `cordis.patch.yml`, the npm name, and `src/invariant.ts`'s `PACKAGE_NAME`. The package root exports the service, the fingerprint helpers (`hashOf` / `capsTag` / `canonicalCapabilities`), the preset-scope/delivery primitives, and the tool-origin helpers; `/client` exports the browser plugin body.

**Channel attribution.** `ToolSchema` carries no source field, so a tool's channel is resolved in precedence order: the author-declared origin tag (a `Symbol.for('dsh.tool.origin')` property on the retained definition, read back via `ctx.tools.get(name)` — the system-prompt projection strips it, so it never crosses the model wire), then the `mcp__` prefix (server name by longest configured-prefix match), then a generated official-tools whitelist (`scripts/gen-official-tools.mts`, generated from the pinned harness checkout), then an apply-time baseline diff. The baseline is taken inside the deferred `ctx.inject(['tools'], …)`, so the registry's own mount order cannot produce an empty baseline that mislabels every tool as plugin.

**The mode view.** An instance composes every session from an agent preset: the shipped standard / minimal / PTC / 创造 presets plus deployment- or user-authored ones, each registering a different set of skills and tools. Picking a preset reads the catalog at that preset's standing scope (`snapshotAt(presetId)`), and the grid is that mode's face and nothing else — a skill delivered only to 写作模式 does not appear under 开发模式, and the tab's counts are the mode's counts. 全部模式（对比） reads every preset's face in one call (`modeFaces`) and shows the union, with a chip row on each card naming the modes that load it; a capability in every readable mode collapses to one `全部模式 · N` pill, and a long partial list shows two chips plus `+N`, expanding in place. A mode that cannot be read (a broken composition, a roster that resolves no standing scope) keeps its row and is reported as unreadable rather than rendered as an empty face — "this mode loads nothing" and "this mode could not be read" are different claims. An unscoped managed skill (no `presetScope`) is delivered to every preset; one scoped to a preset this deployment does not supply appears in no mode's face, and the tab then shows it under a diagnostic line (`N 个受管 skill 未在任何模式生效`) whose cards open the detail modal, where its scope can be changed or released — without that list, filtering by mode would make such a skill unreachable rather than merely hidden. Reading a mode is not free: resolving a preset's standing scope MOUNTS its composition (the roster's single-flight standing mount), so the comparison is an explicit choice, never done on open; the client reads faces once per session behind a single-flight cache shared with the detail modal. Detail and delete follow the same read position: opening a card reads that capability's detail and bundle at the mode the card came from, and a delete targets the same one.

Card badges name the source (插件 / 内置 / 用户 / 项目 / 自定义); a managed skill's `preset` scope is policy, not provenance, so it is shown where that policy is the subject — the orphan list and the detail modal.

**A preset scope is editable only where the host will write one.** The detail modal's 「生效的 preset」 section writes `presetScope` into the frontmatter of a skill in the managed root, so the section says which shape it is instead of offering a Save the host refuses (`"<name>" is not a managed skill`):

| skill | what the section shows |
|---|---|
| in the managed root | the preset grid + 保存 + 释放回用户技能目录 |
| user / project / custom root | the preset grid + 移入受管目录并可限定 preset (no 保存: the selection is the scope adopt installs it with) |
| plugin-provided (`runtime`) | why it cannot be set, plus the modes that actually load it (chips from the shared faces cache) |
| built-in (`bundled`) | why it cannot be set — it follows the deployment composition |
| no roster / no managed delivery in this deployment | the unavailable note |

The modal's frontmatter-metadata block prints the metadata keys that have no dedicated surface: `presetScope` (the editor above) and `credentials` (the credential form) stay out of it, so a skill that merely declares a credential does not grow a raw JSON block; secret-shaped values (a key matching `key|token|secret|password`) render as `···`.

**The capability fingerprint.** A snapshot is a LISTING — registration order, human wording, file mtimes. The capability FACE is what remains when everything that is not a capability is removed, and `hashOf` is its sha256:

| Row | What enters | What does not |
|---|---|---|
| skill | `name`, `source`, sha256 of the SKILL.md body | description, whenToUse, provider, `updatedAt` |
| tool | `name`, `channel`, `parameters` | description, confidence, owner |
| mcpServer | `name` + its tool NAMES | the tool count (derived) |
| channel | the names | the counts (derived) |

Every list is sorted by name and the digest is taken over canonical JSON, so two instances registering the same things in a different order hash alike. The exclusions are the claim: prose is not a capability — rewording a tool description changes what the model reads, not what it can do. A skill's BODY is the opposite (it is the procedure), so it enters as a sha.

```ts
import { hashOf, capsTag } from '@khorsheed/dsh-capability-catalog'

const face = await remote.snapshotFor('eval-lean')   // sha already stamped
capsTag(face.sha)          // 'caps:2f8b6d40…'
hashOf(face) === face.sha  // true — the `sha` field is not part of what it digests
```

`snapshotFor(presetId?, workdir?)` is the fingerprint verb: it reads the skill and tool registries at that preset's standing scope, loads every skill body so the rows carry `bodySha`, and stamps `sha`; `presetId` omitted reads the deployment default. `snapshot()` stays the listing verb — same rows, no body loads, no digest. `list_capabilities` reports the full face's tag as `capabilities`, even when the caller filtered the answer to skills or tools.

A listing degrades; a fingerprint refuses. When the preset's scope cannot be resolved — no roster, unknown id, a composition that will not mount — `snapshot()` falls back to the global layer and carries no `preset` label, because a settings card must not go blank over a bad row; `snapshotFor()` throws instead, naming the preset and the reason. Two costs are worth naming: fingerprinting loads one skill body per skill (the listing path does not), and asking for a preset nothing has composed yet MOUNTS it — the roster's standing mount is what "that preset's scope" means. Who uses it: an evaluation records the orchestrating instance's own hash in `run.meta.orchestrator.capabilities` as provenance, and a condition that declares a `preset` must carry the hash of its provisioned environment in its lock — which is what turns that declaration from a claim into a fact.

**Skill credential env injection.** A configured credential for a skill's declared env var is exposed to the model's shell so the skill can query. Two pieces, both service-agnostic and generic (derived from each skill's own env-decl keys — no hardcoded key):

- `ctx.shellEnv` injects each configured credential as a trusted, per-execution `DSH_<KEY>` variable. The model uses it by shell expansion (`KEY="$DSH_KEY" <cmd>`), so the raw value never enters the model's context by default (it only becomes visible if the model actively echoes it — a default-hide, not a hard secret boundary). Keys mapping onto the reserved built-ins (`DSH_HOME` / `DSH_SHELL` / `DSH_SESSION_ID`) or already owned by another contributor are skipped with a warning, so one bad key cannot break the whole registration. If `ctx.shellEnv` / `ctx.credentials` / `ctx.skills` are absent, or a session has no skill, this is a no-op.
- Runtime companion hint — the model won't derive the `KEY → DSH_<KEY>` alias on its own, so when the `skill` tool loads a skill with configured credentials, the catalog appends a per-skill note (`tools/post-execute` + `additionalContexts`) listing each mapping and how to use it. It never touches the user's `SKILL.md`.

The credential store is the dsh credential store (`.credentials.yaml`, ref space); reads use `credentials.resolve(decl.key)` / `describe(decl.key).configured` (presence only, never the value) and writes `set(request.key, value)`, validated with a local POSIX ref-name check — no runtime `@deepseek-ai/dsh-credentials` import, so degradation stays graceful when it is absent.

**MCP management.** Configured servers persist through the settings service on both host lines — 0.1.5's free-form `settings.register` namespace, 0.1.7's volatile plugin Config field through SettingsForms with the `settings/document-updated` round-trip — and degrade to an in-process store when settings is absent. The persisted block stores only tool names and toggle flags (descriptions and parameter schemas would bloat `settings.yaml` and go stale), so boot reconnects enabled servers asynchronously to refill them; boot is not blocked, and each server's errors are contained. Discovered tools register on `ctx.tools` under the stable `mcp__<serverName>__<rawName>` contract, normalized to the function-name constraints (a sha256 suffix disambiguates a lossy normalization); registration is a dispose-then-register reconcile that always invokes `register` as a member call on the traceable service proxy. Credential-looking config fields become `secretRef:` markers resolved through `ctx.credentials` at connect time — `mcpSnapshot` reports only `configured` state, and the markers never leave the host.

**Plugin skill registration protocol.** The contract the catalog relies on to render a skill's file tree. A skill is discoverable two ways: filesystem/provider discovery (`@deepseek-ai/dsh-skill-filesystem` scans a configured root for `<name>/SKILL.md`; these already carry `resourceBase: { kind: 'directory', path }`, so the catalog lists their bundle files automatically), and runtime plugin registration (`ctx.skills.register(...)`), where the catalog can list a skill's bundle files only if the plugin exposes them:

```ts
ctx.skills.register({
  name: 'my-skill',
  description: '…',
  content: '…',                  // the SKILL.md body
  source: 'runtime',
  provider: 'my-plugin',         // optional; labels the catalog card
  resourceBase: {                // expose the bundle so it can be browsed
    kind: 'directory',
    path: <absolute path to the plugin's skills/<name> directory>,
  },
})
```

When `resourceBase.kind === 'directory'`, the catalog walks `resourceBase.path` and shows the bundle as a file tree, and the model's relative-resource resolution can reach those files too. Asking the catalog to "scan every plugin package" is deliberately not done: the registry is the source of truth for what is installed, and it already attributes each skill to its provider. A content-only skill (a single self-contained `SKILL.md` with no scripts, assets, or references beside it) should omit `resourceBase` rather than point at a directory holding only `SKILL.md` — the browser renders it as a single virtual `SKILL.md` node, and `files` is reported only when a bundle exists.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/capability-catalog`). Issues and contributions welcome there.
