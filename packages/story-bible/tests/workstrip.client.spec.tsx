// @vitest-environment jsdom
/**
 * The work strip's own gestures: the inline create form (title + the
 * registered-workspace picker) and the focus echo after a create.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FragmentsTab } from '../src/client/FragmentsTab.tsx'
import { makeStoryBench } from './bench.tsx'

afterEach(() => { cleanup() })

describe('WorkStrip — creating a work', () => {
  it('creates through the inline form and focuses the new work', async () => {
    const { props, mocks } = makeStoryBench({ focusId: null })
    render(<FragmentsTab {...props} />)
    await screen.findByText('本会话还没有 focus 作品：选一部，或新建一部')
    fireEvent.click(screen.getByRole('button', { name: '新建作品' }))
    fireEvent.change(await screen.findByPlaceholderText('作品名（也会是正文目录名）'), { target: { value: '时间典当行' } })
    fireEvent.click(screen.getByText('建立并 focus'))
    await waitFor(() => {
      expect(mocks.createWork).toHaveBeenCalledWith('s1', { title: '时间典当行', workspace: '/home/user/workspace' })
    })
    await screen.findByText('已建立并 focus《时间典当行》')
    // The strip now echoes the new focus; the views read the empty work.
    await screen.findByText(/墙还是空的/)
  })

  it('refuses a blank title without calling the verb', async () => {
    const { props, mocks } = makeStoryBench({ focusId: null })
    render(<FragmentsTab {...props} />)
    fireEvent.click(await screen.findByRole('button', { name: '新建作品' }))
    fireEvent.click(screen.getByText('建立并 focus'))
    await screen.findByText('给它起个名字')
    expect(mocks.createWork).not.toHaveBeenCalled()
  })
})
