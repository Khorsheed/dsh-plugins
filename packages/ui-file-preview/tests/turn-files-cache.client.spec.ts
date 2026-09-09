import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { createTurnFilesLoader } from '../src/client/turn-files-cache.ts'
import type { FilePreviewRemote } from '../src/client/contract.ts'

const sid = 's1' as SessionId

describe('createTurnFilesLoader', () => {
  it('fetches once per session and serves every warmed turn from the cache', async () => {
    const rpc = vi.fn(async () => ({
      ok: true as const,
      value: {
        asOfSeq: 5,
        turns: [
          { turn: 1, files: [{ path: 'a.md', seq: 1, step: 1, added: 1, removed: 0 }] },
          { turn: 2, files: [{ path: 'b.ts', seq: 2, step: 1, added: undefined, removed: undefined }] },
        ],
      },
    }))
    const loader = createTurnFilesLoader({ turnFiles: rpc } as unknown as FilePreviewRemote)
    expect(await loader(sid, 1)).toHaveLength(1)
    expect(await loader(sid, 2)).toHaveLength(1)
    // One RPC warmed both turns.
    expect(rpc).toHaveBeenCalledTimes(1)
    // A turn the cache does not know (a newer turn) refetches once.
    expect(await loader(sid, 3)).toEqual([])
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it('pins an empty turn so the same card never refetches', async () => {
    const rpc = vi.fn(async () => ({ ok: true as const, value: { asOfSeq: 5, turns: [] } }))
    const loader = createTurnFilesLoader({ turnFiles: rpc } as unknown as FilePreviewRemote)
    expect(await loader(sid, 1)).toEqual([])
    expect(await loader(sid, 1)).toEqual([])
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('resolves empty on a failed fetch (the card just shows nothing)', async () => {
    const rpc = vi.fn(async () => ({ ok: false as const, error: { code: 'x', message: 'boom', details: {} } }))
    const loader = createTurnFilesLoader({ turnFiles: rpc } as unknown as FilePreviewRemote)
    expect(await loader(sid, 1)).toEqual([])
  })
})
