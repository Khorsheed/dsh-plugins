/**
 * One read hook for every surface: call a Remote read, re-run it whenever the
 * board's freshness counter moves, and keep the last good value while the
 * next read is in flight (no flash back to "loading").
 *
 * @module @khorsheed/dsh-canvas-novel/client
 */
import { useEffect, useState } from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { NovelError } from '../types.ts'
import type { NovelRemote } from './contract.ts'

/** A read's state: the value, or why there is none yet. */
export type NovelRead<T> =
  | { readonly state: 'loading' }
  | { readonly state: 'error'; readonly message: string }
  | { readonly state: 'ready'; readonly value: T }

/**
 * Read once per `[key, rev]` (and when the Remote appears).
 * @param remote - the mounted namespace (undefined: nothing to read).
 * @param call - the read.
 * @param key - what is being read (a new key drops the old value).
 * @param rev - the board freshness counter.
 */
export function useNovelRead<T>(
  remote: NovelRemote | undefined,
  call: (remote: NovelRemote) => Promise<RemoteResult<T>>,
  key: string,
  rev: number,
): NovelRead<T> {
  const [read, setRead] = useState<{ key: string; read: NovelRead<T> }>({ key, read: { state: 'loading' } })
  useEffect(() => {
    if (remote === undefined) return
    let live = true
    call(remote).then(
      (result) => {
        if (!live) return
        setRead({ key, read: result.ok ? { state: 'ready', value: result.value } : { state: 'error', message: result.error.message } })
      },
      (error: unknown) => {
        if (live) setRead({ key, read: { state: 'error', message: error instanceof Error ? error.message : String(error) } })
      },
    )
    return () => { live = false }
    // `call` is a fresh closure every render and `remote` a fresh proxy per
    // `ctx.get` — depending on either re-reads after every landed read (an
    // endless loop that also starves a second read on the same page). `key`
    // names what is read; only the Remote's presence matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remote !== undefined, key, rev])
  return read.key === key ? read.read : { state: 'loading' }
}

/** The dictionary key for an engine error code. */
export function errorKey(error: NovelError | undefined): `error.${NovelError}` | 'error.io' {
  return error === undefined ? 'error.io' : `error.${error}`
}
