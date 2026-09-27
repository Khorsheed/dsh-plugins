/**
 * The card editor as a flow of blocks (step 6 of the 2026-09-27 redesign):
 * words, drawings and images interleave in the order the card reads, and each
 * is edited as what it is — a textarea, a pen pad, a picture — instead of one
 * markdown box with a single drawing pinned under it.
 *
 * The flow is still ONE markdown string on the way out (`blocks.ts` owns the
 * mapping): a drawing is a `![](draw://<id>)` line, an image its pointer line.
 * No editor library: each text block is the board family's CardTextarea
 * (uncontrolled, IME-safe), so the page keeps the invariants every other box
 * on it has. Blur never saves here — moving between blocks is not a commit.
 *
 * Where a new block lands is where the writer last was: the caret's text block
 * splits there, the new block goes between the halves, and the words after it
 * keep a box of their own. A pasted image does the same at the paste point;
 * everything else a paste can carry goes to the page's paste arm unchanged.
 * A dragged-in image lands in the gap between blocks the drop line shows.
 *
 * The editor is one sheet with its bar on top (2026-09-28 review: 手绘/图片
 * under a long card were out of sight). The bar sticks while the flow scrolls:
 * the insert tools on the left — one list, so a new block kind (a table) is
 * one more entry — and 取消/保存 on the right. A picture opens large on a click.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import {
  useCallback, useEffect, useRef, useState,
  type ChangeEvent, type ClipboardEvent as ReactClipboardEvent, type DragEvent as ReactDragEvent,
  type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode,
} from 'react'
import { Button, MarkdownText, type MarkdownLabels, type MarkdownPathImages } from '@deepseek-ai/dsh-client-ui-primitives'
import { blocksOf, cardBlocksOf, freshDrawingId, textOfBlocks, type CardBlock } from '../../blocks.ts'
import { MAX_CARD_DRAWINGS, type CanvasStroke } from '../../types.ts'
import type { CanvasDetailProps } from '../contract.ts'
import type { PadTool } from '../draw.ts'
import { IconCloseOutlineMedium, IconEditOutlineMedium } from '../icons.tsx'
import { IconImageOutline16 } from '../icons-local.tsx'
import { imageFilesOf, type CanvasImageFile } from '../images.ts'
import { CardTextarea } from '../space/CardTextarea.tsx'
import { CardPad } from './CardPad.tsx'
import { useImageLightbox } from './image-lightbox.tsx'
import css from './BlockEditor.module.css'

/** A drawings map as the editor holds it. */
export type CardDrawings = Readonly<Record<string, readonly CanvasStroke[]>>

/** One block of the flow, with the key its element keeps across edits. */
type Item =
  | { readonly key: string; readonly kind: 'text'; readonly initial: string }
  | { readonly key: string; readonly kind: 'draw'; readonly id: string }
  | { readonly key: string; readonly kind: 'image'; readonly line: string; readonly src: string }

/** One insert tool of the bar. A new block kind joins here and nowhere else in the bar. */
interface InsertTool {
  readonly id: string
  readonly label: string
  readonly icon: ReactNode
  readonly run: () => void
}

/** Where a drop would land: before the block with this key, or at the end (null). */
interface DropGap {
  readonly before: string | null
  /** The line's offset from the top of the flow, in pixels. */
  readonly y: number
}

