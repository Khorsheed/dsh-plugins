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
scope.

Zero host edits. If `ctx.skills` / `ctx.tools` / `ctx.credentials` /
`ctx.agentPresets` are absent it degrades to an empty state rather than failing
boot.

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
| npm release (≥ `dsh.compat.minHost`) | supported |
| deepseek-harness master | supported |

Machine-readable: `dsh.compat.minHost` in `package.json`. When a degraded model
is omitted above, note it in `dsh.compat.notes`.
