import { describe, expect, it } from 'vitest'
import * as entry from '../src/index.ts'
import * as invariantCompanion from '../src/invariant.ts'
import { EvalService } from '../src/service.ts'

interface ProvideSpy {
  provided: Map<string, unknown>
  provide: (name: string, service: unknown) => void
  eval?: EvalService
  commands?: { register: (command: { name: string; handler: unknown }) => unknown }
  invariants?: { register: (pkg: string, install: unknown) => () => void }
  /** Deferred injection; this composition has no tools registry, so it never fires. */
  inject?: (deps: string[], callback: (ctx: unknown) => void) => void
  /** The Remote face mounts through the plugin seam; this fake records nothing. */
  plugin?: (plugin: unknown) => void
}

describe('the plugin surface', () => {
  it('exposes the identity triangle facts', () => {
    expect(entry.name).toBe('eval')
    expect(typeof entry.apply).toBe('function')
    expect(invariantCompanion.name).toBe('eval-invariant')
  })

  it('apply provides ctx.dshEval, registers /eval, and requires only the command registry', () => {
    const registered: string[] = []
    const ctx: ProvideSpy = {
      provided: new Map(),
      provide(name, service) { this.provided.set(name, service) },
      commands: { register: (command) => { registered.push(command.name) } },
      // No tools registry in this composition: the deferred callback never
      // fires, and the plugin mounts anyway (degrade, don't explode).
      inject: () => {},
      // The Remote face mounts through the plugin seam (nothing to record here).
      plugin: () => {},
    }
    entry.apply(ctx as never)
    const service = ctx.provided.get('dshEval')
    expect(service).toBeInstanceOf(EvalService)
    expect(registered).toEqual(['eval'])
    // The slash face is the ONLY reason a host service is STATICALLY injected;
    // the tool registry joins through deferred injection and the upstream
    // evaluation services are probed per call — never injected.
    expect(entry.inject).toEqual(['commands'])
  })

  it('the invariant companion registers package ownership', () => {
    const registered: string[] = []
    const ctx: ProvideSpy = {
      invariants: { register: (pkg) => { registered.push(pkg); return () => {} } },
      provided: new Map(),
      provide() {},
    }
    void invariantCompanion.apply(ctx as never)
    expect(registered).toEqual(['@khorsheed/dsh-eval'])
  })

  it('the kernel hashes a valid condition without touching the filesystem', () => {
    const service = new EvalService()
    const { sha, warnings } = service.hashCondition({
      schema: 'dataseek.condition/1',
      harness: { name: 'kimi', version: '1.0', drive: 'exec' },
      model: { declared: 'k2', endpoint: 'api' },
      reasoning: { effort: 'high' },
      permissions: 'auto-approve',
      instructions: 'none',
      preset: null,
      skills: { pack: null },
      home: { sha: 'a'.repeat(64) },
      env: { keys: ['KIMI_API_KEY'] },
    })
    expect(sha).toMatch(/^[0-9a-f]{64}$/)
    expect(warnings).toEqual([])
  })
})