/** What the editor needs from its page. */
export interface BlockEditorProps {
  readonly t: CanvasDetailProps['t']
  /** The text to start from (read once: the editor is uncontrolled). */
  readonly text: string
  /** The drawings to start from (read once, like the text). */
  readonly drawings: CardDrawings | undefined
  /** 'auto-enter' for a draft (⏎ files a one-liner), 'mod-enter' for a card. */
  readonly submitOn: 'mod-enter' | 'auto-enter'
  readonly placeholder: string
  readonly autoFocus?: boolean
  /** The chord line under the flow; the owner knows what saving means here. */
  readonly hint: string
  readonly saveLabel: string
  readonly markdownLabels: MarkdownLabels
  readonly pathImages?: MarkdownPathImages | undefined
  /** One line of news, in the page's toast. */
  readonly notify: (text: string) => void
  /** Send image files to the attachment store; resolves the markdown lines that landed. */
  readonly uploadImages: (files: readonly CanvasImageFile[]) => Promise<readonly string[]>
  /** The page's paste arm, for every paste that carries no image. */
  readonly onPaste: (event: ReactClipboardEvent<HTMLTextAreaElement>) => void
  /** Reports the flow after every change (the draft owner's copy). */
  readonly onChange?: ((text: string, drawings: CardDrawings) => void) | undefined
  readonly onSave: (text: string, drawings: CardDrawings) => void
  readonly onCancel: () => void
}

