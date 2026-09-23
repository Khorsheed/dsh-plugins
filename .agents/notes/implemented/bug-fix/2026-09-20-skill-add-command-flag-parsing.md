# Agent Note: Install a skill from a pasted `npx skills add` command

Status: implemented

## Problem

The add-skill modal's "command" tab accepts a repo spec, and every published skill hands the user a command to paste there: `npx skills add typesafe-ai/skills --skill typesafe-ai`. Pasting it failed with `fatal: unable to access 'https://github.com/typesafe-ai/skills --skill typesafe-ai/': URL rejected: Malformed input to a URL function`.

`repoSpecToClone` stripped only the `npx skills add ` prefix and a trailing `-g`, then returned anything starting with `http` as the clone URL. The flag survived into the URL, and `url.split('/').pop()` turned the same text into the destination directory name, so git received two malformed arguments. Two further gaps sat on the same path: a repo carrying several skills installed whichever `SKILL.md` was shallowest, silently ignoring what the command asked for, and the clone landed inside the managed skills root, where a failed install left a directory the skills watcher could probe.

## Decision

`parseRepoSpec` tokenizes the spec and consumes every flag, mirroring the `skills` CLI's own `add` parser (vercel-labs/skills): `--skill`/`-s` values are kept, `--agent`/`--subagent`/`--metadata` consume their values and are dropped, boolean flags (`-g`, `--global`, `-y`, `--list`, `--all`, `--full-depth`, `--json`, `--copy`) are dropped, and any other flag-shaped token is dropped, so no flag can reach the clone URL. The first non-flag token is the source reference.

The clone path clones into an OS scratch directory instead of the managed root, collects every skill bundle (depth ≤ 4) with `collectSkills`, and resolves the install set with `selectSkills` — matching directory name or frontmatter name case-insensitively, `*` selecting all, mirroring the CLI. `request.skills` (the chooser) wins over the command's `--skill` values. A repo carrying several skills with no selection is refused with the list, like the local-directory path, instead of installing the shallowest one. Every target is checked before anything is written, so a selection spanning a new and an existing skill never half-installs, and the scratch directory is removed in a `finally`.

The superseded `findSkillMd` helper and the modal's `-g`-only placeholder were updated with it.

## Alternatives considered

**Keep the URL-only parser and reject any spec containing a flag.** Rejected: the README command is exactly what a user has in hand, so refusing it would leave the install broken for the commands the ecosystem actually publishes.

**Implement the full CLI.** Rejected: dsh owns one managed root and one install target, so agent selection and multiple sources have no meaning here; these flags are consumed in order to be ignored, not honored.

**Leave the multi-skill case installing the shallowest `SKILL.md`.** Rejected: that silently installs a skill the user did not ask for. The command form now carries the selection that disambiguates it (`--skill <name>`), so the refusal is actionable and matches the directory path's existing message.

**Keep cloning into the managed root.** Rejected: a git failure or a partial clone would be visible to the skills watcher, and a repo named like an already installed skill would be deleted by the pre-clone cleanup before the collision could be detected.

## Consequences

A pasted `npx skills add <repo> --skill <name>` installs the named skill. Existing specs (`owner/repo`, a git URL, `-g`, a local directory) behave as before, except that a multi-skill repo with no `--skill` now errors with the available names instead of installing one of them. The installed folder is still named from the skill's frontmatter, not from the `--skill` value. The clone no longer leaves a copy in the managed root, so an installed skill can no longer be wiped by a repo name collision.

`import.spec.ts` covers the parser and drives the clone path end-to-end against a stub `git` on `PATH` — including the argv assertion that the clone URL carries no flag — so the regression is covered without network access.
