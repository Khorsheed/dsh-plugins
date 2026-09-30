// @vitest-environment jsdom
/**
 * A typed card's fields on screen (card types, P1a): the face the board draws,
 * the card page's field list, and its field form — which writes the fields
 * WHOLE, so a value the definition dropped rides along, a required field left
 * empty keeps the form open, and a reference never points at its own card.
 * The strip's type row is here too: it survives a reload like a card row.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { CanvasDetailProps } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'
import { CanvasSelectionStore, boardTabId } from '../src/client/space/selection.ts'
import { FieldForm, FieldList, TypedFace, type RefCandidate } from '../src/client/type/fields.tsx'
import type { TypeDefinition } from '../src/card-types.ts'

const t = ((key: keyof typeof zh, params?: Record<string, string>): string =>
  zh[key].replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] ?? match)) as CanvasDetailProps['t']

const PERSON: TypeDefinition = {
  version: 2,
  layout: 'profile',
  fields: [
    { key: 'name', label: '姓名', type: 'line', hint: '全名', required: true },
    { key: 'role', label: '身份', type: 'select', options: ['主角', '配角'], hint: '在故事里的位置', face: true },
    { key: 'traits', label: '性格', type: 'tags', hint: '三五个词', face: true },
    { key: 'age', label: '年龄', type: 'number', hint: '岁' },
    { key: 'allies', label: '盟友', type: 'ref', refKind: 'cat_person', hint: '站在一边的人' },
  ],
  example: { name: '林澈', role: '主角', traits: ['倔', '心软'] },
}

const CANDIDATES: RefCandidate[] = [
  { id: 'c_self', name: '林澈', kind: 'cat_person' },
  { id: 'c_su', name: '苏晚', kind: 'cat_person' },
  { id: 'c_city', name: '北城', kind: 'cat_place' },
]

const names: Record<string, string> = { c_su: '苏晚', c_self: '林澈' }
const nameOf = (id: string): string | undefined => names[id]

afterEach(() => {
  cleanup()
  sessionStorage.clear()
})

describe('TypedFace', () => {
  it('leads with the title field and lists only the filled face fields', () => {
    const { container } = render(
      <TypedFace t={t} definition={PERSON} values={{ name: '林澈', traits: ['倔', '心软'] }} nameOf={nameOf} fallbackTitle="卡" />,
    )
    expect(container.textContent).toContain('林澈')
    expect(container.textContent).toContain('倔')
    expect(container.textContent).not.toContain('身份')
  })

  it('falls back to the card name when the title field is empty', () => {
    const { container } = render(<TypedFace t={t} definition={PERSON} values={{}} nameOf={nameOf} fallbackTitle="无名卡" />)
    expect(container.textContent).toContain('无名卡')
  })
})

describe('FieldList', () => {
  it('opens a referenced card, marks a gone one, and keeps dropped values visible', () => {
    const onOpenRef = vi.fn()
    const { container } = render(
      <FieldList
        t={t}
        definition={PERSON}
        values={{ name: '林澈', allies: ['c_su', 'c_gone'], mood: '低落' }}
        nameOf={nameOf}
        onOpenRef={onOpenRef}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '苏晚' }))
    expect(onOpenRef).toHaveBeenCalledWith('c_su', '苏晚')
    const gone = screen.getByRole('button', { name: new RegExp(`c_gone${zh['field.refGone']}`) }) as HTMLButtonElement
    expect(gone.disabled).toBe(true)
    expect(container.querySelector('details')?.textContent).toContain('低落')
  })
})

describe('FieldForm', () => {
  function mount(values: Record<string, unknown> | undefined) {
    const onSave = vi.fn()
    const onCancel = vi.fn()
    render(
      <FieldForm
        t={t}
        definition={PERSON}
        values={values as never}
        candidates={CANDIDATES}
        selfId="c_self"
        onSave={onSave}
        onCancel={onCancel}
      />,
    )
    return { onSave, onCancel }
  }
  const field = (label: string): HTMLInputElement => screen.getByLabelText(new RegExp(label)) as HTMLInputElement
  const save = (): void => { fireEvent.click(screen.getByRole('button', { name: zh['field.save'] })) }

  it('stores tags split on any separator, numbers as numbers, and carries dropped values', () => {
    const { onSave } = mount({ name: '林澈', mood: '低落' })
    fireEvent.change(field('性格'), { target: { value: '倔，心软、倔; 话少' } })
    fireEvent.change(field('年龄'), { target: { value: '17' } })
    fireEvent.change(field('身份'), { target: { value: '主角' } })
    save()
    expect(onSave).toHaveBeenCalledWith({ mood: '低落', name: '林澈', role: '主角', traits: ['倔', '心软', '话少'], age: 17 })
  })

  it('keeps the form open while a required field is empty', () => {
    const { onSave } = mount({})
    save()
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('姓名')
  })

  it('offers only cards of the ref kind, never the card itself, and removes a chosen one', () => {
    const { onSave } = mount({ name: '林澈', allies: ['c_su'] })
    const selects = Array.from(document.querySelectorAll('select'))
    const refAdd = selects.find(select => select.textContent?.includes(zh['field.addRef']))
    // 苏晚 is chosen already, 林澈 is this card, 北城 is a place: nothing is left to add.
    expect(refAdd).toBeUndefined()
    fireEvent.click(screen.getByRole('button', { name: t('field.removeRef', { name: '苏晚' }) }))
    save()
    expect(onSave).toHaveBeenCalledWith({ name: '林澈' })
  })
})

describe('CanvasSelectionStore — the type row', () => {
  it('opens a category type page inside its canvas row and brings it back after a reload', () => {
    const store = new CanvasSelectionStore()
    store.openTypeTab('canvas_t1abcdefgh', 'cat_person', '人物')
    const restored = new CanvasSelectionStore().source.getSnapshot()
    expect(restored.tabs.map(row => row.id)).toEqual([boardTabId('canvas_t1abcdefgh')])
    expect(restored.tabs[0]?.at).toEqual({ kind: 'type', catKind: 'cat_person', heading: '人物' })
  })
})
