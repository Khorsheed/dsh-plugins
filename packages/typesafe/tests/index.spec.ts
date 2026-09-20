/** The core row's composition contract: it provides the service under the documented name. */
import { describe, expect, it } from 'vitest'
import { apply, Config, inject, name } from '../src/index.ts'
import { TYPE_SAFE_DEFAULTS } from '../src/service.ts'

describe('the typesafe core row', () => {
  it('publishes ctx.typesafe and injects only the credential seam', () => {
    const provided: { service?: string; instance?: unknown } = {}
    const infos: string[] = []
    const ctx = {
      provide: (service: string, instance: unknown) => { provided.service = service; provided.instance = instance },
      logger: { info: (message: string) => { infos.push(message) } },
    }
    apply(ctx as never, { apiKeyRef: 'MY_TYPESAFE_KEY' })
    expect(name).toBe('typesafe')
    expect(inject).toEqual(['credentials'])
    expect(provided.service).toBe('typesafe')
    expect(provided.instance).toBeDefined()
    expect(infos[0]).toContain('MY_TYPESAFE_KEY')
    expect(infos[0]).toContain(TYPE_SAFE_DEFAULTS.defaultModel)
  })

  it('defaults every config key and never accepts a literal key', () => {
    expect(new Config({} as never)).toEqual({ ...TYPE_SAFE_DEFAULTS })
    const overridden = new Config({ apiKeyRef: 'OTHER_KEY', timeoutMs: 250 } as never)
    expect(overridden).toMatchObject({ apiKeyRef: 'OTHER_KEY', timeoutMs: 250, defaultModel: 'jev-latest' })
    expect(Object.keys(overridden)).not.toContain('apiKey')
  })
})
