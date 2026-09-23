/** Keep one retry identity per room draft until the server acknowledges it. */
export class RoomRequestIds {
  private readonly pending = new Map<string, { signature: string; id: string }>()
  forInput(sessionId: string, text: string, targets: readonly string[] = []): string {
    const signature = JSON.stringify({ text: text.trim(), targets: [...new Set(targets)].sort() })
    const known = this.pending.get(sessionId)
    if (known?.signature === signature) return known.id
    const id = typeof globalThis.crypto.randomUUID === 'function' ? globalThis.crypto.randomUUID()
      : Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('')
    this.pending.delete(sessionId)
    this.pending.set(sessionId, { signature, id })
    if (this.pending.size > 128) this.pending.delete(this.pending.keys().next().value!)
    return id
  }
  complete(sessionId: string, id: string): void {
    if (this.pending.get(sessionId)?.id === id) this.pending.delete(sessionId)
  }
}
