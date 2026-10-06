/** The `./tool` composition row (folded from the retired
 * `@khorsheed/dsh-eval-tool` companion at T88): the seven tools (five reads plus the two writes), the
 * origin tag (this package, not the core), the `tool:eval` guidance section,
 * the `none` grant, the `/eval` slash registration (preset-visibility
 * rollout A3 — registered at every tier, delegated to the core's handler),
 * and the silent degrade when the core service is absent. */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { apply, loadPlanningSkill, PLANNING_SKILL_DIR, type EvalToolConfig } from '../src/tool.ts'

const ORIGIN = Symbol.for('dsh.tool.origin')
const EVAL_TOOLS = [
  'eval_conditions', 'eval_plan_validate', 'eval_plan_draft', 'eval_analysis_write', 'eval_run_status', 'eval_cells', 'eval_experiment_get',
]

interface RegisteredTool {
  name: string
  [ORIGIN]?: { channel: string; owner: string }
}

interface Section {
  name: string
  order: number
  text: string
}

interface RegisteredCommand {
  name: string
  description: string
  input?: { hint: string }
  handler: (invocation: unknown) => Promise<{ kind: string; text: string }>
}

/** The narrowest ctx the row needs: a probe target, a logger, and `inject`. */
function mount(service: unknown, config?: EvalToolConfig): {
  tools: RegisteredTool[]
  sections: Section[]
  commands: RegisteredCommand[]
  infos: string[]
} {
  const tools: RegisteredTool[] = []
  const sections: Section[] = []
  const commands: RegisteredCommand[] = []
  const infos: string[] = []
  const child = (): Record<string, unknown> => ({
    tools: { register: (definition: RegisteredTool) => { tools.push(definition); return () => {} } },
    commands: { register: (definition: RegisteredCommand) => { commands.push(definition); return () => {} } },
    effect: (fn: () => unknown) => { fn(); return () => {} },
    get: (name: string) => (name === 'systemPrompt'
      ? { section: (section: Section) => { sections.push(section); return () => {} } }
      : undefined),
    inject: (names: readonly string[], cb: (ctx: never) => void) => {
      if (names.includes('systemPrompt')) cb(child() as never)
    },
  })
  const ctx = {
    // The service is `dshEval` — never `eval` (the loader's `with (ctx)` hazard).
    get: (name: string) => (name === 'dshEval' ? service : undefined),
    logger: { info: (message: string) => { infos.push(message) } },
    inject: (_names: readonly string[], cb: (ctx: never) => void) => { cb(child() as never) },
  }
  if (config === undefined) apply(ctx as never)
  else apply(ctx as never, config)
  return { tools, sections, commands, infos }
}

describe('eval-tool row (@khorsheed/dsh-eval/tool)', () => {
  it('grants the seven tools, tags them by this package, and adds the guidance section', () => {
    const { tools, sections } = mount({})
    expect(tools.map(tool => tool.name).sort()).toEqual([...EVAL_TOOLS].sort())
    for (const tool of tools) {
      expect(tool[ORIGIN]).toEqual({ channel: 'plugin', owner: '@khorsheed/dsh-eval' })
    }
    expect(sections.map(section => section.name)).toEqual(['tool:eval'])
    expect(sections[0]?.order).toBe(114)
    expect(sections[0]?.text).toContain('eval_conditions')
    expect(sections[0]?.text).toContain('eval_cells')
    expect(sections[0]?.text).toContain('/eval run')
    // R6: an evaluation session composes no mission row, so the guidance
    // names the four mission read tools only to say not to look for them.
    expect(sections[0]?.text).toContain('do not look for mission_run_list')
  })

  it('names the two writes in the guidance, and says in the same breath that starting is not one of them', () => {
    const { sections } = mount({})
    const text = sections[0]?.text ?? ''
    expect(text).toContain('eval_plan_draft')
    // R1 holds because the row has no starting verb, and the guidance must not
    // leave a model looking for one it was told about sideways.
    expect(text).toContain('DRAFTING IS NOT STARTING')
    expect(text).toContain('there is no run tool and you must not look for one')
    // A minted condition is always a copy — the discipline the whole
    // comparison rests on, stated where the model reads it.
    expect(text).toContain('always a COPY')
    expect(text).toContain("Put the person's question into its question field verbatim")
    // The second write (I5·T60) and the door it is: the analysis draft's home,
    // and never an item's material — said where the model reads it, so that
    // reaching for `write` plus a sandbox escalation stops being the path.
    expect(text).toContain('eval_analysis_write')
    expect(text).toContain("an experiment's analysis/<path>")
    // T73: the version question is the person's, and a skipped question stops.
    expect(text).toContain('version is ambiguous')
    expect(text).toContain('ask_user_question')
    expect(text).toContain('must not ask for a sandbox escalation')
  })

  it('teaches eval_run_status\'s status words — the same ones the lab list shows (T72 §2)', () => {
    const { sections } = mount({})
    const text = sections[0]?.text ?? ''
    for (const word of ['pending-approval 待批准', 'stalled 停滞', 'judging 评估中', 'done 已完成', 'void 评估不成立']) {
      expect(text).toContain(word)
    }
    expect(text).toContain('over 10 minutes')
    expect(text).toContain('do not try to restart it')
  })

  it('grants neither tools nor a section under `none` — but the slash command still registers', () => {
    const { tools, sections, commands } = mount({}, { tools: 'none' })
    expect(tools).toEqual([])
    expect(sections).toEqual([])
    // The human face is not tiered: `tools` gates the model face only.
    expect(commands.map(command => command.name)).toEqual(['eval'])
  })

  it('registers the /eval slash command, declaring its input, delegating to the core handler', async () => {
    const { commands } = mount({})
    expect(commands.map(command => command.name)).toEqual(['eval'])
    const [command] = commands
    // The hint's content is copy; its PRESENCE is the contract (a capable
    // composer submits a bare invocation without it).
    expect(command?.input?.hint).toBeTypeOf('string')
    expect(command?.input?.hint).toContain('run <experimentId>')
    // The handler is the core's own: a bare invocation answers the usage
    // (success-kind help semantics; the grant backstop fails open on this
    // ctx-less invocation).
    const result = await command?.handler({ rawInput: '', agent: { session: { id: 'sess-1' } } })
    expect(result?.kind).toBe('success')
    expect(result?.text).toContain('usage:')
  })

  it('degrades to a logged no-op when the eval service is absent', () => {
    const { tools, sections, commands, infos } = mount(undefined)
    expect(tools).toEqual([])
    expect(sections).toEqual([])
    expect(commands).toEqual([])
    expect(infos).toHaveLength(1)
    expect(infos[0]).toContain('eval service is absent')
  })
})

