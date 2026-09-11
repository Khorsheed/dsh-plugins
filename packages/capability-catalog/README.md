# @khorsheed/dsh-capability-catalog

A catalog of every skill and tool registered in a running dsh instance, with its
registration channel (official builtin / project / user / custom / plugin runtime).
It drives a standalone settings tab (工具与技能) and a model-facing
`list_capabilities` tool.

English | [中文](README.zh.md)

## What it shows

- **Skills** as a 3-column preview grid (name + one-line description +
  source/provider pill). Click a card to open a centered modal with the full
  description, source/provider/invocation meta, a **unified source browser** (left
  file tree + right content pane; a content-only skill renders a single virtual
  `SKILL.md` node), frontmatter metadata, and a **credential config** block for
  every env the skill declares — parsed from `metadata.credentials` and from
  `$ENV` / `process.env.X` / `env['X']` / `{{env:X}}` references in the body
  (values never cross the wire).
- **Tools** as collapsible cards with channel attribution (`mcp__` prefix /
  generated official whitelist / apply-time baseline diff).
- **Add skill** — three install sources in one modal:
  - **文件上传 / Upload**: drag-drop (or click) a single `SKILL.md`, a `.zip`
    containing `SKILL.md`, or an entire skill folder (dependency-free
    `node:zlib` zip reader).
  - **命令安装 / Install from source**: give an `owner/repo`, a git URL, or an
    `npx skills add <repo> -g` form — the host extracts the repo and `git clone`s
    it into the user/project skill root, lifting a nested `SKILL.md` to
    `<root>/<name>/` (the dsh-native install; a real `npx skills add` writes into
    an external skills dir dsh cannot scan).
  - **从本机目录 / From directory**: a local skill dir can be listed (each
    `<name>/SKILL.md`), the user picks which to install, and the selected ones are
    copied into the managed root.

Each source lets you choose the target root (`$DSH_HOME/skills` / `.agents/skills`)
and whether the skill enters the model catalog. The skill-filesystem watcher
discovers the result.

