/** The companion row: what it grants, how it degrades, and how it renders answers. */
import { describe, expect, it } from 'vitest'
import { apply, formatResult, toSeamQuestions, typesafeJudgeTool, type TypeSafeToolConfig } from '../src/index.ts'

const ORIGIN = Symbol.for('dsh.tool.origin')

interface RegisteredTool {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute: (args: unknown, exec: { signal?: AbortSignal }) => Promise<string>
  [ORIGIN]?: { channel: string; owner: string }
}

interface Section {
  name: string
  order: number
  text: string
}

interface RegisteredSkill {
  name: string
  description: string
  content: string
  source: string
  provider?: string
  metadata?: Readonly<Record<string, unknown>>
}

interface ServiceCall {
  state: unknown
  questions: readonly { id: string; type: string; criteria?: unknown }[]
  signal?: AbortSignal
}

type SeamResult = Awaited<ReturnType<ReturnType<typeof fakeService>['judge']>>

/** A minimal core-service double, recording every call. */
function fakeService(result?: SeamResult): {
  judge: (input: { state: unknown; questions: readonly never[] }, options?: { signal?: AbortSignal }) => Promise<SeamResult>
  calls: ServiceCall[]
} {
  const calls: ServiceCall[] = []
  return {
    calls,
    judge: async (input, options) => {
      calls.push({ state: input.state, questions: input.questions, ...options?.signal === undefined ? {} : { signal: options.signal } })
      return result ?? {
        ok: true,
        judgement: {
          model: 'jev-1.13.0',
          decisions: [{ id: 'needs_reply', type: 'noul', answer: 0.82 }],
          latencyMs: 42,
          cached: false,
        },
      }
    },
  }
}

interface Mounted {
  tools: RegisteredTool[]
  sections: Section[]
  skills: RegisteredSkill[]
  infos: string[]
  warns: string[]
}

/** Mount the row against the narrowest ctx it actually uses. */
function mount(service: unknown, config?: TypeSafeToolConfig): Mounted {
  const tools: RegisteredTool[] = []
  const sections: Section[] = []
  const skills: RegisteredSkill[] = []
  const infos: string[] = []
  const warns: string[] = []
  const child = (): Record<string, unknown> => ({
    tools: { register: (definition: RegisteredTool) => { tools.push(definition); return () => {} } },
    get: (serviceName: string) => {
      if (serviceName === 'systemPrompt') {
        return { section: (section: Section) => { sections.push(section); return () => {} } }
      }
      if (serviceName === 'skills') {
        return { register: (skill: RegisteredSkill) => { skills.push(skill); return () => {} } }
      }
      return undefined
    },
    effect: (fn: () => unknown) => { fn(); return () => {} },
    inject: (names: readonly string[], cb: (ctx: never) => void) => { cb(child() as never) },
  })
  const ctx = {
    get: (serviceName: string) => (serviceName === 'typesafe' ? service : undefined),
    logger: {
      info: (message: string) => { infos.push(message) },
      warn: (message: string) => { warns.push(message) },
    },
    inject: (_names: readonly string[], cb: (ctx: never) => void) => { cb(child() as never) },
  }
  if (config === undefined) apply(ctx as never)
  else apply(ctx as never, config)
  return { tools, sections, skills, infos, warns }
}

describe('toSeamQuestions', () => {
  it('maps noul, choice and score onto the wire shape', () => {
    const mapped = toSeamQuestions([
      { id: 'needs_reply', type: 'noul', instructions: 'Does this need a reply?' },
      { id: 'tone', type: 'choice', instructions: 'What is the tone?', choices: { calm: '', angry: 'Strong language' } },
      { id: 'urgency', type: 'score', instructions: 'How urgent?', levels: ['can wait', 'today'] },
    ])
    expect(mapped).toEqual([
      { id: 'needs_reply', type: 'noul', instructions: 'Does this need a reply?' },
      {
        id: 'tone',
        type: 'choice',
        instructions: 'What is the tone?',
        criteria: { calm: null, angry: 'Strong language' },
      },
      { id: 'urgency', type: 'score', instructions: 'How urgent?', criteria: ['can wait', 'today'] },
    ])
  })

  it('rejects malformed calls with an actionable sentence', () => {
    expect(toSeamQuestions([])).toContain('at least one question')
    expect(toSeamQuestions([{ id: 'a', type: 'noul', instructions: 'x' }, { id: 'a', type: 'noul', instructions: 'y' }]))
      .toContain('duplicate')
    expect(toSeamQuestions([{ id: 't', type: 'choice', instructions: 'x' }])).toContain('choices')
    expect(toSeamQuestions([{ id: 'u', type: 'score', instructions: 'x', levels: [] }])).toContain('levels')
  })
})