/** The editor. */
export function BlockEditor(props: BlockEditorProps): ReactNode {
  const {
    t, submitOn, placeholder, autoFocus, hint, saveLabel, markdownLabels, pathImages,
    notify, uploadImages, onPaste, onChange, onSave, onCancel,
  } = props
  const seqRef = useRef(0)
  const nextKey = (): string => {
    seqRef.current += 1
    return `b${seqRef.current}`
  }
  /** The live words of every text block (the textareas are uncontrolled). */
  const textsRef = useRef(new Map<string, string>())
  const textItem = (initial: string): Item => {
    const key = nextKey()
    textsRef.current.set(key, initial)
    return { key, kind: 'text', initial }
  }
  const itemOf = (block: CardBlock): Item => block.kind === 'text'
    ? textItem(block.text)
    : { ...block, key: nextKey() }

  const [items, setItems] = useState<readonly Item[]>(() => {
    const flow = cardBlocksOf(props.text, props.drawings, { images: true }).map(itemOf)
    // The words after the last picture need a box to go in.
    return flow.at(-1)?.kind === 'text' ? flow : [...flow, textItem('')]
  })
  /**
   * The flow as last committed. An upload resolves renders after it began, so
   * inserts read this, not the closure's `items`; and minting keys is a side
   * effect, so it never happens inside a state updater.
   */
  const itemsRef = useRef(items)
  const commit = (next: readonly Item[]): void => {
    itemsRef.current = next
    setItems(next)
  }
  const [drawings, setDrawings] = useState<CardDrawings>(() => ({ ...props.drawings }))
  /** Which pad holds the pen (one at a time), and which tool it holds. */
  const [pen, setPen] = useState<{ key: string; tool: PadTool } | null>(null)
  /** Where the writer last was: the text block and its selection. */
  const caretRef = useRef<{ key: string; from: number; to: number } | null>(null)
  /** The text block that takes the focus when it mounts (the words after an insert). */
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const flowRef = useRef<HTMLDivElement | null>(null)
  /** The drop line while images are dragged over the flow. */
  const [dropGap, setDropGap] = useState<DropGap | null>(null)
  const { onClick: openImage, lightbox } = useImageLightbox(t)

  /** The flow as the card will store it: inkless drawings drop, placed ones stay. */
  const snapshot = useCallback((): { text: string; drawings: CardDrawings } => {
    const kept: Record<string, readonly CanvasStroke[]> = {}
    const blocks: CardBlock[] = []
    for (const item of items) {
      if (item.kind === 'text') blocks.push({ kind: 'text', text: textsRef.current.get(item.key) ?? item.initial })
      else if (item.kind === 'image') blocks.push({ kind: 'image', line: item.line, src: item.src })
      else if ((drawings[item.id]?.length ?? 0) > 0) {
        kept[item.id] = drawings[item.id]!
        blocks.push({ kind: 'draw', id: item.id })
      }
    }
    return { text: textOfBlocks(blocks), drawings: kept }
  }, [items, drawings])

  // The owner re-renders on every report with a fresh callback; reading it
  // through a ref keeps a report from scheduling the next one.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const report = useCallback((): void => {
    const now = snapshot()
    onChangeRef.current?.(now.text, now.drawings)
  }, [snapshot])

  // Structure and ink changes report on their own; keystrokes report below.
  const reportedRef = useRef(false)
  useEffect(() => {
    if (!reportedRef.current) {
      reportedRef.current = true
      return
    }
    report()
  }, [report])

  const save = useCallback(() => {
    const now = snapshot()
    onSave(now.text, now.drawings)
  }, [snapshot, onSave])

  /**
   * Put blocks where the writer last was: split that text block at the caret
   * (or the selection, which the blocks replace), else add them at the end.
   */
  const insert = (blocks: readonly Item[], at?: { key: string; from: number; to: number }): void => {
    const aim = at ?? caretRef.current
    caretRef.current = null
    const current = itemsRef.current
    const index = aim === null ? -1 : current.findIndex(item => item.key === aim.key)
    if (aim === null || index < 0) {
      const last = current.at(-1)
      if (last?.kind === 'text' && (textsRef.current.get(last.key) ?? '').trim().length === 0) {
        commit([...current.slice(0, -1), ...blocks, last])
        return
      }
      const after = textItem('')
      setFocusKey(after.key)
      commit([...current, ...blocks, after])
      return
    }
    const target = current[index]!
    const value = textsRef.current.get(target.key) ?? ''
    const from = Math.min(aim.from, value.length)
    const to = Math.min(Math.max(aim.to, from), value.length)
    textsRef.current.delete(target.key)
    const before = value.slice(0, from).replace(/\s+$/, '')
    const after = textItem(value.slice(to).replace(/^\s*\n/, ''))
    setFocusKey(after.key)
    const head = before.length > 0 ? [textItem(before)] : []
    commit([...current.slice(0, index), ...head, ...blocks, after, ...current.slice(index + 1)])
  }

  /** Put blocks in the gap before the block `before` (the end when null or gone). */
  const insertAtGap = (blocks: readonly Item[], before: string | null): void => {
    const current = itemsRef.current
    const index = before === null ? -1 : current.findIndex(item => item.key === before)
    if (index < 0) {
      // The end is the words after the last block: the drop goes above an
      // empty tail box, as the bar's insert does.
      insert(blocks, undefined)
      return
    }
    caretRef.current = null
    commit([...current.slice(0, index), ...blocks, ...current.slice(index)])
  }

  /** Take one block out; the words on either side become one box again. */
  const remove = (key: string): void => {
    const current = itemsRef.current
    const index = current.findIndex(item => item.key === key)
    if (index < 0) return
    const gone = current[index]!
    if (gone.kind === 'draw') {
      setDrawings(held => {
        const next = { ...held }
        delete next[gone.id]
        return next
      })
    }
    setPen(held => (held?.key === key ? null : held))
    const before = current[index - 1]
    const after = current[index + 1]
    if (before?.kind !== 'text' || after?.kind !== 'text') {
      commit([...current.slice(0, index), ...current.slice(index + 1)])
      return
    }
    const words = [before, after]
      .map(item => textsRef.current.get(item.key) ?? '')
      .filter(value => value.trim().length > 0)
      .join('\n\n')
    textsRef.current.delete(before.key)
    textsRef.current.delete(after.key)
    commit([...current.slice(0, index - 1), textItem(words), ...current.slice(index + 2)])
  }

  const addDrawing = (): void => {
    const taken = new Set([...Object.keys(drawings), ...items.flatMap(item => (item.kind === 'draw' ? [item.id] : []))])
    if (taken.size >= MAX_CARD_DRAWINGS) {
      notify(t('block.drawFull', { count: String(MAX_CARD_DRAWINGS) }))
      return
    }
    const id = freshDrawingId(taken)
    const block: Item = { key: nextKey(), kind: 'draw', id }
    setDrawings(held => ({ ...held, [id]: [] }))
    insert([block])
    // A new drawing is for drawing: the pen comes up with it.
    setPen({ key: block.key, tool: 'pen' })
  }

  /** Upload, then place each image that landed as its own block. */
  const placeImages = async (
    files: readonly CanvasImageFile[],
    at?: { key: string; from: number; to: number } | { gap: string | null },
  ): Promise<void> => {
    const lines = await uploadImages(files)
    const blocks = lines.flatMap(line => blocksOf(line, { images: true }).map(itemOf))
    if (blocks.length === 0) return
    if (at !== undefined && 'gap' in at) insertAtGap(blocks, at.gap)
    else insert(blocks, at)
  }

  /** The gap nearest the pointer: above a block's middle is before it. */
  const gapAt = (clientY: number): DropGap | null => {
    const flow = flowRef.current
    if (flow === null) return null
    const top = flow.getBoundingClientRect().top
    const slots = [...flow.querySelectorAll<HTMLElement>(':scope > [data-slot]')]
    for (const slot of slots) {
      const rect = slot.getBoundingClientRect()
      if (clientY < rect.top + rect.height / 2) {
        return { before: slot.dataset['slot'] ?? null, y: rect.top - top - 5 }
      }
    }
    const last = slots.at(-1)?.getBoundingClientRect()
    return { before: null, y: last === undefined ? 0 : last.bottom - top + 5 }
  }

  const carriesFiles = (event: ReactDragEvent<HTMLElement>): boolean =>
    [...event.dataTransfer.types].includes('Files')

  const onDragOver = (event: ReactDragEvent<HTMLDivElement>): void => {
    if (!carriesFiles(event)) return
    // Claimed on the flow, so a drop on a text box is ours, never its path text.
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    const next = gapAt(event.clientY)
    setDropGap(held => (held?.before === next?.before && held?.y === next?.y ? held : next))
  }

  const onDragLeave = (event: ReactDragEvent<HTMLDivElement>): void => {
    const into = event.relatedTarget
    if (into instanceof Node && event.currentTarget.contains(into)) return
    setDropGap(null)
  }

  const onDrop = (event: ReactDragEvent<HTMLDivElement>): void => {
    if (!carriesFiles(event)) return
    event.preventDefault()
    const gap = dropGap ?? gapAt(event.clientY)
    setDropGap(null)
    const files = imageFilesOf(event.dataTransfer.files)
    if (files.length === 0) {
      notify(t('block.dropImagesOnly'))
      return
    }
    void placeImages(files, { gap: gap?.before ?? null })
  }

  const pasteInto = (key: string) => (event: ReactClipboardEvent<HTMLTextAreaElement>): void => {
    const clipboard = event.clipboardData
    const files = clipboard === null ? [] : imageFilesOf(clipboard.files)
    if (files.length === 0) {
      onPaste(event)
      return
    }
    // Taken over before the first await, or the browser inserts its own nothing.
    event.preventDefault()
    const element = event.currentTarget
    const from = element.selectionStart ?? element.value.length
    void placeImages(files, { key, from, to: element.selectionEnd ?? from })
  }

  const onPickFiles = (event: ChangeEvent<HTMLInputElement>): void => {
    const files = imageFilesOf(event.currentTarget.files ?? undefined)
    // The same file picked twice must still fire a change.
    event.currentTarget.value = ''
    if (files.length > 0) void placeImages(files)
  }

  // Leaving a text box is where its caret is remembered: the add buttons take
  // the focus, so by the time they run the box has already said where it was.
  const onBlurCapture = (event: ReactFocusEvent<HTMLDivElement>): void => {
    const target = event.target
    if (!(target instanceof HTMLTextAreaElement)) return
    const key = target.closest<HTMLElement>('[data-block]')?.dataset['block']
    if (key === undefined) return
    caretRef.current = { key, from: target.selectionStart, to: target.selectionEnd }
  }

  // ⌘⏎ and Esc from anywhere in the editor (a button, a picture), not only a
  // textarea — which handles its own and says so with preventDefault. Esc while
  // a pen is up belongs to the pad: it puts the pen down, never the edit.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.defaultPrevented) return
    if (event.key === 'Escape' && pen === null) {
      event.preventDefault()
      onCancel()
      return
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      save()
    }
  }

  const lastText = [...items].reverse().find(item => item.kind === 'text')?.key

  const tools: readonly InsertTool[] = [
    { id: 'draw', label: t('block.addDraw'), icon: <IconEditOutlineMedium size={14} />, run: addDrawing },
    {
      id: 'image', label: t('block.addImage'), icon: <IconImageOutline16 size={14} />,
      run: () => { fileRef.current?.click() },
    },
  ]

  return (
    <>
      <div className={css.editor} onBlurCapture={onBlurCapture} onKeyDown={onKeyDown}>
        <div className={css.bar}>
          <span className={css.tools} role="toolbar" aria-label={t('block.insert')}>
            {tools.map(tool => (
              <button
                key={tool.id}
                type="button"
                className={css.tool}
                onClick={tool.run}
              >
                {tool.icon}
                {tool.label}
              </button>
            ))}
            <input
              ref={fileRef}
              className={css.file}
              type="file"
              accept="image/*"
              multiple
              tabIndex={-1}
              aria-hidden="true"
              onChange={onPickFiles}
            />
          </span>
          <span className={css.hint}>{hint}</span>
          <span className={css.actions}>
            <Button size="sm" variant="ghost" onClick={onCancel}>{t('block.cancel')}</Button>
            <Button size="sm" variant="primary" onClick={save}>{saveLabel}</Button>
          </span>
        </div>
        <div
          ref={flowRef}
          className={css.flow}
          data-dropping={dropGap === null ? undefined : ''}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          {items.map((item, index) => {
            if (item.kind === 'text') {
              return (
                <div key={item.key} className={css.text} data-block={item.key} data-slot={item.key}>
                  <CardTextarea
                    className={css.words}
                    defaultValue={item.initial}
                    placeholder={index === 0 ? placeholder : item.key === lastText ? t('block.placeholder') : ''}
                    submitOn={submitOn}
                    blurSubmits={false}
                    autoFocus={item.key === focusKey || (autoFocus === true && index === 0)}
                    onPaste={pasteInto(item.key)}
                    onTextChange={value => {
                      textsRef.current.set(item.key, value)
                      report()
                    }}
                    onSubmit={save}
                    onCancel={onCancel}
                  />
                </div>
              )
            }
            if (item.kind === 'image') {
              return (
                <figure key={item.key} className={css.image} data-slot={item.key} onClick={openImage}>
                  <MarkdownText text={item.line} labels={markdownLabels} pathImages={pathImages} />
                  <button
                    type="button"
                    className={css.remove}
                    aria-label={t('block.removeImage')}
                    title={t('block.removeImage')}
                    onClick={() => { remove(item.key) }}
                  >
                    <IconCloseOutlineMedium size={12} />
                  </button>
                </figure>
              )
            }
            return (
              <div key={item.key} className={css.draw} data-slot={item.key}>
                <CardPad
                  t={t}
                  strokes={drawings[item.id] ?? []}
                  tool={pen?.key === item.key ? pen.tool : 'text'}
                  onTool={next => { setPen(next === 'text' ? null : { key: item.key, tool: next }) }}
                  onStrokes={next => { setDrawings(held => ({ ...held, [item.id]: next })) }}
                  notify={notify}
                  editing
                  onSave={save}
                  onRemove={() => { remove(item.key) }}
                  removeLabel={t('block.removeDraw')}
                  saveHint={submitOn === 'mod-enter' ? t('block.drawHint') : undefined}
                />
              </div>
            )
          })}
          {dropGap !== null && (
            <div className={css.dropLine} style={{ top: dropGap.y }} aria-hidden="true">
              <span>{t('block.dropHere')}</span>
            </div>
          )}
        </div>
      </div>
      {/* Outside the editor's key handler: Esc in the lightbox closes the
          picture, never the edit. */}
      {lightbox}
    </>
  )
}
