// @vitest-environment jsdom
/**
 * The work strip's create form (F1-1): the default workspace is the
 * SESSION's own cwd; the host directory picker (probed) swaps it; a
 * cross-workspace pick warns; the fallback path input validates existence
 * through statWorkspace.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StoryTab } from '../src/client/StoryTab.tsx'
import { makeStoryBench, type StoryBench } from './bench.tsx'

afterEach(() => { cleanup() })

/** A bench whose pickDirectory probe answers (or is absent). */
function benchWithPicker(pick: (() => Promise<string | null>) | null, statAnswer: { exists: boolean; directory: boolean } = { exists: true, directory: true }): StoryBench {
  const bench = makeStoryBench({ focusId: null })
  const face = bench.props as unknown as Record<string, unknown>
  face['pickDirectory'] = pick
  // The face carries the RemoteResult envelope; StoryTab unwraps it.
  face['statWorkspace'] = vi.fn(async () => ({ ok: true as const, value: { ok: true as const, ...statAnswer } }))
  return bench
}

describe('the create form (F1-1)', () => {
  it('defaults the workspace to the session cwd, and the picker swaps it', async () => {
    const bench = benchWithPicker(async () => '/home/user/别的库')
    render(<StoryTab {...bench.props} />)
    await screen.findByText('本会话还没有 focus 作品：选一部，或新建一部')
    fireEvent.click(screen.getByRole('button', { name: '新建作品' }))
    // Default = the session's cwd (bench: /home/user/workspace) — the picker button is there.
    const input = await screen.findByLabelText('挂载工作区（正文放这里）')
    expect((input as HTMLSelectElement | HTMLInputElement).value).toBe('/home/user/workspace')
    fireEvent.click(screen.getByText('更换…'))
    await waitFor(() => {
      expect((screen.getByLabelText('挂载工作区（正文放这里）') as HTMLInputElement).value).toBe('/home/user/别的库')
    })
    // A cross-workspace pick warns (正向陈述).
    await screen.findByText(/正文读写依赖会话沙箱/)
  })

  it('without a picker the text input stays, and a bad path refuses with the validator', async () => {
    const bench = benchWithPicker(null, { exists: false, directory: false })
    render(<StoryTab {...bench.props} />)
    await screen.findByText('本会话还没有 focus 作品：选一部，或新建一部')
    fireEvent.click(screen.getByRole('button', { name: '新建作品' }))
    await screen.findByLabelText('挂载工作区（正文放这里）')
    expect(screen.queryByText('更换…')).toBeNull()
    fireEvent.change(screen.getByPlaceholderText('作品名（也会是正文目录名）'), { target: { value: '时间典当行' } })
    fireEvent.change(screen.getByLabelText('挂载工作区（正文放这里）'), { target: { value: '/nope' } })
    fireEvent.click(screen.getByText('建立并 focus'))
    await screen.findByText('这个路径不存在或不是目录')
    expect(bench.mocks.createWork).not.toHaveBeenCalled()
  })
})