describe('formatResult', () => {
  it('renders one line per decision with distributions and confidence', () => {
    const text = formatResult({
      ok: true,
      judgement: {
        model: 'jev-1.13.0',
        latencyMs: 210,
        cached: false,
        usage: { inputTokens: 120, outputTokens: 18 },
        decisions: [
          { id: 'needs_reply', type: 'noul', answer: 0.82 },
          { id: 'tone', type: 'choice', answer: 'angry', confidence: 0.76, probabilities: { calm: 0, angry: 0.9 } },
          { id: 'urgency', type: 'score', answer: 1, confidence: 0.5, legend: { '0': 'can wait', '1': 'today' } },
        ],
      },
    })
    expect(text.split('\n')[0]).toBe('jev-1.13.0 210ms tokens=120/18')
    expect(text).toContain('needs_reply [noul]: 0.82')
    expect(text).toContain('tone [choice]: angry confidence=0.76 calm=0.00 angry=0.90')
    expect(text).toContain('urgency [score]: 1 "today" confidence=0.50')
  })

  it('turns a failure into an honest sentence instead of an answer', () => {
    const text = formatResult({ ok: false, reason: 'unconfigured', detail: 'no value resolved for credential reference TYPESAFE_API_KEY' })
    expect(text).toContain('could not answer (unconfigured)')
    expect(text).toContain('do not retry the same call blindly')
  })
})

describe('the typesafe-tool companion row', () => {
  it('grants the tool, the guidance section and the skill', () => {
    const { tools, sections, skills } = mount(fakeService())
    expect(tools.map(tool => tool.name)).toEqual(['typesafe_judge'])
    expect(tools[0]?.[ORIGIN]).toEqual({ channel: 'plugin', owner: '@khorsheed/dsh-typesafe-tool' })
    expect(tools[0]?.description).toContain('System One')
    expect(tools[0]?.description).toContain('Never build a CLI')
    expect(sections.map(section => section.name)).toEqual(['typesafe:judge'])
    expect(sections[0]?.order).toBe(152)
    expect(sections[0]?.text).toContain('never through a shell command')
    expect(skills.map(skill => skill.name)).toEqual(['typesafe-decide'])
    expect(skills[0]?.source).toBe('runtime')
    expect(skills[0]?.provider).toBe('@khorsheed/dsh-typesafe-tool')
    expect(skills[0]?.content).toContain('Never build a CLI')
    expect(skills[0]?.metadata).toEqual({
      credentials: [{ key: 'TYPESAFE_API_KEY', label: 'TypeSafe API key (console.typesafe.ai/keys)' }],
    })
  })

  it('degrades to a no-op when the core service is absent', () => {
    const { tools, sections, skills, infos } = mount(undefined)
    expect(tools).toEqual([])
    expect(sections).toEqual([])
    expect(skills).toEqual([])
    expect(infos[0]).toContain('the global typesafe service is absent')
  })

  it('grants nothing under `tools: false`', () => {
    const { tools, sections, skills } = mount(fakeService(), { tools: false })
    expect([tools, sections, skills]).toEqual([[], [], []])
  })

  it('executes through the service and renders the judgement', async () => {
    const service = fakeService()
    const built = typesafeJudgeTool(service as never)
    const controller = new AbortController()
    const text = await (built.execute as RegisteredTool['execute'])(
      {
        state: 'I was charged twice.',
        questions: [{ id: 'needs_reply', type: 'noul', instructions: 'Does this need a reply?' }],
      },
      { signal: controller.signal },
    )
    expect(text).toContain('needs_reply [noul]: 0.82')
    expect(service.calls).toHaveLength(1)
    expect(service.calls[0]?.state).toBe('I was charged twice.')
    expect(service.calls[0]?.questions).toEqual([
      { id: 'needs_reply', type: 'noul', instructions: 'Does this need a reply?' },
    ])
    expect(service.calls[0]?.signal).toBe(controller.signal)
  })

  it('rejects a malformed call without touching the service', async () => {
    const service = fakeService()
    const built = typesafeJudgeTool(service as never)
    const text = await (built.execute as RegisteredTool['execute'])(
      { state: 'x', questions: [{ id: 't', type: 'choice', instructions: 'tone?' }] },
      {},
    )
    expect(text).toContain('rejected the call')
    expect(service.calls).toHaveLength(0)
  })

  it('renders a service failure as text, not an exception', async () => {
    const service = fakeService({ ok: false, reason: 'timeout', detail: 'no answer within 1500ms' })
    const built = typesafeJudgeTool(service as never)
    const text = await (built.execute as RegisteredTool['execute'])(
      { state: 'x', questions: [{ id: 'n', type: 'noul', instructions: 'y?' }] },
      {},
    )
    expect(text).toContain('could not answer (timeout)')
  })
})
