import { describe, expect, it } from 'vitest'
import { checkContent, gltfClips, type ContentInput } from '../src/content-schema.ts'

/** A tiny glb with the given clip names (JSON chunk only — enough for clip reading). */
function glb(clips: readonly string[]): Buffer {
  const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, animations: clips.map(name => ({ name, channels: [], samplers: [] })) }))
  const pad = Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)
  const j = Buffer.concat([json, pad])
  const head = Buffer.alloc(20)
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + j.length, 8)
  head.writeUInt32LE(j.length, 12); head.writeUInt32LE(0x4e4f534a, 16)
  return Buffer.concat([head, j])
}

const SCHEMA = {
  schema: 1,
  ids: {
    room: { from: 'design/rooms/*.json#rooms[].id' },
    spot: { from: 'design/rooms/*.json#spots.@' },
    step: { list: ['start', 'open', 'done'] },
    action: { from: 'design/quests/*.json#actions.@' },
    actor: { map: { player: 'hero', guard: 'keeper' } },
  },
  refs: {
    'design/rooms/*.json#rooms[].links[]': 'room',
    'design/rooms/*.json#spots.*.room': 'room',
    'design/quests/*.json#start': 'step',
    'elements#interactions[].action': 'action',
    'elements#interactions[].animations.@': 'actor',
    'elements#interactions[].animations.*': 'clip(@)',
  },
  conditions: { step: 'step', hasItem: 'element', near: { spot: 'spot', within: 'number?' } },
  effects: {
    setStep: { step: 'step' },
    give: { id: 'element', count: 'number?' },
    play: { target: 'actor|element', name: 'clip(target)' },
    moveTo: { states: 'map<room>' },
  },
  slots: {
    'design/quests/*.json#actions.*.when': 'condition',
    'design/quests/*.json#actions.*.do[]': 'effect',
    'elements#interactions[].do[]': 'effect',
  },
}

const rooms = { rooms: [{ id: 'hall', links: ['vault'] }, { id: 'vault', links: [] }], spots: { door: { room: 'hall' } } }
const quest = {
  start: 'start',
  actions: {
    unlock: {
      when: { all: [{ step: 'start' }, { hasItem: 'key' }, { not: { near: { spot: 'door', within: 2 } } }] },
      do: [{ type: 'setStep', step: 'open' }, { type: 'give', id: '$item' }, { type: 'moveTo', states: { a: 'hall', b: 'vault' } }],
    },
  },
}
const hero = { id: 'hero', name: 'Hero', type: '角色', look: { kind: 'gltf', src: 'assets/hero.glb' } }
const keeper = {
  id: 'keeper', name: 'Keeper', type: '角色', look: { kind: 'gltf', src: 'assets/keeper.glb' },
  interactions: [{ id: 'talk', action: 'unlock', animations: { guard: 'wave' }, do: [{ type: 'play', target: 'player', name: 'nod' }] }],
}
const key = { id: 'key', name: 'Key', type: '道具' }

function input(over: { rooms?: unknown; quest?: unknown; keeper?: unknown; files?: Record<string, Buffer> } = {}): ContentInput {
  const files: Record<string, Buffer> = { 'assets/hero.glb': glb(['idle', 'nod']), 'assets/keeper.glb': glb(['idle', 'wave']), ...over.files }
  return {
    docs: [{ file: 'design/rooms/main.json', value: over.rooms ?? rooms }, { file: 'design/quests/main.json', value: over.quest ?? quest }],
    elements: [hero, over.keeper ?? keeper, key].map(element => ({ file: `elements/${(element as { id: string }).id}.json`, element: element as Record<string, unknown> })),
    clipsOf: path => (files[path] === undefined ? undefined : gltfClips(files[path])),
  }
}

const run = (over?: Parameters<typeof input>[0], schema: unknown = SCHEMA): ReturnType<typeof checkContent> => checkContent(JSON.stringify(schema), input(over))
const clone = <T>(v: T): T => structuredClone(v)

