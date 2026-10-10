/**
 * Wire-arity regression: the gateway runtime enforces each verb's DECLARED
 * parameter count exactly — `prepareInvocation` throws before any network
 * traffic when the count mismatches, and a trailing optional parameter counts
 * (`client api: requestInspector/listTurns expected 2 argument(s), got 1`).
 * The client's wire helper must therefore call every verb at full descriptor
 * arity. The gate below mirrors the runtime check against the REAL generated
 * descriptor (lib/typert.remote-client.js — regenerated from src/remote.ts on
 * every build), so adding a wire parameter without updating the client call
 * sites fails this suite, not a user's panel.
 */
import { describe, expect, it } from 'vitest'
import TYPERT_REMOTE from '@khorsheed/dsh-request-inspector/remote'
import { inspectorWire } from '../src/client/wire.ts'
import type { InspectorRemote } from '../src/client/contract.ts'

const VERBS = ['getRequest', 'getTurn', 'getTurnTiming', 'listTurns'] as const

interface VerbDescriptor {
  method: string
  parameters: readonly unknown[]
}

/**
 * A remote face that replicates the gateway's exact-arity gate from the real
 * descriptor and records every call: a short call rejects with the runtime's
 * error shape; a full-arity call resolves a well-formed failure envelope.
 */
function gatedRemote(): { calls: Map<string, unknown[][]>; face: InspectorRemote } {
  const calls = new Map<string, unknown[][]>()
  const face: Record<string, (...args: unknown[]) => Promise<unknown>> = {}
  for (const descriptor of TYPERT_REMOTE.descriptors as readonly VerbDescriptor[]) {
    calls.set(descriptor.method, [])
    face[descriptor.method] = (...args: unknown[]) => {
      calls.get(descriptor.method)?.push(args)
      if (args.length !== descriptor.parameters.length) {
        return Promise.reject(new Error(
          `client api: requestInspector/${descriptor.method} expected ${descriptor.parameters.length} argument(s), got ${args.length}`,
        ))
      }
      return Promise.resolve({ ok: false, error: { code: 'test/stop', message: 'arity gate passed' } })
    }
  }
  return { calls, face: face as unknown as InspectorRemote }
}

describe('client wire arity (the gateway runtime’s exact-parameter-count gate)', () => {
  it('the descriptor covers exactly the four verbs the client calls', () => {
    expect(TYPERT_REMOTE.descriptors.map(descriptor => descriptor.method).sort()).toEqual([...VERBS])
  })

  it('inspectorWire calls all four verbs at full descriptor arity', async () => {
    const { calls, face } = gatedRemote()
    const wire = inspectorWire(face)
    await wire.listTurns('s1' as never)
    await wire.getTurn('s1' as never, 1)
    await wire.getRequest('s1' as never, 2)
    await wire.getTurnTiming('s1' as never, 1)
    for (const descriptor of TYPERT_REMOTE.descriptors as readonly VerbDescriptor[]) {
      const recorded = calls.get(descriptor.method) ?? []
      expect(recorded, descriptor.method).toHaveLength(1)
      expect(recorded[0], descriptor.method).toHaveLength(descriptor.parameters.length)
    }
  })

  it('the gate rejects a short call exactly like the runtime (the regression this pins)', async () => {
    const { face } = gatedRemote()
    // The pre-fix call shape: one argument against a two-parameter descriptor.
    await expect(face.listTurns('s1' as never)).rejects.toThrow(/expected 2 argument\(s\), got 1/)
    await expect(face.getTurn('s1' as never, 1)).rejects.toThrow(/expected 3 argument\(s\), got 2/)
  })
})
