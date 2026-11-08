import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { currentHostProcess, recordHostProcess, startedBeforePreviousProcess } from '../src/host-process.ts'

const fileIn = () => join(mkdtempSync(join(tmpdir(), 'host-process-')), 'nested', '.host-process.json')

describe('host-process record', () => {
  it('rotates on a new process, keeps the record on a reload inside the same one', () => {
    const file = fileIn()
    const a = { id: 'a', startedAt: 100 }
    const b = { id: 'b', startedAt: 200 }
    expect(recordHostProcess(file, a)).toEqual({ current: a })
    expect(recordHostProcess(file, b)).toEqual({ current: b, previous: a })
    // A plugin reload in process b: unchanged, a stays the previous process.
    expect(recordHostProcess(file, b)).toEqual({ current: b, previous: a })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ current: b, previous: a })
    const c = { id: 'c', startedAt: 300 }
    expect(recordHostProcess(file, c)).toEqual({ current: c, previous: b })
  })

  it('an unreadable record counts as none; a failed write still answers for this process', () => {
    const file = fileIn()
    recordHostProcess(file, { id: 'a', startedAt: 1 })
    writeFileSync(file, '{oops')
    expect(recordHostProcess(file, { id: 'b', startedAt: 2 })).toEqual({ current: { id: 'b', startedAt: 2 } })
    const errors = vi.fn()
    const blocked = join(file, 'under-a-file', '.host-process.json')
    expect(recordHostProcess(blocked, { id: 'c', startedAt: 3 }, errors)).toEqual({ current: { id: 'c', startedAt: 3 } })
    expect(errors).toHaveBeenCalledTimes(1)
  })

  it('this process is its pid and start time', () => {
    const self = currentHostProcess()
    expect(self.startedAt).toBe(Math.round(performance.timeOrigin))
    expect(self.id).toBe(`${process.pid}@${self.startedAt}`)
  })

  it('a round that started before the previous process did belongs to an earlier restart; no evidence, no verdict', () => {
    const processes = { current: { id: 'c', startedAt: 300 }, previous: { id: 'b', startedAt: 200 } }
    expect(startedBeforePreviousProcess(150, processes)).toBe(true)
    expect(startedBeforePreviousProcess(200, processes)).toBe(false)
    expect(startedBeforePreviousProcess(250, processes)).toBe(false)
    expect(startedBeforePreviousProcess(150, { current: processes.current })).toBe(false)
    expect(startedBeforePreviousProcess(undefined, processes)).toBe(false)
    expect(startedBeforePreviousProcess(150, undefined)).toBe(false)
  })
})
