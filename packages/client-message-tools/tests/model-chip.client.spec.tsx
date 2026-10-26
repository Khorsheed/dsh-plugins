// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import { ModelChip, type ModelChipProps } from '../src/client/ModelChip.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const t: ModelChipProps['t'] = makeTranslate(zh)

const TRIGGER = { name: /切换模型/ }

/** Ready directory: current route is deepseek-chat on effort 高, with one reasoning and one plain alternative. */
function state(over: Partial<ModelDirectoryState> = {}): ModelDirectoryState {
  return {
    current: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' },
    routable: true,
    groups: [
      {
        id: 'deepseek', name: 'DeepSeek',
        models: [
          {
            id: 'deepseek-chat', name: 'DeepSeek Chat',
            reasoning: { efforts: [{ id: 'low', name: '低' }, { id: 'high', name: '高' }], defaultEffort: 'low' },
          },
          {
            id: 'deepseek-reasoner', name: 'DeepSeek Reasoner',
            reasoning: { efforts: [{ id: 'max', name: 'Max' }], defaultEffort: 'max' },
          },
        ],
      },
      { id: 'openai', name: 'OpenAI', models: [{ id: 'gpt-5', name: 'GPT-5' }] },
    ],
    failures: [],
    status: 'ready',
    error: null,
    ...over,
  }
}

function props(over: {
  state?: ModelDirectoryState
  /** Mutable directory box; flip `box.current` plus rerender to move the directory mid-test. */
  box?: { current: ModelDirectoryState }
  loadModels?: () => void
  selectModel?: (selection: ModelSelection) => Promise<boolean>
} = {}): ModelChipProps {
  const box = over.box ?? { current: over.state ?? state() }
  return {
    useModelDirectory: (select: (snapshot: ModelDirectoryState) => unknown) => select(box.current),
    loadModels: over.loadModels ?? vi.fn(),
    selectModel: over.selectModel ?? vi.fn(async () => true),
    t,
  } as unknown as ModelChipProps
}

function openMenu(): void {
  fireEvent.click(screen.getByRole('button', TRIGGER))
}

describe('ModelChip trigger', () => {
  it('shows the current model and its resolved effort name', () => {
    render(<ModelChip {...props()} />)
    const trigger = screen.getByRole('button', { name: '切换模型，当前 DeepSeek Chat' })
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(trigger.getAttribute('title')).toBe('DeepSeek Chat · 高')
    expect(within(trigger).getByText('高')).toBeTruthy()
  })

  it('omits the effort segment for a model without reasoning metadata', () => {
    render(<ModelChip {...props({ state: state({ current: { provider: 'openai', model: 'gpt-5' } }) })} />)
    const trigger = screen.getByRole('button', { name: '切换模型，当前 GPT-5' })
    expect(trigger.getAttribute('title')).toBe('GPT-5')
    expect(trigger.textContent).not.toContain('默认')
  })

  it('falls back to the loading label before the first load', () => {
    render(<ModelChip {...props({ state: state({ current: null, groups: [] }) })} />)
    expect(screen.getByRole('button', { name: '切换模型，当前 loading' })).toBeTruthy()
  })

  it('falls back to the raw model id when the route is missing from the catalog', () => {
    render(<ModelChip {...props({ state: state({ groups: [] }) })} />)
    expect(screen.getByRole('button', { name: '切换模型，当前 deepseek-chat' })).toBeTruthy()
  })

  it('resolves the effort from the model default when the selection carries none', () => {
    render(<ModelChip {...props({ state: state({ current: { provider: 'deepseek', model: 'deepseek-chat' } }) })} />)
    expect(screen.getByRole('button', { name: '切换模型，当前 DeepSeek Chat' }).getAttribute('title'))
      .toBe('DeepSeek Chat · 低')
  })

  it('shows an unadvertised effort id verbatim', () => {
    const current = { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'turbo' }
    render(<ModelChip {...props({ state: state({ current }) })} />)
    expect(screen.getByRole('button', { name: '切换模型，当前 DeepSeek Chat' }).getAttribute('title'))
      .toBe('DeepSeek Chat · turbo')
  })

  it('shows the provider-default label when neither selection nor model default an effort', () => {
    const flex: ModelDirectoryState = state({
      current: { provider: 'flex', model: 'flex-1' },
      groups: [{
        id: 'flex', name: 'Flex',
        models: [{ id: 'flex-1', name: 'Flex One', reasoning: { efforts: [{ id: 'a', name: 'A' }] } }],
      }],
    })
    render(<ModelChip {...props({ state: flex })} />)
    expect(screen.getByRole('button', { name: '切换模型，当前 Flex One' }).getAttribute('title'))
      .toBe('Flex One · 默认')
  })
})

