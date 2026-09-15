import type { LocalAgentControlReceipt, LocalAgentMemberConfiguration, LocalAgentMemberControlState, LocalAgentModelDirectory } from '../types.ts'

export interface MemberConfigurationFace {
  read(id: string): Promise<LocalAgentMemberControlState>
  follow(id: string, signal: AbortSignal): AsyncIterable<LocalAgentMemberControlState>
  directory(id: string, refresh: boolean): Promise<LocalAgentModelDirectory | null>
  followDirectory(id: string, signal: AbortSignal): AsyncIterable<LocalAgentModelDirectory>
  select(id: string, request: string, revision: number, selection: LocalAgentMemberConfiguration): Promise<LocalAgentControlReceipt>
  cancel(id: string, request: string, revision: number): Promise<LocalAgentControlReceipt>
  retry(id: string, revision: number): Promise<void>
}

export interface MemberConfigurationSnapshot {
  state?: LocalAgentMemberControlState
  directory?: LocalAgentModelDirectory
  connected: boolean
  error?: string | undefined
}

/** One shared source for every visible entry to the same member. */
export class MemberConfigurationStore {
  private snapshot: MemberConfigurationSnapshot = { connected: false }
  private readonly listeners = new Set<() => void>()
  private controller: AbortController | undefined
  constructor(readonly id: string, readonly face: MemberConfigurationFace, private readonly onIdle: () => void = () => {}) {}
  readonly getSnapshot = (): MemberConfigurationSnapshot => this.snapshot
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    if (this.controller === undefined) {
      const controller = this.controller = new AbortController()
      void this.follow(controller.signal)
      void this.followDirectory(controller.signal)
    }
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) {
        this.controller?.abort()
        this.controller = undefined
        this.onIdle()
      }
    }
  }
  private publish(patch: Partial<MemberConfigurationSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener()
  }
  private accept(state: LocalAgentMemberControlState): void {
    if (state.memberId !== this.id || state.revision < (this.snapshot.state?.revision ?? -1)) return
    this.publish({ state, connected: true, error: undefined })
  }
  private async follow(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        for await (const state of this.face.follow(this.id, signal)) {
          if (signal.aborted) return
          this.accept(state)
        }
      } catch (error) {
        if (!signal.aborted) this.publish({ error: error instanceof Error ? error.message : String(error) })
      }
      if (signal.aborted) return
      this.publish({ connected: false })
      await pause(signal)
    }
  }
  private async followDirectory(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        for await (const directory of this.face.followDirectory(this.id, signal)) {
          if (signal.aborted) return
          this.publish({ directory })
        }
      } catch { /* The independent configuration subscription stays available. */ }
      if (signal.aborted) return
      await pause(signal)
    }
  }
  async refreshDirectory(): Promise<void> {
    const directory = await this.face.directory(this.id, true)
    if (directory !== null) this.publish({ directory })
  }
  async refresh(): Promise<void> {
    const before = this.snapshot
    const state = await this.face.read(this.id)
    // A response cannot roll back a stream update received while it was in flight.
    if (this.snapshot === before && state.memberId === this.id && state.revision >= (before.state?.revision ?? -1)) this.publish({ state })
  }
}

function pause(signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) { resolve(); return }
    const done = (): void => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve() }
    const timer = setTimeout(done, 1_000)
    signal.addEventListener('abort', done, { once: true })
  })
}

export class MemberConfigurationStores {
  private readonly stores = new Map<string, MemberConfigurationStore>()
  constructor(private readonly face: MemberConfigurationFace) {}
  get(id: string): MemberConfigurationStore {
    let store = this.stores.get(id)
    if (store === undefined) this.stores.set(id, store = new MemberConfigurationStore(id, this.face, () => {
      if (this.stores.get(id) === store) this.stores.delete(id)
    }))
    return store
  }
}
