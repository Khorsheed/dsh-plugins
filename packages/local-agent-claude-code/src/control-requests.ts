type JsonObject = Record<string, unknown>

/** Bounded, correlated Claude stream-json controls, shared by discovery and live sessions. */
export class ClaudeControlRequests {
  private sequence = 0
  private closed = false
  private readonly pending = new Map<string, {
    resolve: (response: JsonObject) => void
    reject: (error: Error) => void
  }>()

  constructor(private readonly send: (message: JsonObject) => void, private readonly timeoutMs = 5_000) {}

  accept(event: JsonObject): boolean {
    if (event['type'] !== 'control_response') return false
    const response = event['response'] as JsonObject | undefined
    const id = response?.['request_id']
    if (typeof id !== 'string') return true
    const pending = this.pending.get(id)
    if (pending === undefined) return true
    if (response?.['subtype'] !== 'success') {
      pending.reject(new Error(typeof response?.['error'] === 'string' ? response['error'] : 'Claude rejected the control request'))
    } else {
      const result = response['response']
      pending.resolve(typeof result === 'object' && result !== null ? result as JsonObject : {})
    }
    return true
  }

  request(request: JsonObject, signal?: AbortSignal): Promise<JsonObject> {
    if (this.closed || signal?.aborted) return Promise.reject(new Error('Claude control channel is closed'))
    const id = `dsh-control-${++this.sequence}`
    return new Promise((resolve, reject) => {
      const finish = (): void => {
        this.pending.delete(id)
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
      }
      const fail = (error: Error): void => { finish(); reject(error) }
      const abort = (): void => { fail(new Error('Claude control request cancelled')) }
      const timer = setTimeout(() => fail(new Error(`Claude ${String(request['subtype'])} control timed out`)), this.timeoutMs)
      timer.unref()
      this.pending.set(id, { resolve: value => { finish(); resolve(value) }, reject: fail })
      signal?.addEventListener('abort', abort, { once: true })
      try { this.send({ type: 'control_request', request_id: id, request }) } catch (error) {
        fail(error instanceof Error ? error : new Error('Claude control write failed'))
      }
    })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const request of [...this.pending.values()]) request.reject(new Error('Claude control channel closed before acknowledgement'))
  }
}
