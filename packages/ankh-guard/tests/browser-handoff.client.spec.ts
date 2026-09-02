// @vitest-environment jsdom
/** Browser loop: in-place replacement/reload and authenticated page acknowledgement. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.ts'

const CAPABILITY_KEY = 'ankh-guard.browser-handoff-capability.v1'
const PENDING_KEY = 'ankh-guard.browser-handoff-pending.v1'

function response(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
  })
}

describe('browser handoff client lifecycle', () => {
  beforeEach(() => {
    sessionStorage.clear()
    document.documentElement.innerHTML = '<head></head><body></body>'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the final launch URL out of storage and replaces the original tab', async () => {
    const replace = vi.fn()
    vi.stubGlobal('location', {
      hash: '',
      href: 'http://127.0.0.1:3080/session/one',
      origin: 'http://127.0.0.1:3080',
      reload: vi.fn(),
      replace,
    })
    const launchUrl = 'http://127.0.0.1:3080/?token=final-process-only'
    vi.stubGlobal('fetch', vi.fn(async () => response(200, {
      state: 'ready',
      action: 'replace',
      cutoverId: 'cutover-client-replace',
      authentication: 'launch-url',
      launchUrl,
    })))

    const dispose = apply({} as never)
    await vi.waitFor(() => { expect(replace).toHaveBeenCalledWith(launchUrl) })
    expect(sessionStorage.getItem(PENDING_KEY)).toContain('cutover-client-replace')
    const stored = Array.from({ length: sessionStorage.length }, (_, index) => (
      sessionStorage.getItem(sessionStorage.key(index) ?? '') ?? ''
    )).join('\n')
    expect(stored).not.toContain('final-process-only')
    expect(document.getElementById('ankh-guard-browser-handoff')).not.toBeNull()
    dispose()
  })

  it('reloads with an existing cookie and acknowledges only after the new page loads', async () => {
    const reload = vi.fn()
    vi.stubGlobal('location', {
      hash: '',
      href: 'http://127.0.0.1:3080/session/one',
      origin: 'http://127.0.0.1:3080',
      reload,
      replace: vi.fn(),
    })
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response(200, {
      state: 'ready',
      action: 'reload',
      cutoverId: 'cutover-client-reload',
      authentication: 'existing-cookie',
    }))
    vi.stubGlobal('fetch', fetch)

    const firstDispose = apply({} as never)
    await vi.waitFor(() => { expect(reload).toHaveBeenCalledOnce() })
    firstDispose()
    const pending = sessionStorage.getItem(PENDING_KEY)
    expect(pending).toContain('existing-cookie')
    expect(pending).toContain(sessionStorage.getItem(CAPABILITY_KEY))

    fetch.mockImplementation(async () => response(204))
    const secondDispose = apply({} as never)
    await vi.waitFor(() => { expect(sessionStorage.getItem(PENDING_KEY)).toBeNull() })
    expect(sessionStorage.getItem(CAPABILITY_KEY)).toBeNull()
    expect(document.getElementById('ankh-guard-browser-handoff')).toBeNull()
    const ack = JSON.parse(String(fetch.mock.calls.at(-1)?.[1]?.body)) as Record<string, unknown>
    expect(ack).toMatchObject({
      operation: 'ack',
      cutoverId: 'cutover-client-reload',
      channel: 'original-tab',
      authentication: 'existing-cookie',
    })
    secondDispose()
  })

  it('consumes the fallback fragment and acknowledges from the authenticated fallback page', async () => {
    const replaceState = vi.fn()
    vi.stubGlobal('location', {
      hash: '#ankh-guard-handoff=cutover-fallback-page',
      href: 'http://127.0.0.1:3080/#ankh-guard-handoff=cutover-fallback-page',
      origin: 'http://127.0.0.1:3080',
      reload: vi.fn(),
      replace: vi.fn(),
    })
    vi.stubGlobal('history', { state: null, replaceState })
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response(204))
    vi.stubGlobal('fetch', fetch)

    const dispose = apply({} as never)
    await vi.waitFor(() => { expect(fetch).toHaveBeenCalledOnce() })
    await vi.waitFor(() => { expect(sessionStorage.getItem(PENDING_KEY)).toBeNull() })
    const ack = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as Record<string, unknown>
    expect(ack).toMatchObject({
      operation: 'ack',
      cutoverId: 'cutover-fallback-page',
      channel: 'fallback-tab',
      authentication: 'launch-url',
    })
    expect(ack).not.toHaveProperty('capability')
    expect(replaceState).toHaveBeenCalledOnce()
    expect(sessionStorage.length).toBe(0)
    dispose()
  })

  it('dismisses a stale waiting overlay after a public or restored cutover settles', async () => {
    vi.stubGlobal('location', {
      hash: '',
      href: 'http://127.0.0.1:3080/session/one',
      origin: 'http://127.0.0.1:3080',
      reload: vi.fn(),
      replace: vi.fn(),
    })
    const overlay = document.createElement('div')
    overlay.id = 'ankh-guard-browser-handoff'
    document.documentElement.append(overlay)
    vi.stubGlobal('fetch', vi.fn(async () => response(200, { state: 'idle' })))

    const dispose = apply({} as never)
    await vi.waitFor(() => {
      expect(document.getElementById('ankh-guard-browser-handoff')).toBeNull()
    })
    dispose()
  })
})
