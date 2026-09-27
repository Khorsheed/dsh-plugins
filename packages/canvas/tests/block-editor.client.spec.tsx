// @vitest-environment jsdom
/**
 * The block editor on its own: a card's flow opens as its blocks, a pasted
 * image splits the words at the caret, a paste without images goes to the
 * page's arm, removing a block joins the words around it, an inkless drawing
 * never reaches the card, every keystroke reaches the draft owner, the bar
 * sits on top of the flow, a dropped image lands in the gap the drop line
 * shows, and a picture opens large on a click.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { CanvasDetailProps } from '../src/client/contract.ts'
import { BlockEditor, type BlockEditorProps } from '../src/client/detail/BlockEditor.tsx'
import { zh } from '../src/client/locales.ts'
import type { CanvasStroke } from '../src/types.ts'

const t = ((key: keyof typeof zh, params?: Record<string, string>): string =>
  zh[key].replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] ?? match)) as CanvasDetailProps['t']

const INK: CanvasStroke[] = [{ pts: [{ x: 100, y: 100, w: 5 }, { x: 300, y: 200, w: 4 }], color: 'ink' }]

function mount(overrides: Partial<BlockEditorProps> = {}) {
  const props = {
    t,
    text: '',
    drawings: undefined,
    submitOn: 'mod-enter' as const,
    placeholder: '写点什么',
    hint: t('block.hint'),
    saveLabel: t('block.save'),
    markdownLabels: {} as BlockEditorProps['markdownLabels'],
    notify: vi.fn(),
    uploadImages: vi.fn(async () => ['![](attachment://abc.png)']),
    onPaste: vi.fn(),
    onChange: vi.fn(),
    onSave: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  }
  const view = render(<BlockEditor {...props} />)
  return { props, ...view }
}

function boxes(): HTMLTextAreaElement[] {
  return screen.getAllByRole('textbox') as HTMLTextAreaElement[]
}

function save(): void {
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
}

afterEach(cleanup)

describe('BlockEditor', () => {
  it('opens a card as its blocks and saves it back unchanged', () => {
    const text = '甲\n\n![](draw://d1)\n\n![图](attachment://x.png)\n\n乙'
    const { props, container } = mount({ text, drawings: { d1: INK } })
    expect(boxes().map(box => box.value)).toEqual(['甲', '乙'])
    const pads = Array.from(container.querySelectorAll('svg')).filter(svg => svg.getAttribute('viewBox') === '0 0 600 400')
    expect(pads).toHaveLength(1)
    expect(container.querySelector('figure')).not.toBeNull()
    save()
    expect(props.onSave).toHaveBeenCalledWith(text, { d1: INK })
  })

  it('places a pasted image at the caret, splitting the words around it', async () => {
    const { props } = mount({ text: '前后' })
    const box = boxes()[0]!
    box.setSelectionRange(1, 1)
    const file = new File(['x'], 'shot.png', { type: 'image/png' })
    fireEvent.paste(box, { clipboardData: { files: [file], types: ['Files'], getData: () => '' } })
    await waitFor(() => { expect(boxes().map(item => item.value)).toEqual(['前', '后']) })
    expect(props.uploadImages).toHaveBeenCalledTimes(1)
    expect(props.onPaste).not.toHaveBeenCalled()
    save()
    expect(props.onSave).toHaveBeenCalledWith('前\n\n![](attachment://abc.png)\n\n后', {})
  })

  it('hands a paste without images to the page', () => {
    const { props } = mount({ text: '字' })
    fireEvent.paste(boxes()[0]!, { clipboardData: { files: [], types: ['text/plain'], getData: () => '贴' } })
    expect(props.onPaste).toHaveBeenCalledTimes(1)
    expect(props.uploadImages).not.toHaveBeenCalled()
  })

  it('joins the words on either side of a removed drawing, and drops the drawing', () => {
    const { props } = mount({ text: '甲\n\n![](draw://d1)\n\n乙', drawings: { d1: INK } })
    fireEvent.click(screen.getByRole('button', { name: t('block.removeDraw') }))
    expect(boxes().map(box => box.value)).toEqual(['甲\n\n乙'])
    save()
    expect(props.onSave).toHaveBeenCalledWith('甲\n\n乙', {})
  })

  it('never stores a drawing that was added but not drawn on', () => {
    const { props } = mount({ text: '字' })
    fireEvent.click(screen.getByRole('button', { name: t('block.addDraw') }))
    save()
    expect(props.onSave).toHaveBeenCalledWith('字', {})
  })

  it('reports every keystroke to the draft owner', () => {
    const { props } = mount({ text: '' })
    fireEvent.input(boxes()[0]!, { target: { value: '新的想法' } })
    expect(props.onChange).toHaveBeenLastCalledWith('新的想法', {})
  })

  it('puts the bar above the flow, with the insert tools and 保存 in it', () => {
    mount({ text: '字' })
    const bar = screen.getByRole('toolbar', { name: '插入' })
    expect(bar.textContent).toContain('手绘')
    expect(bar.textContent).toContain('图片')
    const save = screen.getByRole('button', { name: '保存' })
    // Before the first text box in document order: the bar leads the sheet.
    expect(save.compareDocumentPosition(boxes()[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('drops an image into the gap the drop line shows', async () => {
    const { props, container } = mount({ text: '甲\n\n![](draw://d1)\n\n乙', drawings: { d1: INK } })
    const slots = [...container.querySelectorAll<HTMLElement>('[data-slot]')]
    expect(slots).toHaveLength(3)
    const rects = [[0, 40], [50, 100], [160, 40]] as const
    slots.forEach((slot, index) => {
      const [top, height] = rects[index]!
      slot.getBoundingClientRect = () => ({ top, height, bottom: top + height, left: 0, right: 100, width: 100, x: 0, y: top, toJSON: () => ({}) })
    })
    const flow = slots[0]!.parentElement!
    const file = new File(['x'], 'drop.png', { type: 'image/png' })
    const dataTransfer = { types: ['Files'], files: [file], dropEffect: 'none' }
    // jsdom's drag events carry no pointer: set the height by hand.
    const at = (event: Event): Event => Object.defineProperty(event, 'clientY', { value: 60 })
    // Above the drawing's middle: the gap before it.
    fireEvent(flow, at(createEvent.dragOver(flow, { dataTransfer })))
    expect(await screen.findByText('放到这里')).toBeTruthy()
    fireEvent(flow, at(createEvent.drop(flow, { dataTransfer })))
    await waitFor(() => { expect(container.querySelector('figure')).not.toBeNull() })
    expect(screen.queryByText('放到这里')).toBeNull()
    expect(props.onPaste).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(props.onSave).toHaveBeenCalledWith('甲\n\n![](attachment://abc.png)\n\n![](draw://d1)\n\n乙', { d1: INK })
  })

  it('says so when what was dropped holds no image', () => {
    const { props, container } = mount({ text: '字' })
    const flow = container.querySelector<HTMLElement>('[data-slot]')!.parentElement!
    const dataTransfer = { types: ['Files'], files: [new File(['x'], 'a.txt', { type: 'text/plain' })] }
    fireEvent.drop(flow, { clientY: 0, dataTransfer })
    expect(props.notify).toHaveBeenCalledWith('只能拖入图片')
    expect(props.uploadImages).not.toHaveBeenCalled()
  })

  it('opens a picture large on a click', async () => {
    const { container } = mount({
      text: '![图](attachment://x.png)',
      pathImages: { resolve: () => 'https://example.test/x.png' },
    })
    const image = container.querySelector('figure img')
    expect(image).not.toBeNull()
    fireEvent.click(image!)
    expect(await screen.findByRole('dialog', { name: '图片预览' })).toBeTruthy()
  })
})
