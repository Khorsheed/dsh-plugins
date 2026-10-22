import { describe, expect, it } from 'vitest'
import { normalizeLook3d } from '../src/look3d.ts'
import { gate, parseManifest, resolveArtStyle } from '../src/project.ts'
import { kitOf } from '../src/kits/index.ts'

const FOX = {
  kind: 'parts3d', base: 'quadruped',
  proportions: { bodyLength: 1, legs: 6, heads: 2, segments: 99, junk: 'x' },
  parts: [{ type: 'tail', count: 9, fan: 140, length: 99 }, { type: 'wheel' }, { type: 'face', style: 'human' }],
  palette: { body: '#E9DFCC', accent: 'red' },
  motion: { tailSway: { amplitude: 18, period: 1.6 }, spin: { amplitude: 1 } },
}

describe('3D looks', () => {
  it('keeps a parts recipe, clamping numbers and dropping what it cannot use', () => {
    expect(normalizeLook3d(FOX)).toEqual({
      kind: 'parts3d', base: 'quadruped',
      proportions: { bodyLength: 1, legs: 6, heads: 2, segments: 40 },
      parts: [{ type: 'tail', count: 9, fan: 140, length: 5 }, { type: 'face', style: 'human' }],
      palette: { body: '#e9dfcc' },
      motion: { tailSway: { amplitude: 18, period: 1.6 } },
    })
  })

  it('rejects an unknown body and a gltf path that leaves the project', () => {
    expect(normalizeLook3d({ ...FOX, base: 'dragon' })).toBeNull()
    expect(normalizeLook3d({ kind: 'gltf', src: '../outside.glb' })).toBeNull()
    expect(normalizeLook3d({ kind: 'gltf', src: '/abs.glb' })).toBeNull()
    expect(normalizeLook3d({ kind: 'gltf', src: './assets/fox.glb', recipe: FOX })).toMatchObject({ kind: 'gltf', src: 'assets/fox.glb', recipe: { base: 'quadruped' } })
    expect(normalizeLook3d({ palette: ['#000000'], states: { idle: ['0'] } })).toBeNull()
  })

  it('validates elements through the project kit: 3D looks land in look3d', () => {
    const kit = kitOf({ kit: '3d-three', version: 1 })
    expect(kit.normalizeLook(FOX)).not.toBeNull()
    expect(kit.normalizeLook({ palette: ['#000000'], states: { idle: ['0'] } })).toBeNull()
  })
})

describe('creating a 3D project', () => {
  it('pins the 3D kit and offers the 3D styles', () => {
    const verdict = gate({ runtime: '3d', title: '青丘', pitch: '在青丘山收集异兽', elementTypes: '异兽、草木', artStyle: '水墨' })
    expect(verdict.ok && verdict.manifest.runtime).toEqual({ kit: '3d-three', version: 1 })
    expect(verdict.ok && verdict.manifest.artStyle).toBe('ink')
    const missing = gate({ runtime: '3d', title: '青丘', pitch: 'p', elementTypes: '异兽', artStyle: 'pixel' })
    expect(!missing.ok && missing.missing.join()).toContain('ink=水墨')
  })

  it('leaves 2D projects without a runtime key', () => {
    const verdict = gate({ title: 'T', pitch: 'p', elementTypes: '角色', artStyle: resolveArtStyle('pixel') ?? 'pixel' })
    expect(verdict.ok && 'runtime' in verdict.manifest).toBe(false)
    expect(parseManifest(JSON.stringify({ id: 'g', runtime: { kit: '3d-three' } }))).toMatchObject({ ok: true, manifest: { runtime: { kit: '3d-three', version: 1 } } })
  })
})
