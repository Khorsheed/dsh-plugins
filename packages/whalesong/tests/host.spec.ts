import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { apply, resolveConfig, WHALESONG_CONFIG_PATH } from '../src/index.ts'

/** One registered route, structurally typed (tests may read the full route). */
interface CapturedRoute {
  kind: string
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void
}

/** Fake webServer capturing the registered route. */
function fakeWebServer(): { routes: CapturedRoute[]; register: (route: CapturedRoute) => () => void } {
  const routes: CapturedRoute[] = []
  return {
    routes,
    register(route) {
      routes.push(route)
      return () => {}
    },
  }
}

/** Minimal ServerResponse double recording the status and body. */
function fakeResponse(): { status: number | undefined; body: string } & ServerResponse {
  const res = {
    status: undefined as number | undefined,
    body: '',
    writeHead(status: number): void { this.status = status },
    end(body: string): void { this.body = body },
  }
  return res as unknown as ServerResponse & { status: number | undefined; body: string }
}

describe('resolveConfig (host)', () => {
  it('defaults to enabled with full volume', () => {
    expect(resolveConfig({})).toEqual({ enabled: true, volume: 1 })
  })

  it('passes explicit values through', () => {
    expect(resolveConfig({ enabled: false, volume: 0.4 })).toEqual({ enabled: false, volume: 0.4 })
  })

  it('clamps volume into 0..1 (schema stays lenient, resolve is the guard)', () => {
    expect(resolveConfig({ volume: -2 }).volume).toBe(0)
    expect(resolveConfig({ volume: 9 }).volume).toBe(1)
  })
})

describe('whalesong host anchor', () => {
  const contexts: Context[] = []
  afterEach(async () => {
    while (contexts.length > 0) await contexts.pop()!.fiber.dispose()
  })

  /** Mount the anchor and return the single route it registered. */
  function mount(config: Parameters<typeof apply>[1]): CapturedRoute {
    const ctx = new Context()
    contexts.push(ctx)
    const web = fakeWebServer()
    ctx.provide('webServer', web as never)
    apply(ctx, config)
    expect(web.routes).toHaveLength(1)
    return web.routes[0]!
  }

  it('registers an exact GET route for the resolved config', () => {
    const route = mount({ enabled: false, volume: 0.4 })
    expect(route.kind).toBe('exact')
    expect(route.path).toBe(WHALESONG_CONFIG_PATH)
    const res = fakeResponse()
    route.handler({ method: 'GET' } as IncomingMessage, res)
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ enabled: false, volume: 0.4 })
  })

  it('serves the resolved defaults when config is empty', () => {
    const route = mount({})
    const res = fakeResponse()
    route.handler({ method: 'GET' } as IncomingMessage, res)
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ enabled: true, volume: 1 })
  })

  it('rejects non-GET methods with 405', () => {
    const route = mount({})
    const res = fakeResponse()
    route.handler({ method: 'POST' } as IncomingMessage, res)
    expect(res.status).toBe(405)
    expect(JSON.parse(res.body)).toEqual({
      error: { code: 'method-not-allowed', message: 'config is a GET endpoint' },
    })
  })
})