describe('ModelChip menu lifecycle', () => {
  it('loads the directory on mount and again when the menu opens, not when it closes', () => {
    const loadModels = vi.fn()
    render(<ModelChip {...props({ loadModels })} />)
    expect(loadModels).toHaveBeenCalledTimes(1)
    openMenu()
    expect(loadModels).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('menu', { name: '模型与推理等级' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', TRIGGER))
    expect(loadModels).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('keeps the menu open on an inside pointer and closes it on an outside one', () => {
    render(<ModelChip {...props()} />)
    openMenu()
    fireEvent.mouseDown(screen.getByRole('menu'))
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes the menu on Escape and ignores other keys', () => {
    render(<ModelChip {...props()} />)
    openMenu()
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('shows the empty notice when the loaded directory has no groups', () => {
    render(<ModelChip {...props({ state: state({ current: null, groups: [] }) })} />)
    openMenu()
    expect(screen.getByText('暂无可用模型')).toBeTruthy()
  })
})

describe('ModelChip selection', () => {
  it('ignores re-selecting the current model and submits a full selection for another', async () => {
    const selectModel = vi.fn(async () => true)
    render(<ModelChip {...props({ selectModel })} />)
    openMenu()
    const current = screen.getByRole('menuitemradio', { name: 'DeepSeek Chat' })
    expect(current.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(current)
    expect(selectModel).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('menuitemradio', { name: 'GPT-5' }))
    expect(selectModel).toHaveBeenCalledWith({ provider: 'openai', model: 'gpt-5' })
    await act(async () => {})
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('includes the model default effort when switching to a reasoning model', () => {
    const selectModel = vi.fn(async () => true)
    render(<ModelChip {...props({ selectModel })} />)
    openMenu()
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'DeepSeek Reasoner' }))
    expect(selectModel).toHaveBeenCalledWith({ provider: 'deepseek', model: 'deepseek-reasoner', reasoningEffort: 'max' })
  })

  it('submits an effort change and ignores the already-active effort', () => {
    const selectModel = vi.fn(async () => true)
    render(<ModelChip {...props({ selectModel })} />)
    openMenu()
    const active = screen.getByRole('menuitemradio', { name: '高' })
    expect(active.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(active)
    expect(selectModel).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('menuitemradio', { name: '低' }))
    expect(selectModel).toHaveBeenCalledWith({ provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'low' })
  })

  it('offers a provider-default effort row that clears the selected effort', () => {
    const flex: ModelDirectoryState = state({
      current: { provider: 'flex', model: 'flex-1', reasoningEffort: 'a' },
      groups: [{
        id: 'flex', name: 'Flex',
        models: [{ id: 'flex-1', name: 'Flex One', reasoning: { efforts: [{ id: 'a', name: 'A' }] } }],
      }],
    })
    const selectModel = vi.fn(async () => true)
    render(<ModelChip {...props({ state: flex, selectModel })} />)
    openMenu()
    const providerDefault = screen.getByRole('menuitemradio', { name: '默认' })
    expect(providerDefault.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(providerDefault)
    expect(selectModel).toHaveBeenCalledWith({ provider: 'flex', model: 'flex-1' })
  })

  it('checks the provider-default row and ignores re-selecting it when no effort is selected', () => {
    const flex: ModelDirectoryState = state({
      current: { provider: 'flex', model: 'flex-1' },
      groups: [{
        id: 'flex', name: 'Flex',
        models: [{ id: 'flex-1', name: 'Flex One', reasoning: { efforts: [{ id: 'a', name: 'A' }] } }],
      }],
    })
    const selectModel = vi.fn(async () => true)
    render(<ModelChip {...props({ state: flex, selectModel })} />)
    openMenu()
    const providerDefault = screen.getByRole('menuitemradio', { name: '默认' })
    expect(providerDefault.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(providerDefault)
    expect(selectModel).not.toHaveBeenCalled()
  })

  it('surfaces the failure hint when the host rejects the selection', async () => {
    const selectModel = vi.fn(async () => false)
    render(<ModelChip {...props({ selectModel })} />)
    openMenu()
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'GPT-5' }))
    expect((await screen.findByRole('status')).textContent).toBe('模型切换失败')
  })
})

describe('ModelChip busy', () => {
  it('disables the trigger and menu actions while a selection is in flight', () => {
    const selectModel = vi.fn(async () => true)
    const box = { current: state() }
    const view = render(<ModelChip {...props({ box, selectModel })} />)
    openMenu()
    // The directory flips to selecting while the menu is open (a submit landed on another seat).
    box.current = state({ status: 'selecting' })
    view.rerender(<ModelChip {...props({ box, selectModel })} />)
    expect(screen.getByRole<HTMLButtonElement>('button', TRIGGER).disabled).toBe(true)
    const other = screen.getByRole('menuitemradio', { name: 'GPT-5' }) as HTMLButtonElement
    const effort = screen.getByRole('menuitemradio', { name: '低' }) as HTMLButtonElement
    expect(other.disabled).toBe(true)
    expect(effort.disabled).toBe(true)
    // jsdom suppresses click dispatch on disabled controls, so no selection is submitted.
    fireEvent.click(other)
    fireEvent.click(effort)
    expect(selectModel).not.toHaveBeenCalled()
  })
})
