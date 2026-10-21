// @vitest-environment jsdom
/**
 * The family's shared「可用模型」section (ModelListSection): the ordered rows
 * with the default chip on the first, the empty-list fallback hint, per-row
 * delete and drag-to-reorder persisting through the list face, and the add
 * dialog over the endpoint's served catalog (pre-checked added rows, search,
 * the confirm append). Reads fire only while the section is active; a
 * missing list face hides the editor.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { LocalAgentModelDirectory } from '@khorsheed/dsh-local-agent/types'
import { ModelListSection } from '../src/client/ModelListSection.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

const t = makeTranslate(zh)

const directory: LocalAgentModelDirectory = {
  entries: [
    { value: 'claude-opus-5-5', label: 'Claude Opus 5.5', source: 'native' },
    { value: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', source: 'native' },
    { value: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', source: 'native' },
  ],
  complete: true,
  customInput: true,
  status: 'ready',
  refreshing: false,
  revision: 1,
}

/** A reactive modelList face over a mutable ordered list. */
function modelListFace(initial: readonly string[]) {
  let list = [...initial]
  return {
    read: vi.fn(async () => list),
    write: vi.fn(async (next: readonly string[]) => {
      list = [...next]
      return list
    }),
  }
}

function directoryFace() {
  return vi.fn(async () => directory)
}

/** Render the section active over the given faces and flush the mount reads. */
async function renderSection(options: {
  modelList?: ReturnType<typeof modelListFace>
  modelDirectory?: ReturnType<typeof directoryFace>
  active?: boolean
}): Promise<void> {
  render(
    <ModelListSection
      active={options.active ?? true}
      modelList={options.modelList}
      modelDirectory={options.modelDirectory}
      t={t}
    />,
  )
  await act(async () => {})
}

describe('ModelListSection', () => {
  it('renders the rows in order with the default chip on the first; empty shows the fallback hint', async () => {
    await renderSection({ modelList: modelListFace(['claude-opus-5-5', 'claude-haiku-5-5']), modelDirectory: directoryFace() })

    const rows = document.body.querySelectorAll('[draggable="true"]')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.textContent).toContain('claude-opus-5-5')
    expect(rows[0]?.textContent).toContain(zh['models.defaultChip'])
    expect(rows[1]?.textContent).not.toContain(zh['models.defaultChip'])
    expect(document.body.textContent).not.toContain(zh['models.empty'])
  })

  it('shows the fallback hint instead of rows when the list is empty', async () => {
    await renderSection({ modelList: modelListFace([]), modelDirectory: directoryFace() })
    expect(screen.getByText(zh['models.empty'])).toBeTruthy()
  })

  it('deletes a row and persists the shortened list', async () => {
    const modelList = modelListFace(['claude-opus-5-5', 'claude-haiku-5-5'])
    await renderSection({ modelList, modelDirectory: directoryFace() })

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: `${zh['models.delete']}: claude-haiku-5-5` })) })
    expect(modelList.write).toHaveBeenCalledWith(['claude-opus-5-5'])
    expect(screen.getByText(zh['models.applied'])).toBeTruthy()
  })

  it('drag & drop reorders and persists the new order', async () => {
    const modelList = modelListFace(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'])
    await renderSection({ modelList, modelDirectory: directoryFace() })

    const rows = document.body.querySelectorAll('[draggable="true"]')
    fireEvent.dragStart(rows[2]!)
    fireEvent.dragOver(rows[0]!)
    fireEvent.drop(rows[0]!)
    await act(async () => {})
    expect(modelList.write).toHaveBeenCalledWith(['claude-haiku-5-5', 'claude-opus-5-5', 'claude-sonnet-5-5'])
  })

  it('the add dialog checks endpoint-served models and appends the selected', async () => {
    const modelList = modelListFace(['claude-opus-5-5'])
    await renderSection({ modelList, modelDirectory: directoryFace() })

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh['models.add'] })) })
    // The already-added model is pre-checked and disabled; the others are selectable.
    const boxes = document.body.querySelectorAll('input[type="checkbox"]') as NodeListOf<HTMLInputElement>
    expect(boxes).toHaveLength(3)
    expect(boxes[0]!.disabled).toBe(true)
    expect(boxes[0]!.checked).toBe(true)
    fireEvent.click(boxes[2]!)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh['models.dialog.confirm'] })) })
    expect(modelList.write).toHaveBeenCalledWith(['claude-opus-5-5', 'claude-haiku-5-5'])
  })

  it('the dialog search filters the candidates', async () => {
    await renderSection({ modelList: modelListFace([]), modelDirectory: directoryFace() })

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh['models.add'] })) })
    fireEvent.change(screen.getByLabelText(zh['models.dialog.search']), { target: { value: 'haiku' } })
    const boxes = document.body.querySelectorAll('input[type="checkbox"]')
    expect(boxes).toHaveLength(1)
    expect(document.body.textContent).toContain('claude-haiku-5-5')
    expect(document.body.textContent).not.toContain('claude-sonnet-5-5')
  })

  it('hides the editor when the face is absent (an older core)', async () => {
    await renderSection({})
    expect(document.body.querySelector('[draggable="true"]')).toBeNull()
    expect(screen.queryByRole('button', { name: zh['models.add'] })).toBeNull()
  })

  it('reads nothing while inactive, and re-reads the catalog when the refresh token moves', async () => {
    const modelList = modelListFace(['claude-opus-5-5'])
    const modelDirectory = directoryFace()
    const { rerender } = render(
      <ModelListSection active={false} modelList={modelList} modelDirectory={modelDirectory} directoryRefresh={0} t={t} />,
    )
    await act(async () => {})
    expect(modelList.read).not.toHaveBeenCalled()
    expect(modelDirectory).not.toHaveBeenCalled()

    rerender(<ModelListSection active modelList={modelList} modelDirectory={modelDirectory} directoryRefresh={0} t={t} />)
    await act(async () => {})
    expect(modelList.read).toHaveBeenCalledTimes(1)
    expect(modelDirectory).toHaveBeenCalledTimes(1)

    rerender(<ModelListSection active modelList={modelList} modelDirectory={modelDirectory} directoryRefresh={1} t={t} />)
    await act(async () => {})
    expect(modelDirectory).toHaveBeenCalledTimes(2)
    // The list itself does not re-read on a catalog refresh.
    expect(modelList.read).toHaveBeenCalledTimes(1)
  })
})
