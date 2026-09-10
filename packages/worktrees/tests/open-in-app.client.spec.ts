/**
 * Unit tests for the open-in-app browser face: the availability probe (ok /
 * non-ok / network failure / malformed payloads), the file-manager picker
 * behind the external-open gesture, and the launch POST.
 */
import { describe, expect, it } from 'vitest'
import {
  OPEN_IN_APP_APPS_ROUTE, OPEN_IN_APP_OPEN_ROUTE, OpenInAppProbe, pickFileManager,
} from '../src/client/open-in-app.ts'

/** A minimal Response stand-in for the probe's fetch carrier. */
function fakeResponse(ok: boolean, payload?: unknown): Response {
  return { ok, json: () => Promise.resolve(payload) } as Response
}

type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>

describe('pickFileManager', () => {
  it('picks the first probed catalog id in preference order', () => {
    expect(pickFileManager(['vscode', 'explorer'])).toBe('explorer')
    expect(pickFileManager(['filemanager', 'finder'])).toBe('finder')
  })

  it('returns undefined when the host resolved no backing app', () => {
    expect(pickFileManager(['vscode', 'cursor'])).toBeUndefined()
    expect(pickFileManager([])).toBeUndefined()
  })
})

describe('OpenInAppProbe.load', () => {
  it('publishes the probed app ids after a 200', async () => {
    const calls: string[] = []
    const fetcher: Fetch = (input) => {
      calls.push(String(input))
      return Promise.resolve(fakeResponse(true, { apps: ['finder', 'vscode'] }))
    }
    const probe = new OpenInAppProbe(fetcher)
    expect(probe.apps.getSnapshot()).toBeNull()
    await probe.load()
    expect(probe.apps.getSnapshot()).toEqual(['finder', 'vscode'])
    expect(calls).toEqual([`http://dsh.internal${OPEN_IN_APP_APPS_ROUTE}`])
  })

  it('publishes an empty list when the host has no open-in-app routes (404)', async () => {
    const probe = new OpenInAppProbe(() => Promise.resolve(fakeResponse(false)))
    await probe.load()
    expect(probe.apps.getSnapshot()).toEqual([])
  })

  it('publishes an empty list on a network failure', async () => {
    const probe = new OpenInAppProbe(() => Promise.reject(new Error('connection refused')))
    await probe.load()
    expect(probe.apps.getSnapshot()).toEqual([])
  })

  it('publishes only string ids from a malformed payload', async () => {
    const bad = new OpenInAppProbe(() => Promise.resolve(fakeResponse(true, { nope: true })))
    await bad.load()
    expect(bad.apps.getSnapshot()).toEqual([])
    const mixed = new OpenInAppProbe(() => Promise.resolve(fakeResponse(true, { apps: ['finder', 42, null] })))
    await mixed.load()
    expect(mixed.apps.getSnapshot()).toEqual(['finder'])
  })

  it('shares one read across concurrent load calls', async () => {
    let reads = 0
    const probe = new OpenInAppProbe(() => {
      reads += 1
      return Promise.resolve(fakeResponse(true, { apps: [] }))
    })
    await Promise.all([probe.load(), probe.load()])
    expect(reads).toBe(1)
  })
})

describe('OpenInAppProbe.open', () => {
  it('POSTs the catalog id and directory as JSON to the open route', async () => {
    let seen: { url: string, init?: RequestInit } | undefined
    const fetcher: Fetch = (input, init) => {
      seen = { url: String(input), init }
      return Promise.resolve(fakeResponse(true))
    }
    const probe = new OpenInAppProbe(fetcher)
    await expect(probe.open('finder', '/tmp/work')).resolves.toBe(true)
    expect(seen?.url).toBe(`http://dsh.internal${OPEN_IN_APP_OPEN_ROUTE}`)
    expect(seen?.init?.method).toBe('POST')
    expect(seen?.init?.headers).toEqual({ 'content-type': 'application/json' })
    expect(JSON.parse(String(seen?.init?.body))).toEqual({ app: 'finder', path: '/tmp/work' })
  })

  it('resolves false on a non-ok answer or a network failure', async () => {
    const rejected = new OpenInAppProbe(() => Promise.resolve(fakeResponse(false)))
    await expect(rejected.open('finder', '/tmp/work')).resolves.toBe(false)
    const unreachable = new OpenInAppProbe(() => Promise.reject(new Error('offline')))
    await expect(unreachable.open('finder', '/tmp/work')).resolves.toBe(false)
  })
})
