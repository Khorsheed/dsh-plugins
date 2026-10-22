import { describe, expect, it } from 'vitest'
import { kitOf } from '../src/kits/index.ts'
import {
  pillarNotes,
  chapterStatus, elementsChapter, gate, isBuildFile, listOf, parseManifest, resolveArtStyle, slugOf, validateElements,
} from '../src/project.ts'

describe('the light gate', () => {
  it('names every missing item instead of inventing it', () => {
    const verdict = gate({ title: '灯塔守夜人' })
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.missing.map(m => m.split('（')[0])).toEqual(['pitch', 'elementTypes', 'artStyle'])
  })

  it('accepts a style by id, by label, or custom', () => {
    expect(resolveArtStyle('pixel')).toBe('pixel')
    expect(resolveArtStyle('像素')).toBe('pixel')
    expect(resolveArtStyle('custom：水墨')).toBe('custom:水墨')
    expect(resolveArtStyle('好看的')).toBeUndefined()
  })

  it('builds the manifest body with auto-confirm on', () => {
    const verdict = gate({ title: '灯塔', pitch: '守住灯塔', elementTypes: '角色、敌人，道具', artStyle: 'pixel', pillars: ['紧张', '温暖'] })
    expect(verdict).toMatchObject({ ok: true, manifest: { elementTypes: ['角色', '敌人', '道具'], artStyle: 'pixel', pillars: ['紧张', '温暖'], autoConfirm: true } })
  })
})

describe('manifest and chapters', () => {
  it('parses a hand-edited manifest with defaults', () => {
    const parsed = parseManifest('{"id":"g_1","title":"T","elementTypes":["角色"]}')
    expect(parsed).toMatchObject({ ok: true, manifest: { id: 'g_1', autoConfirm: true, pillars: [] } })
    expect(parseManifest('{').ok).toBe(false)
    expect(parseManifest('{"title":"x"}')).toMatchObject({ ok: false })
  })

  it('pins a shipped runtime kit and ignores an unknown one', () => {
    const pinned = parseManifest('{"id":"g","runtime":{"kit":"2d-canvas","version":1}}')
    expect(pinned.ok && pinned.manifest.runtime).toEqual({ kit: '2d-canvas', version: 1 })
    const unknown = parseManifest('{"id":"g","runtime":{"kit":"voxel","version":3}}')
    expect(unknown.ok && 'runtime' in unknown.manifest).toBe(false)
    // A manifest from before kits stays exactly as it was: no runtime key is added.
    const legacy = parseManifest('{"id":"g"}')
    expect(legacy.ok && 'runtime' in legacy.manifest).toBe(false)
    expect(kitOf(undefined).id).toBe('2d-canvas')
    expect(kitOf({ kit: 'voxel' as never, version: 1 }).id).toBe('2d-canvas')
  })

  it('reads chapter status from the text', () => {
    expect(chapterStatus(undefined)).toBe('todo')
    expect(chapterStatus('  \n')).toBe('todo')
    expect(chapterStatus('# 核心循环\n躲避、收集')).toBe('draft')
    expect(chapterStatus('# 核心循环\n状态：定稿\n')).toBe('done')
  })
})

describe('elements', () => {
  it('validates ids, names, types and duplicates across files', () => {
    const { elements, failures } = validateElements({
      'elements/heroes.json': '[{"id":"keeper","name":"守夜人","type":"角色","hp":3,"speed":120},{"id":"keeper","name":"副本","type":"角色"}]',
      'elements/bad.json': '{"id":"x","type":"怪"}',
      'elements/broken.json': '{',
    }, ['角色', '敌人'])
    expect(elements.map(e => e.id)).toEqual(['keeper', 'keeper'])
    expect(elements[0]!.stats).toEqual({ hp: 3, speed: 120 })
    const messages = failures.map(f => `${f.where} ${f.message}`)
    expect(messages.some(m => m.startsWith('elements/bad.json 缺少 name'))).toBe(true)
    expect(messages.some(m => m.includes('type「怪」不在'))).toBe(true)
    expect(messages.some(m => m.startsWith('elements/broken.json 不是合法 JSON'))).toBe(true)
    expect(messages.some(m => m.includes('id「keeper」和 elements/heroes.json[0] 重复'))).toBe(true)
  })

  it('tabulates elements per type', () => {
    const { elements } = validateElements({ 'elements/a.json': '[{"id":"a","name":"甲","type":"敌人","hp":2}]' }, ['敌人'])
    const text = elementsChapter(elements, ['角色', '敌人'])
    expect(text).toContain('## 敌人')
    expect(text).toContain('| 甲 | a | 2 |')
    expect(text).not.toContain('## 角色')
  })
})

describe('files', () => {
  it('keeps design, tests and plugin state out of a build', () => {
    expect(isBuildFile('index.html')).toBe(true)
    expect(isBuildFile('src/main.js')).toBe(true)
    expect(isBuildFile('elements/a.json')).toBe(true)
    expect(isBuildFile('design/pillars.md')).toBe(false)
    expect(isBuildFile('tests/a.test.js')).toBe(false)
    expect(isBuildFile('.game/current.json')).toBe(false)
    expect(isBuildFile('src/.DS_Store')).toBe(false)
  })

  it('makes a folder name from a title', () => {
    expect(slugOf('Lighthouse Keeper!')).toBe('lighthouse-keeper')
    expect(slugOf('灯塔守夜人')).toBe('game')
    expect(listOf(' a、b,,a ')).toEqual(['a', 'b'])
  })
})

describe('pillar notes', () => {
  it('drops lines that restate the one-pager and keeps real notes', () => {
    const manifest = { title: '灯塔', pitch: '守住灯塔', pillars: ['紧张', '灯就是生命'], artStyle: 'pixel', elementTypes: ['角色', '敌人'] }
    const old = '# 灯塔 · 设计支柱\n\n> 守住灯塔\n\n1. 紧张\n2. 灯就是生命\n\n美术风格：像素\n元素类型：角色、敌人\n'
    expect(pillarNotes(old, manifest)).toBe('')
    expect(pillarNotes(`${old}\n## 紧张\n每一秒都在掉灯油。\n`, manifest)).toBe('## 紧张\n每一秒都在掉灯油。')
  })
})
