// @vitest-environment jsdom
/**
 * The composer's binding chip (I5·T58 · G2): the receipt `/datasets bind` had
 * nowhere to print.
 *
 * Three things are pinned: it states the binding in a session that has no
 * content yet, it says «not bound» rather than nothing when there is no
 * binding, and it re-reads when the session moves — which is the moment a
 * slash command settles, and therefore the moment the receipt has to appear.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { BindingChip, type BindingChipProps } from '../src/client/BindingChip.tsx'
import type { DatasetBinding } from '../src/types.ts'

afterEach(() => { cleanup() })

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

/** Render the chip over a fake face; `watchSession` is captured so a test can fire it. */
function renderChip(bindings: Array<DatasetBinding | null>) {
  const queue = [...bindings]
  let last = queue[0] ?? null
  const fetchBinding = vi.fn(async (): Promise<Result<DatasetBinding | null>> => {
    last = queue.length > 1 ? (queue.shift() ?? null) : (queue[0] ?? null)
    return { ok: true, value: last }
  })
  let notify: (() => void) | undefined
  const watchSession = vi.fn((_sid: SessionId, listener: () => void) => {
    notify = listener
    return () => { notify = undefined }
  })
  const props = {
    sessionId: 's1' as SessionId,
    fetchBinding,
    watchSession,
    t: (key: string, params?: Record<string, unknown>) => (
      params === undefined ? key : `${key} ${JSON.stringify(params)}`
    ),
  } as unknown as BindingChipProps
  render(<BindingChip {...props} />)
  return { fetchBinding, fire: () => { notify?.() } }
}

describe('the composer binding chip', () => {
  it('says which repository the session is bound to, and how much of it the agent sees', async () => {
    renderChip([{ repoPath: '/home/user/scratch/dataseek-eval-i5' }])

    // The repository's NAME, not its path: the path is in the tooltip, and a
    // composer control that rendered an absolute path would be the widest
    // thing in the row.
    expect(await screen.findByText('dataseek-eval-i5')).toBeTruthy()
    // A binding with no layer whitelist is the model-facing floor, said so —
    // the slash receipt used to call the same state "all layers".
    expect(screen.getByText('chip.layersFloor')).toBeTruthy()
  })

  it('names the layers when a person widened the binding on purpose', async () => {
    renderChip([{ repoPath: '/repo', layers: ['visible', 'grading'] }])
    expect(await screen.findByText('chip.layersNamed {"layers":"visible, grading"}')).toBeTruthy()
  })

  it('says «not bound» rather than nothing, because that is the state the flow starts in', async () => {
    renderChip([null])
    expect(await screen.findByText('chip.unbound')).toBeTruthy()
  })

  it('renders nothing until the first answer — no flash of «not bound» on load', () => {
    renderChip([{ repoPath: '/repo' }])
    expect(screen.queryByText('chip.unbound')).toBeNull()
    expect(screen.queryByText('chip.label')).toBeNull()
  })

  it('re-reads when the session moves, which is when a bind command settles', async () => {
    vi.useFakeTimers()
    try {
      const { fetchBinding, fire } = renderChip([null, { repoPath: '/repo/just-bound' }])
      await act(async () => { await Promise.resolve() })
      expect(screen.getByText('chip.unbound')).toBeTruthy()
      expect(fetchBinding).toHaveBeenCalledTimes(1)

      // Two notifications inside one throttle window cost one read: a
      // streaming turn moves the session constantly, and the chip must not
      // turn that into a poll.
      act(() => { fire(); fire() })
      expect(fetchBinding).toHaveBeenCalledTimes(1)
      await act(async () => { vi.advanceTimersByTime(800); await Promise.resolve() })

      expect(fetchBinding).toHaveBeenCalledTimes(2)
      expect(screen.getByText('just-bound')).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('leaves the last answer standing when the host cannot be reached', async () => {
    const props = {
      sessionId: 's1' as SessionId,
      fetchBinding: vi.fn(async (): Promise<Result<DatasetBinding | null>> => { throw new Error('offline') }),
      watchSession: vi.fn(() => () => {}),
      t: (key: string) => key,
    } as unknown as BindingChipProps
    render(<BindingChip {...props} />)
    await waitFor(() => { expect(props.fetchBinding).toHaveBeenCalled() })
    // Nothing rendered, nothing thrown: an unreachable host is not evidence
    // that the session is unbound.
    expect(screen.queryByText('chip.unbound')).toBeNull()
  })
})
