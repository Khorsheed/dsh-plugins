/**
 * Mode skills, installed the CLI's own way: a member with a mode gets the
 * skills that mode contributes (e.g. the 剪辑 mode's `video-studio`) written
 * into its harness home's skill directory — `skills/<name>/SKILL.md`, the
 * layout Codex (`$CODEX_HOME`) and Claude Code (`$CLAUDE_CONFIG_DIR`) both
 * load. The home is shared by every member of that harness, so each skill is
 * named `dsh-<name>` and says it applies only alongside the mode's tools.
 * Harnesses without a known skill directory (kimi) get none. Best-effort:
 * a failed write never fails the member's tool listing.
 * @module @khorsheed/dsh-local-agent/mode-skills
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ModeSkill } from './preset-tool-host.ts'

/** Harnesses whose CLI loads `<home>/skills/<name>/SKILL.md`. */
const SKILL_HOMES: ReadonlySet<string> = new Set(['codex', 'claude-code'])

/** The skill directory of a harness home, or undefined when its CLI has none we know. */
export function harnessSkillsDir(harness: string, home: string): string | undefined {
  return SKILL_HOMES.has(harness) ? join(home, 'skills') : undefined
}

/** The SKILL.md a mode skill installs as. */
export function modeSkillFile(skill: ModeSkill, mode: string): { readonly name: string; readonly text: string } {
  const name = `dsh-${skill.name}`
  const description = `${skill.description} (dsh mode "${mode}": use only when your tools include this mode's tools.)`.replace(/\s+/g, ' ')
  return {
    name,
    text: `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${skill.content.trim()}\n`,
  }
}

/**
 * Write the mode's skills into the harness's skill directory, skipping files
 * already up to date.
 * @param dir - the harness skill directory.
 * @param mode - the member's mode id.
 * @param skills - the mode's skills.
 * @returns the installed skill names.
 */
export function installModeSkills(dir: string, mode: string, skills: readonly ModeSkill[]): string[] {
  const installed: string[] = []
  for (const skill of skills) {
    const file = modeSkillFile(skill, mode)
    const target = join(dir, file.name, 'SKILL.md')
    let current: string | undefined
    try { current = readFileSync(target, 'utf8') } catch { current = undefined }
    if (current !== file.text) {
      mkdirSync(join(dir, file.name), { recursive: true })
      writeFileSync(target, file.text)
    }
    installed.push(file.name)
  }
  return installed
}
