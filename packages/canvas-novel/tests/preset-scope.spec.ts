/**
 * The preset-grant composition test, over REAL registries: the shipped
 * default (core row only, agent row disabled) leaves the profile root
 * with NO novel trace — no novel_* tool, no novel:pointer section, no
 * novel skill — while mounting the `./agent` entry inside a scope (the
 * writing preset's agent plane, simulated with dsh-scope's `createScope`,
 * the same mechanism the preset realm uses) puts the pointer and the skill
 * into THAT scope, and the tools onto the scope of each agent composed under
 * it whose session is bound to a 长篇小说 canvas — and nowhere else.
 */
import { Context } from '@deepseek-ai/cordis'
import { createScope, scopeTarget } from '@deepseek-ai/dsh-scope'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import { apply as agentApply } from '../src/agent.ts'
import { apply as coreApply } from '../src/index.ts'
import { FakeCanvas, provideCanvas } from './fake-canvas.ts'
import { FakeFs } from './fake-fs.ts'
import { DREAM } from './seed-dream.ts'

const disposers: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
})

/** A recording skills registry (only `register` is used). */
function fakeSkills() {
  const registered: Array<{ name: string }> = []
  return {
    registered,
    register: (skill: { name: string }) => {
      registered.push(skill)
      return () => undefined
    },
  }
}

/** Boot the real composition: prompt + tools registries, the skills stub, the novel core (root row only). */
async function bootRoot(): Promise<{ root: Context; skills: ReturnType<typeof fakeSkills>; fs: FakeFs; canvas: FakeCanvas }> {
  const root = new Context()
  await root.plugin(SystemPrompt)
  await root.plugin(ToolRuntime)
  const skills = fakeSkills()
  root.provide('skills', skills)
  const fs = new FakeFs()
  root.provide('fs', fs as never)
  const canvas = provideCanvas(root)
  coreApply(root, { stateRoot: '/dsh/state/novel' })
  disposers.push(async () => { await root.fiber.dispose() })
  return { root, skills, fs, canvas }
}

/** The novel_* tool names of one assembly. */
function novelToolsOf(assembly: { tools: readonly { name: string }[] }): string[] {
  return assembly.tools.map(tool => tool.name).filter(name => name.startsWith('novel_'))
}

describe('the preset-granted agent surface (composition level)', () => {
  it('the shipped default leaves the profile root with NO novel trace', async () => {
    const { root, skills } = await bootRoot()
    await new Promise(resolve => { setTimeout(resolve, 0) })
    const assembly = await root.systemPrompt.assemble({})
    expect(novelToolsOf(assembly)).toEqual([])
    expect(assembly.sections.some(section => section.name === 'novel:pointer')).toBe(false)
    expect(skills.registered).toEqual([])
  })

  it('mounting ./agent inside a scope grants exactly that scope: pointer and skill there, tools only on its bound agents', async () => {
    const { root, skills, canvas } = await bootRoot()
    const key = {}
    const writing = createScope(root, key)
    disposers.push(async () => { await writing.dispose() })
    agentApply(writing.ctx)
    await new Promise(resolve => { setTimeout(resolve, 0) })

    // Two agents: one composed under the writing scope, one outside it.
    const inKey = {}
    const outKey = {}
    const inside = createScope(root, inKey, { parent: key })
    const outside = createScope(root, outKey)
    disposers.push(async () => { await inside.dispose(); await outside.dispose() })
    canvas.bind('s-in', DREAM.workId).bind('s-out', DREAM.workId)
    for (const [scopeKey, agent] of [
      [inKey, { session: { id: 's-in' }, ctx: inside.ctx }],
      [outKey, { session: { id: 's-out' }, ctx: outside.ctx }],
    ] as const) {
      await root.serial(scopeTarget({}, scopeKey) as never, 'agent/created' as never, { agent } as never)
    }

    const granted = await root.systemPrompt.assemble({ scope: inKey, agent: { sessionId: 's-in' } as never })
    expect(novelToolsOf(granted).sort()).toEqual(['novel_bind', 'novel_extract', 'novel_read', 'novel_write'])
    expect(granted.sections.find(section => section.name === 'novel:pointer')?.text).toContain('《梦境监护者》')
    expect(skills.registered.map(skill => skill.name)).toEqual(['novel'])

    // The scope itself holds the pointer, the skill and novel_bind only: a
    // session it never composed renders '' and sees just the way to bind.
    const unbound = await root.systemPrompt.assemble({ scope: key, agent: { sessionId: 's-none' } as never })
    expect(novelToolsOf(unbound)).toEqual(['novel_bind'])
    expect(unbound.sections.find(section => section.name === 'novel:pointer')?.text).toBe('')

    // An agent outside the scope never hears of the entry, bound or not.
    const foreign = await root.systemPrompt.assemble({ scope: outKey })
    expect(novelToolsOf(foreign)).toEqual([])
    expect(foreign.sections.some(section => section.name === 'novel:pointer')).toBe(false)

    // Unbinding the inside session takes the tools away again.
    canvas.bind('s-in', null)
    root.emit('canvas/binding-changed' as never, 's-in' as never, null as never)
    await new Promise(resolve => { setTimeout(resolve, 0) })
    const after = await root.systemPrompt.assemble({ scope: inKey, agent: { sessionId: 's-in' } as never })
    expect(novelToolsOf(after)).toEqual(['novel_bind'])
    expect(after.sections.find(section => section.name === 'novel:pointer')?.text).toContain('novel_bind')
  })
})
