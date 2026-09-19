import { randomUUID } from 'node:crypto'
import type { SubagentRun } from '@deepseek-ai/dsh-subagent'
import { MemberConfigurationController } from './member-control.ts'
import type { MemberConfigurationAdapter, MemberControlStorage } from './member-control.ts'
import type { LocalAgentAppliedConfiguration, LocalAgentMemberBinding } from './types.ts'

/** The provider boundary owns the lease; facade and direct tool starts share it. */
export class MemberControls {
  private readonly admitted = new WeakMap<object, LocalAgentAppliedConfiguration>()
  configurationOf(run: object): LocalAgentAppliedConfiguration | undefined {
    const configuration = this.admitted.get(run)
    return configuration === undefined ? undefined : structuredClone(configuration)
  }
  private readonly members = new Map<string, { binding: LocalAgentMemberBinding; control: MemberConfigurationController }>()

  constructor(
    private readonly storage: MemberControlStorage,
    private readonly adapter: (binding: LocalAgentMemberBinding) => MemberConfigurationAdapter,
    private readonly onError: (error: unknown) => void,
  ) {}

  get(binding: LocalAgentMemberBinding): MemberConfigurationController {
    const known = this.members.get(binding.childSessionId)
    if (known !== undefined) {
      for (const key of ['provider', 'parentSessionId', 'cwd', 'scope', 'model', 'effort', 'configurationLock'] as const) {
        if (known.binding[key] !== binding[key]) throw new Error(`Member configuration identity changed: ${key}`)
      }
      return known.control
    }
    // Resolve the currently mounted broker for every operation, including
    // after a provider settings reload. Never retain a disposed driver.
    const current = (): MemberConfigurationAdapter => this.adapter(binding)
    const control = new MemberConfigurationController(binding.childSessionId, this.storage, {
      validate: selection => current().validate(selection),
      apply: (selection, previous, operationId) => current().apply(selection, previous, operationId),
      reconcile: state => current().reconcile(state),
      prepare: async selection => {
        const adapter = current()
        await adapter.validate(selection)
        if (adapter.prepare === undefined) throw new Error('Provider exposes no configuration admission preparation')
        return adapter.prepare(selection)
      },
    }, {
      selection: { model: { mode: 'inherit' }, effort: { mode: 'inherit' } },
      ...binding.configurationLock === undefined ? {} : { lockedReason: binding.configurationLock },
    })
    this.members.set(binding.childSessionId, { binding: structuredClone(binding), control })
    return control
  }

  binding(memberId: string): LocalAgentMemberBinding | undefined {
    const binding = this.members.get(memberId)?.binding
    return binding === undefined ? undefined : structuredClone(binding)
  }

  private readonly tails = new Map<string, Promise<void>>()
  private readonly waiting = new Map<string, Set<string>>()

  queuedCount(memberId: string): number { return this.waiting.get(memberId)?.size ?? 0 }

  /** Every provider entry shares one FIFO through whole-round settlement. */
  async run(binding: LocalAgentMemberBinding, start: (configuration: LocalAgentAppliedConfiguration) => Promise<SubagentRun>, signal?: AbortSignal, onAdmitted?: () => void): Promise<SubagentRun> {
    signal?.throwIfAborted()
    this.get(binding) // Reject a foreign binding before accepting it into this member's queue.
    const key = binding.childSessionId
    const previous = this.tails.get(key) ?? Promise.resolve()
    const id = randomUUID()
    const waiting = this.waiting.get(key) ?? new Set<string>()
    waiting.add(id)
    this.waiting.set(key, waiting)
    let queued = true
    let cancelled = false
    let resolve!: (run: SubagentRun) => void
    let reject!: (error: unknown) => void
    const receipt = new Promise<SubagentRun>((yes, no) => { resolve = yes; reject = no })
    const remove = (): void => {
      waiting.delete(id)
      if (waiting.size === 0 && this.waiting.get(key) === waiting) this.waiting.delete(key)
    }
    const abort = (): void => {
      if (!queued) return
      cancelled = true
      remove()
      reject(signal?.reason ?? new Error('Queued member round cancelled'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    const task = previous.catch(() => {}).then(async () => {
      queued = false
      signal?.removeEventListener('abort', abort)
      remove()
      if (cancelled) return
      try {
        signal?.throwIfAborted()
        const run = await this.runNow(binding, start, signal, onAdmitted)
        resolve(run)
        await run.result
      } catch (error) { reject(error) }
    })
    this.tails.set(key, task)
    void task.finally(() => { if (this.tails.get(key) === task) this.tails.delete(key) })
    return receipt
  }

  private async runNow(binding: LocalAgentMemberBinding, start: (configuration: LocalAgentAppliedConfiguration) => Promise<SubagentRun>, signal?: AbortSignal, onAdmitted?: () => void): Promise<SubagentRun> {
    const control = this.get(binding)
    const lease = await control.admit(randomUUID())
    let nativeStarted = false
    try {
      signal?.throwIfAborted()
      onAdmitted?.()
      nativeStarted = true
      const run = await start(lease.configuration)
      this.admitted.set(run, lease.configuration)
      const release = (): void => { try { lease.release() } catch (error) { this.onError(error) } }
      void run.result.then(release, release)
      return run
    } catch (error) {
      // Cancelling a request is not a failed model/effort configuration.
      if (nativeStarted && !signal?.aborted) try { control.rejectAdmission(error) } catch (persistError) { this.onError(persistError) }
      try { lease.release() } catch (releaseError) { this.onError(releaseError) }
      throw error
    }
  }
}