interface RegisteredSkill {
  name: string
  description: string
  content: string
  source: string
  provider?: string
}

/** Mount the row against a ctx whose deferred `skills` door opens on a recording registry. */
function mountWithSkills(service: unknown, config?: EvalToolConfig): RegisteredSkill[] {
  const skills: RegisteredSkill[] = []
  const child = (): Record<string, unknown> => ({
    tools: { register: () => () => {} },
    commands: { register: () => () => {} },
    effect: (fn: () => unknown) => { fn(); return () => {} },
    get: (name: string) => (name === 'skills'
      ? { register: (skill: RegisteredSkill) => { skills.push(skill); return () => {} } }
      : undefined),
  })
  const ctx = {
    get: (name: string) => (name === 'dshEval' ? service : undefined),
    logger: { info: () => {}, warn: () => {} },
    inject: (_names: readonly string[], cb: (ctx: never) => void) => { cb(child() as never) },
  }
  if (config === undefined) apply(ctx as never)
  else apply(ctx as never, config)
  return skills
}

describe('eval-planning skill — ships with the package, granted by this row (T100)', () => {
  it('registers the eval-planning skill from the package, tagged with this package as provider', () => {
    const skills = mountWithSkills({})
    expect(skills.map(skill => skill.name)).toEqual(['eval-planning'])
    expect(skills[0]?.provider).toBe('@khorsheed/dsh-eval')
    expect(skills[0]?.source).toBe('runtime')
    expect(skills[0]?.description).toContain('Draft an evaluation experiment')
    // The frontmatter is the registry's metadata, never part of the body.
    expect(skills[0]?.content).not.toMatch(/^---/)
    expect(skills[0]?.content).toContain('# Drafting an evaluation')
  })

  it('registers no skill under `none` (no drafting verb, no skill about one) and none without the core', () => {
    expect(mountWithSkills({}, { tools: 'none' })).toEqual([])
    expect(mountWithSkills(undefined)).toEqual([])
  })

  it('the skill keeps teaching the drafting verb and leaves the starting verbs the human\'s', () => {
    const body = loadPlanningSkill()?.content ?? ''
    for (const line of [
      'eval_plan_draft',
      'You draft. They decide.',
      '/eval conditions provision',
      '批准并启动',
      "Do not write an experiment's plan or a library condition",
      'Pick datasets only from `datasets_list`',
      'If the person skips the version question, stop.',
      'Ask only when nobody named the factor',
      '这个路径在本部署没有登记',
      'onto a registered id because the names look alike',
      // T87: the 新建实验 form's request is walked one open choice at a time.
      '## When the form hands it over',
      'Never re-ask what the request says is settled.',
      'Ask the open choices one at a time',
    ]) expect(body).toContain(line)
  })

  it('the publish file list ships the skill', () => {
    const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd: join(import.meta.dirname, '..'),
      encoding: 'utf8',
      env: { ...process.env, npm_config_loglevel: 'silent' },
    })
    const [report] = JSON.parse(out) as Array<{ files: Array<{ path: string }> }>
    expect(report!.files.map(file => file.path)).toContain('skills/eval-planning/SKILL.md')
    expect(readFileSync(join(PLANNING_SKILL_DIR, 'SKILL.md'), 'utf8')).toMatch(/^---\nname: eval-planning\n/)
  }, 60_000)
})
