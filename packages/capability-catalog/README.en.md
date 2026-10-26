# @khorsheed/dsh-capability-catalog

English | [中文](README.md)

See at a glance what your agent can do and who installed each tool — and add new skills and MCP servers from the same page.

Once you have a handful of plugins and skills, "what can this agent actually do?" and "where did that tool come from?" get hard to answer; you used to dig through logs. With the capability catalog, Settings gains a Tools & Skills page: every skill and every tool, each labelled with where it came from. To add a skill, upload it or paste an install command; to hook up an MCP server, paste its config. The agent can read the same list to tell you what it can do.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/capability-catalog-1.png" width="560" alt="the 工具与技能 settings tab: a skill preview grid with source badges, search and sort, and the mode picker">

## What it does

- **Everything on one page**: skills and tools on two tabs, with search and sort; open a card for the full description and every file in the skill.
- **Every tool says where it came from**: built in, which plugin, or which MCP server — you can tell at a glance.
- **Look at one mode at a time**: pick a mode under Mode and the page shows only what that mode can use; pick All modes (compare) and each card shows the modes it appears in.
- **Three ways to add a skill**: click Add Skill to upload a folder or zip, paste an install command, or tick skills from a local directory.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/capability-catalog-2.png" width="560" alt="the Add Skill modal: three install paths — file upload, install from source, pick from a local directory — each with a choice of target root and whether the skill enters the model catalog">

- **Enter a skill's keys right here**: when a skill declares the keys it needs, its details show Credential config; enter them once and the values never show on the page.
- **Paste a config to connect an MCP server**: click Add MCP and paste the server config; it works out the connection and the keys by itself. Once connected you can switch the whole server or single tools on and off, and the agent can use them straight away.
- **Limit a skill to certain modes**: tick the modes it applies to in the skill's details and save.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/capability-catalog-3.png" width="560" alt="the Add MCP server dialog: paste one mcp.json server entry and the transport and credentials are parsed automatically">

## Install

In DSH, open Plugins → Add plugin, enter the package name below, and click install:

```
@khorsheed/dsh-basic
```

The capability catalog comes with the Basic Essentials suite. Once installed, open Settings → Tools & Skills.

## Known limits

- A skill's keys are hidden from the agent by default, not locked away: an agent that deliberately prints them can still see them.
- Some plugins don't label their own tools, so those show as Built-in for now; "Why is my plugin tool not here?" on the page explains the fix.
- MCP tools connected here pass text only — no images or attachments.

## Compatibility

Needs DSH 0.1.5-rc.1 or later; verified on 0.2.1-rc.1.

## For developers

- Feature details, tool-origin tagging, capability fingerprints, the workspace evidence seam, internals, and the dual-host-line compatibility notes are in the [full reference](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/capability-catalog/docs/reference.en.md). How to tag your tools: [docs/tool-origin-guide.md](https://github.com/Khorsheed/dsh-plugins/blob/main/docs/tool-origin-guide.md).
- Entry points: `src/index.ts` (the service and the `list_capabilities` tool), `src/client/index.ts` (the settings page). Standalone install: `dsh plugin --profile web add @khorsheed/dsh-capability-catalog`.
- Part of [dsh-plugins](https://github.com/Khorsheed/dsh-plugins); open issues and contributions there. Changes: [CHANGELOG.md](CHANGELOG.md).
