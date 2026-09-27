// @vitest-environment jsdom
/** OpenInAppProbe: the once-per-page apps probe + folder-fallback POST, and
 * the catalog pickers driving gesture visibility. */

import { describe, expect, it, vi } from 'vitest'
import { OpenInAppProbe, pickFileManager, pickIde } from '../src/client/open-in-app.ts'

describe('pickFileManager / pickIde', () => {
  it('picks the first probed id in catalog order', () => {
    expect(pickFileManager(['cursor', 'explorer', 'finder'])).toBe('finder')
    expect(pickFileManager(['explorer'])).toBe('explorer')
    expect(pickFileManager(['cursor'])).toBeUndefined()
    expect(pickIde(['cursor', 'vscode'])).toBe('cursor')
    expect(pickIde(['vscodeinsiders'])).toBe('vscodeinsiders')
    expect(pickIde(['finder'])).toBeUndefined()
  })
})

describe('OpenInAppProbe', () => {
  it('publishes the probed app ids and shares one in-flight read', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ apps: ['finder', 'cursor', 42] })))
    const probe = new OpenInAppProbe(fetcher)
    expect(probe.apps.getSnapshot()).toBeNull()
    await Promise.all([probe.load(), probe.load()])
    expect(fetcher).toHaveBeenCalledTimes(1)
    // Non-string entries are filtered.
    expect(probe.apps.getSnapshot()).toEqual(['finder', 'cursor'])
  })

  it('publishes an empty list when the host has no route or the read fails', async () => {
    const notFound = new OpenInAppProbe(vi.fn(async () => new Response('nope', { status: 404 })))
    await notFound.load()
    expect(notFound.apps.getSnapshot()).toEqual([])
    const unreachable = new OpenInAppProbe(vi.fn(async () => { throw new Error('offline') }))
    await unreachable.load()
    expect(unreachable.apps.getSnapshot()).toEqual([])
  })

  it('POSTs the open route with the catalog id and directory path', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }))
    const probe = new OpenInAppProbe(fetcher)
    expect(await probe.open('finder', '/work/docs')).toBe(true)
    const [, init] = fetcher.mock.calls[0] as unknown as [unknown, RequestInit]
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ app: 'finder', path: '/work/docs' })
  })

  it('answers false on a failed launch POST', async () => {
    const probe = new OpenInAppProbe(vi.fn(async () => { throw new Error('offline') }))
    expect(await probe.open('finder', '/work')).toBe(false)
  })
})
