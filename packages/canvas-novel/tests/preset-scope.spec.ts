/**
 * The preset-grant composition test, over REAL registries: the shipped
 * default (core row only, agent row disabled) leaves the profile root
 * with NO story trace — no story_* tool, no story:pointer section, no
 * story skill — while mounting the `./agent` entry inside a scope (the
 * writing preset's agent plane, simulated with dsh-scope's `createScope`,
 * the same mechanism the preset realm uses) puts all three into THAT
 * scope's layers and nowhere else.
 */
import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import { apply as agentApply } from '../src/agent.ts'
import { apply as coreApply } from '../src/index.ts'
import { FakeFs } from './fake-fs.ts'

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

/** Boot the real composition: prompt + tools registries, the skills stub, the story core (root row only). */
async function bootRoot(): Promise<{ root: Context; skills: ReturnType<typeof fakeSkills>; fs: FakeFs }> {
  const root = new Context()
  await root.plugin(SystemPrompt)
  await root.plugin(ToolRuntime)
  const skills = fakeSkills()
  root.provide('skills', skills)
  const fs = new FakeFs()
  root.provide('fs', fs as never)
  coreApply(root, { stateRoot: '/dsh/state/story' })
  disposers.push(async () => { await root.fiber.dispose() })
  return { root, skills, fs }
}

/** The story-* tool names of one assembly. */
function storyToolsOf(assembly: { tools: readonly { name: string }[] }): string[] {
  return assembly.tools.map(tool => tool.name).filter(name => name.startsWith('story_'))
}

describe('the preset-granted agent surface (composition level)', () => {
  it('the shipped default leaves the profile root with NO story trace', async () => {
    const { root, skills } = await bootRoot()
    await new Promise(resolve => { setTimeout(resolve, 0) })
    const assembly = await root.systemPrompt.assemble({})
    expect(storyToolsOf(assembly)).toEqual([])
    expect(assembly.sections.some(section => section.name === 'story:pointer')).toBe(false)
    expect(skills.registered).toEqual([])
  })

  it('mounting ./agent inside a scope grants exactly that scope: tools, pointer, skill — root stays clean', async () => {
    const { root, skills } = await bootRoot()
    const key = {}
    const writing = createScope(root, key)
    disposers.push(async () => { await writing.dispose() })
    agentApply(writing.ctx)
    await new Promise(resolve => { setTimeout(resolve, 0) })

    const scoped = await root.systemPrompt.assemble({ scope: key })
    expect(storyToolsOf(scoped).sort()).toEqual(['story_extract', 'story_read', 'story_write'])
    const pointer = scoped.sections.find(section => section.name === 'story:pointer')
    expect(pointer).toBeDefined()
    // The pointer is a FUNCTION section, resolved per assembly: no focus yet → ''.
    expect(pointer!.text).toBe('')
    expect(skills.registered.map(skill => skill.name)).toEqual(['story'])

    // The root (an ordinary session) assembles without any of it.
    const plain = await root.systemPrompt.assemble({})
    expect(storyToolsOf(plain)).toEqual([])
    expect(plain.sections.some(section => section.name === 'story:pointer')).toBe(false)
  })

  it('the scoped grant renders the focus pointer line once a work is focused', async () => {
    const { root, fs } = await bootRoot()
    fs.seed('/dsh/state/story/work-abcdef/work.json', `${JSON.stringify({
      id: 'work-abcdef', title: '梦境监护者', workspace: '/home/user/workspace',
      createdAt: '2026-10-01T09:00:00.000Z', updatedAt: '2026-10-01T09:00:00.000Z',
    }, null, 2)}\n`)
    const key = {}
    const writing = createScope(root, key)
    disposers.push(async () => { await writing.dispose() })
    agentApply(writing.ctx)
    await new Promise(resolve => { setTimeout(resolve, 0) })
    const store = root.get('storyBible') as import('../src/store.ts').StoryBibleService
    await store.focusWork({ workId: 'work-abcdef' }, { id: 's-1' } as never)
    const scoped = await root.systemPrompt.assemble({ scope: key, agent: { sessionId: 's-1' } as never })
    const pointer = scoped.sections.find(section => section.name === 'story:pointer')
    expect(pointer?.text).toContain('《梦境监护者》')
    expect(pointer?.text).toContain('story_read(brief)')
  })
})
