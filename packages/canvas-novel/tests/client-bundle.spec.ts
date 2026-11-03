import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

type Factory = (require: (id: string) => unknown) => { readonly apply?: unknown }

describe('canvas-novel browser artifact', () => {
  it('evaluates its factory without Node modules or Node globals', () => {
    let factory: Factory | undefined
    const document = {
      createElement: vi.fn(() => ({ dataset: {} })),
      head: { appendChild: vi.fn() },
      querySelector: vi.fn(() => null),
    }
    const window: Record<string, unknown> = {
      document,
      __ModuleLoader__: { load: (registration: { factory: Factory }) => { factory = registration.factory } },
    }
    window['window'] = window
    window['self'] = window
    const context = createContext({
      window,
      self: window,
      document,
      location: { hostname: '127.0.0.1' },
      navigator: { userAgent: 'browser-smoke' },
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      TextDecoder,
      TextEncoder,
      Uint8Array,
      ArrayBuffer,
      DataView,
      Promise,
      Blob,
      atob,
      btoa,
      console,
    })
    runInContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), context)
    if (factory === undefined) throw new Error('The browser factory was not registered')
    const requested: string[] = []
    const stub = new Proxy({}, { get: (_target, key) => key === '__esModule' ? true : vi.fn() })
    const exported = factory((id) => {
      requested.push(id)
      if (id === 'react' || id === 'react-dom' || id.startsWith('react/') || id.startsWith('react-dom/') || id.startsWith('@deepseek-ai/') || id.startsWith('@khorsheed/')) return stub
      throw new Error(`Unexpected external browser module: ${id}`)
    })
    expect(exported.apply).toBeTypeOf('function')
    expect(requested.length).toBeGreaterThan(0)
  })
})