describe('content schema checks', () => {
  it('passes data whose every reference resolves (runtime $params skipped)', () => {
    expect(run()).toEqual([])
  })

  it('reports a dangling reference with where it sits and a near-miss hint', () => {
    const r = clone(rooms); r.rooms[0]!.links = ['valut']
    expect(run({ rooms: r })).toEqual([{ where: 'design/rooms/main.json › rooms[0].links[0]', message: expect.stringMatching(/「valut」不是已有的 room.*vault/) }])
  })

  it('checks conditions: undeclared names, params of object conditions, nested all/any/not', () => {
    const q = clone(quest)
    q.actions.unlock.when = { all: [{ stage: 'start' }, { hasItem: 'sword' }, { not: { near: { spot: 'window' } } }] } as never
    const failures = run({ quest: q })
    expect(failures.map(f => f.where)).toEqual([
      'design/quests/main.json › actions.unlock.when.all[0].stage',
      'design/quests/main.json › actions.unlock.when.all[1].hasItem',
      'design/quests/main.json › actions.unlock.when.all[2].not.near.spot',
    ])
    expect(failures[0]!.message).toContain('未声明的条件「stage」')
  })

  it('checks effects: undeclared type, missing and unknown params, map<ns> values', () => {
    const q = clone(quest)
    q.actions.unlock.do = [{ type: 'setStage', step: 'open' }, { type: 'setStep', stpe: 'open' }, { type: 'moveTo', states: { a: 'attic' } }] as never
    const failures = run({ quest: q })
    expect(failures).toEqual([
      { where: 'design/quests/main.json › actions.unlock.do[0].type', message: expect.stringMatching(/^未声明的效果「setStage」/) },
      { where: 'design/quests/main.json › actions.unlock.do[1]', message: '缺少参数「step」' },
      { where: 'design/quests/main.json › actions.unlock.do[1].stpe', message: expect.stringMatching(/^没有声明的参数「stpe」/) },
      { where: 'design/quests/main.json › actions.unlock.do[2].states', message: expect.stringMatching(/^a：「attic」不是已有的 room/) },
    ])
  })

  it('checks animation clips against the model of an element or an alias', () => {
    const k = clone(keeper)
    k.interactions[0]!.animations = { guard: 'dance' }
    k.interactions[0]!.do = [{ type: 'play', target: 'player', name: 'jump' }]
    const failures = run({ keeper: k })
    expect(failures).toEqual([
      { where: 'elements/keeper.json › interactions[0].animations.guard', message: expect.stringContaining('「keeper」的模型里没有动画「dance」（有：idle、wave）') },
      { where: 'elements/keeper.json › interactions[0].do[0].name', message: expect.stringContaining('「hero」的模型里没有动画「jump」') },
    ])
  })

  it('reports a bad declaration instead of passing silently', () => {
    const bad = { ...clone(SCHEMA), ids: { ...SCHEMA.ids, room: { from: 'design/rooms/*.json#zones[].id' }, actor: { map: { player: 'nobody' } } }, effects: { give: { id: 'item' } } }
    const failures = run(undefined, bad)
    expect(failures.some(f => f.where === 'design/schema.json › ids.room' && f.message.includes('一个编号也没找到'))).toBe(true)
    expect(failures.some(f => f.where === 'design/schema.json › ids.actor.map.player')).toBe(true)
    expect(failures.some(f => f.where === 'design/schema.json › effects.give' && f.message.includes('未知类型「item」'))).toBe(true)
    expect(checkContent('{ nope', input())).toEqual([{ where: 'design/schema.json', message: expect.stringContaining('不是合法的 JSON') }])
  })

  it('reads clip names from glb and from glTF JSON', () => {
    expect(gltfClips(glb(['a', 'b']))).toEqual(['a', 'b'])
    expect(gltfClips(Buffer.from(JSON.stringify({ animations: [{ name: 'walk' }, {}] })))).toEqual(['walk', 'animation_1'])
    expect(gltfClips(Buffer.from('not gltf'))).toBeUndefined()
  })
})
