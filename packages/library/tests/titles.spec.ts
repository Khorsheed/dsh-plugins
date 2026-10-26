/**
 * Display titles (client/titles.ts): a textbook's trailing parenthesis is its
 * subtitle; a station loses its 「站 N：」 prefix and its trailing chapter note.
 */
import { describe, expect, it } from 'vitest'
import { splitTitle, stationTitle } from '../src/client/titles.ts'

describe('display titles', () => {
  it('splits a textbook title at its trailing parenthesis', () => {
    expect(splitTitle('Blender 4.5 LTS 官方手册（Getting Started / User Interface / 3D Viewport）')).toEqual({ main: 'Blender 4.5 LTS 官方手册', sub: 'Getting Started / User Interface / 3D Viewport' })
    expect(splitTitle('普林斯顿微积分读本')).toEqual({ main: '普林斯顿微积分读本' })
    expect(splitTitle('（全是括号）')).toEqual({ main: '（全是括号）' })
  })

  it('drops a station\'s number prefix and its chapter note, never the whole title', () => {
    expect(stationTitle('站 1：Blender 基础与术语入门（教材 A 第 1-3 章）')).toBe('Blender 基础与术语入门')
    expect(stationTitle('第一次建模练习（教材 A 第 4 章）')).toBe('第一次建模练习')
    expect(stationTitle('T1 · P2 Nature or Nurture?')).toBe('T1 · P2 Nature or Nurture?')
    expect(stationTitle('材质（PBR 入门）')).toBe('材质（PBR 入门）')
  })
})