The catalog reads the skill registry at the **agent preset's standing scope**
(`agentPresets.standingKeyFor(defaultId)`) so it lists the same official/plugin/user
skills the model sees, and the `list_capabilities` tool runs in the caller's agent
scope. `snapshotFor(presetId)` reads any OTHER preset's scope the same way — see
[The capability fingerprint](#the-capability-fingerprint).

Zero host edits. If `ctx.skills` / `ctx.tools` / `ctx.credentials` /
`ctx.agentPresets` are absent it degrades to an empty state rather than failing
boot.

## The capability fingerprint

A snapshot is a LISTING — registration order, human wording, file mtimes. The
capability FACE is what is left when you remove everything that is not a
capability, and `hashOf` is its sha256:

| Row | What enters | What does not |
|---|---|---|
| skill | `name`, `source`, sha256 of the SKILL.md body | description, whenToUse, provider, `updatedAt` |
| tool | `name`, `channel`, `parameters` | description, confidence, owner |
| mcpServer | `name` + its tool NAMES | the tool count (derived) |
| channel | the names | the counts (derived) |

Every list is sorted by name and the digest is taken over canonical JSON, so
two instances registering the same things in a different order hash alike.
The exclusions are the claim: **prose is not a capability**. Rewording a tool
description changes what the model reads, not what it can do — and a
fingerprint that moved when someone fixed a typo would be useless as an
identity. A skill's BODY is the opposite (it is the procedure), so it enters
as a sha.

```ts
import { hashOf, capsTag } from '@khorsheed/dsh-capability-catalog'

const face = await remote.snapshotFor('eval-lean')   // sha already stamped
capsTag(face.sha)          // 'caps:2f8b6d40…'
hashOf(face) === face.sha  // true — the `sha` field is not part of what it digests
```

`snapshotFor(presetId?, workdir?)` is the fingerprint verb: it reads the
skill and tool registries at **that preset's** standing scope
(`agentPresets.standingKeyFor(id)`), loads every skill body so the rows carry
`bodySha`, and stamps `sha`. `presetId` omitted reads the deployment default.
`snapshot()` stays the listing verb — same rows, no body loads, no digest.
`list_capabilities` reports the full face's tag as `capabilities`, even when
the caller filtered the answer to skills or tools.

**A listing degrades; a fingerprint refuses.** When the preset's scope cannot
be resolved — no roster, unknown id, a composition that will not mount —
`snapshot()` falls back to the global layer and carries NO `preset` label,
because a settings card must not go blank over a bad row. `snapshotFor()`
throws instead, naming the preset and the reason. This is not hypothetical:
on a real sub-dsh whose preset had one invalid row, the degrading version
gave two scopes rostering two *different* presets one identical hash,
silently.

Two costs are worth naming. Fingerprinting loads one skill body per skill
(the listing path still does not), and asking for a preset nothing has
composed yet MOUNTS it — the roster's standing mount is what "that preset's
scope" means.

Who uses it: an evaluation records the orchestrating instance's own hash in
`run.meta.orchestrator.capabilities` as provenance, and a condition that
declares a `preset` must carry the hash of its provisioned environment in its
lock — which is what turns that declaration from a claim into a fact.

## Skill credential env injection

A configured credential for a skill's declared env var is exposed to the model's
shell so the skill can query. Two pieces, both service-agnostic and generic
(derived from each skill's own env-decl keys — no hardcoded key):

- **`ctx.shellEnv`** injects each configured credential as a trusted,
  per-execution **`DSH_<KEY>`** variable. The model uses it by shell expansion
  (`KEY="$DSH_KEY" <cmd>`), so the raw value never enters the model's context by
  default (it only becomes visible if the model actively echoes it — a
  *default-hide*, not a hard secret boundary). If `ctx.shellEnv` /
  `ctx.credentials` / `ctx.skills` are absent, or a session has no skill, this is
  a no-op.
- **Runtime companion hint** — the model won't derive the `KEY → DSH_<KEY>`
  alias on its own. When the `skill` tool loads a skill that has configured
  credentials, the catalog appends a per-skill note (`tools/post-execute` +
  `additionalContexts`) listing each mapping and how to use it. It never touches
  the user's `SKILL.md`.

The credential store is the dsh credential store (`.credentials.yaml`, ref
space); reads use `credentials.resolve(decl.key)` / `describe(decl.key).configured`
(presence only, never the value) and writes `set(request.key, value)`, validated
with a local POSIX ref-name check (no runtime `@deepseek-ai/dsh-credentials`
import keeps graceful degradation when it is absent).

Security trade-off (honest): this is *default-hide*, not a secret boundary — a
prompt can still make the model `echo $DSH_KEY`. For "the model never holds the
raw value", a catalog-owned narrow tool (`ctx.shell.run({ env })`) or the future
masked-credential-proxy design is the harder edge; see the proposal §4.6.

## Plugin skill registration protocol

This is the contract the catalog relies on to render a skill's file tree.

A skill is discoverable in two ways:

- **Filesystem/provider discovery** (`@deepseek-ai/dsh-skill-filesystem` scans a
  configured root for `<name>/SKILL.md`). These skills already carry
  `resourceBase: { kind: 'directory', path }`, so the catalog lists their bundle
  files (SKILL.md + references/scripts/assets) automatically.
- **Runtime plugin registration** (`ctx.skills.register(...)`). The catalog can
  only list a runtime skill's bundle files if the plugin **exposes them**.

### The rule

If a plugin ships a skill **whose bundle carries resources** (scripts, assets,
references, or any file beside `SKILL.md`), register it with a resource base:

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

When `resourceBase.kind === 'directory'`, the catalog walks `resourceBase.path`
and shows the bundle as a file tree, and the model's relative-resource
resolution can reach those files too. Asking the catalog to "scan every plugin
package" is deliberately not done: the registry is the source of truth for what is
installed, and it already attributes each skill to its provider.

A **content-only** skill (a single self-contained `SKILL.md` body with no scripts,
assets, or references beside it — e.g. `inline-html-card`) should **omit**
`resourceBase` rather than point it at a directory that only holds `SKILL.md`.
The browser half renders such a skill as a single virtual `SKILL.md` node whose
content is the body — a unified source browser for every skill, without the host
fabricating a disk path that is not a real resource bundle. The data contract
stays honest: `files` is reported only when a bundle exists.

The harness's `@deepseek-ai/dsh-skill` already documents `resourceBase` and
`register()` / `registerProvider()`; this section is the catalog-side contract
that spells out the plugin-facing expectation. (Upstream-candidate wording: ask
dsh-skill to state explicitly that a runtime plugin skill should carry a
`resourceBase` directory when it ships bundle resources.)

## Compatibility

| Host line | Verdict |
|---|---|
| npm release (≥ `0.1.2-rc.1`) | supported |
| deepseek-harness master | supported (`verifiedHost: 0.1.2-rc.1`) |

Machine-readable: `dsh.compat.minHost` in `package.json` (currently `0.1.2-rc.1` — the floor moved up with the 0.1.2 baseline migration; older hosts stay on the previous release line). When a degraded mode is omitted above, note it in `dsh.compat.notes`.
