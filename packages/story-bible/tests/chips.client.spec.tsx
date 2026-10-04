// @vitest-environment jsdom
/**
 * The session-header gate chips (F1-5): plan-unconfirmed and pending-count
 * chips appear exactly while their gate is open, jump into the story tab on
 * click, and respect the preset criterion (hidden = render nothing).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { StoryPendingChip, StoryPlanChip } from '../src/client/chips.tsx'
import { StoryUiStore } from '../src/client/store.ts'
import { t } from './bench.tsx'

afterEach(() => { cleanup() })

/** A chip bench: the gate's read answer, the jump recorder, the store — bound the way the slot runtime binds it (useStory; there is NO hooks member). */
function chipBench(options: { gate: unknown; show?: boolean; read?: () => Promise<unknown> }) {
  const store = new StoryUiStore()
  const jump = vi.fn()
  const read = options.read ?? vi.fn(async () => options.gate)
  const props = {
    sessionId: 's1' as never,
    t,
    read,
    jump,
    show: () => options.show ?? true,
    useStory: function useStory<S>(selector: (state: ReturnType<typeof store.source.getSnapshot>) => S): S {
      return selector(useSyncExternalStore(store.source.subscribe, store.source.getSnapshot))
    },
  }
  return { props, jump, store }
}

describe('the gate chips (F1-5)', () => {
  it('the plan chip appears while a plan awaits confirmation and jumps to it', async () => {
    const { props, jump } = chipBench({ gate: { n: 6, title: '门后' } })
    render(<StoryPlanChip {...props} />)
    const chip = await screen.findByRole('button', { name: /第6章 plan 待确认/ })
    fireEvent.click(chip)
    expect(jump).toHaveBeenCalledWith(6)
  })

  it('the pending chip counts and jumps; zero hides it', async () => {
    const { props, jump } = chipBench({ gate: { count: 3 } })
    const { unmount } = render(<StoryPendingChip {...props} />)
    fireEvent.click(await screen.findByRole('button', { name: /待确认 3/ }))
    expect(jump).toHaveBeenCalledOnce()
    unmount()
    const empty = chipBench({ gate: { count: 0 } })
    render(<StoryPendingChip {...empty.props} />)
    await new Promise(resolve => { setTimeout(resolve, 20) })
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders nothing and never crashes when the face has no hooks member and read throws (the live 0.2.0-rc.2 incident shape)', async () => {
    // The slot runtime materializes `hooks: { story }` into the `useStory`
    // prop — props.hooks is undefined at runtime, and a read that throws
    // synchronously (remote.story unmounted) must not crash the header seat.
    const bench = chipBench({ gate: null, read: () => { throw new Error('story-bible: the host half is not installed') } })
    render(<StoryPlanChip {...bench.props} />)
    render(<StoryPendingChip {...bench.props} />)
    await new Promise(resolve => { setTimeout(resolve, 30) })
    expect(screen.queryByRole('button')).toBeNull()
    // The store beat (a mutation elsewhere) re-reads and still does not crash.
    bench.store.touch()
    await new Promise(resolve => { setTimeout(resolve, 30) })
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('both chips render nothing when the preset criterion hides them (and when there is no gate)', async () => {
    const hidden = chipBench({ gate: { n: 6, title: '门后' }, show: false })
    render(<StoryPlanChip {...hidden.props} />)
    const noGate = chipBench({ gate: null })
    render(<StoryPendingChip {...noGate.props} />)
    await new Promise(resolve => { setTimeout(resolve, 20) })
    expect(screen.queryByRole('button')).toBeNull()
  })
})
