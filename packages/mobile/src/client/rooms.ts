/** Optional Room Remote vocabulary, audited against dsh-room's public wire face.
 * No sibling runtime import, registration, roster persistence or agent execution. */
export interface MobileMember { name: string; kind: 'main-agent' | 'cli'; provider?: string; instructions?: string; cwd?: string; childSessionId?: string }
export interface MobileRoom { members: readonly MobileMember[]; runs: readonly { member: string; state: string }[] }
export interface MobileProvider { provider: string; displayName: string; authenticated: boolean }
export interface ProviderList { localAgentAvailable: boolean; providers: readonly MobileProvider[] }
export type RoomRemoteFace = Record<string, (request: Record<string, unknown>) => Promise<{ ok: boolean; value?: unknown }>>
export class RoomFailure extends Error { constructor(readonly code: string) { super(code) } }
export class MobileRooms {
  private cache = new Map<string, { state: MobileRoom | null; at: number }>()
  private pending = new Map<string, Promise<MobileRoom | null | undefined>>()
  private listeners = new Set<() => void>()
  private version = 0
  private alive = true
  constructor(private remote: () => RoomRemoteFace | undefined) {}
  readonly subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  readonly getSnapshot = () => this.version
  available() { return typeof this.remote()?.getState === 'function' }
  get(id: string) { return this.cache.get(id)?.state }
  async refresh(id: string, force = false): Promise<MobileRoom | null | undefined> {
    if (!this.alive || !this.available()) return undefined
    const cached = this.cache.get(id)
    if (!force && cached && Date.now() - cached.at < 15000) return cached.state
    const running = this.pending.get(id); if (running) return running
    const work = this.fetch(id).finally(() => this.pending.delete(id)); this.pending.set(id, work); return work
  }
  private async fetch(id: string) {
    try {
      const state = await this.mutate<MobileRoom>('getState', { sessionId: id })
      if (!Array.isArray(state.members) || !Array.isArray(state.runs)) throw new RoomFailure('unsupported')
      this.publish(id, state); return state
    } catch (error) {
      if (error instanceof RoomFailure && error.code === 'not-a-room') { this.publish(id, null); return null }
      return undefined // Offline/removed plugin is unknown, never silently a one-member room.
    }
  }
  private publish(id: string, state: MobileRoom | null) {
    if (!this.alive) return
    this.cache.delete(id); this.cache.set(id, { state, at: Date.now() })
    if (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value!)
    this.version++; for (const fn of this.listeners) fn()
  }
  async providers(): Promise<ProviderList> { return this.call('listProviders', {}) as Promise<ProviderList> }
  private async call(method: string, request: Record<string, unknown>): Promise<unknown> {
    const remote = this.remote(), fn = remote?.[method]
    if (!fn) throw new RoomFailure('unavailable')
    const result = await fn.call(remote, request)
    if (!result.ok) throw new RoomFailure('connection')
    return result.value
  }
  async mutate<T = unknown>(method: string, request: Record<string, unknown>): Promise<T> {
    const result = await this.call(method, request) as { ok: boolean; value?: T; error?: { code?: string } }
    if (!result?.ok) throw new RoomFailure(result?.error?.code ?? 'unknown')
    return result.value as T
  }
  dispose() { this.alive = false; this.listeners.clear(); this.cache.clear() }
}
