/**
 * The type page (card types, P1a): one category's brief, its adopted
 * definition, and the Agent's pending proposal — the one place a kind of card
 * is designed.
 *
 * The flow the proposal settled on reads top to bottom. The user says what
 * they want in the brief — the card editor's own block flow, so a paragraph,
 * a sketch and a pasted picture all fit — and 「交给 Agent 设计」 quotes the
 * request into the conversation input without sending it. The Agent reads the
 * brief (drawings arrive as pictures when its model sees images) and files a
 * proposal; the page shows it the way it would land — a card face filled with
 * the proposal's example, then the field table — with 采用 / 不采用 right
 * under it. Adopting makes the definition live; the definition below is what
 * every card of the kind is written against now.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import {
  useCallback, useEffect, useMemo, useRef, useState,
  type ClipboardEvent as ReactClipboardEvent, type ReactNode,
} from 'react'
import { Button, Tag, Toast, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { cardNameOf } from '../../card-format.ts'
import { typedTitleOf, type TypeDefinition } from '../../card-types.ts'
import { imageMarkdownOf } from '../../image-token.ts'
import { hasDrawings, type BoardMutationResult, type CanvasBoard, type CanvasError } from '../../types.ts'
import type { CanvasTypeViewProps } from '../contract.ts'
import { categoryLabelMap } from '../category-label.ts'
import { canvasErrorText } from '../error-text.ts'
import { base64Of, imageFilesOf, type CanvasImageFile } from '../images.ts'
import { messageOf } from '../text.ts'
import { BlockEditor } from '../detail/BlockEditor.tsx'
import { CardFlow } from '../detail/CanvasDetailView.tsx'
import { DetailCrumbs } from '../detail/DetailCrumbs.tsx'
import { IconEditOutlineMedium, IconSparkleMedium } from '../icons.tsx'
import type {} from '../locales.ts'
import { FieldTable, TypedFace } from './fields.tsx'
import detailCss from '../detail/CanvasDetailView.module.css'
import css from './TypeView.module.css'

/** How many cards of the kind the page lists (the board has the rest). */
const MAX_SAMPLES = 12

/** The type page. */
export function TypeView(props: CanvasTypeViewProps): ReactNode {
  const {
    t, sessionId, canvasId, kind, crumbs, pathImages, useSelection,
    readBoard, setTypeBrief, decideType, openCardDetail, talkAvailable, quoteToConversation, attachImage,
  } = props
  const boardRev = useSelection(current => current.rev)
  const [open, setOpen] = useState<{ board: CanvasBoard; version: string } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [toast, setToast] = useState<{ text: string; seq: number } | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  const toastSeqRef = useRef(0)

  const showToast = useCallback((text: string) => {
    toastSeqRef.current += 1
    setToast({ text, seq: toastSeqRef.current })
  }, [])

  const errorText = useCallback((error: CanvasError): string => canvasErrorText(t, error), [t])

  const run = useCallback(async <T,>(call: () => Promise<RemoteResult<T>>): Promise<T | null> => {
    try {
      const result = await call()
      if (result.ok) return result.value
      setFatal(result.error.message)
      return null
    } catch (error) {
      setFatal(messageOf(error))
      return null
    }
  }, [])

  // The whole type rides its category row, so the board read is the
  // freshness channel: the Agent's proposal lands through the tab's poll.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const value = await run(() => readBoard({ canvasId }))
      if (cancelled || value === null) return
      if (!value.ok) {
        setOpen(null)
        setLoadError(errorText(value.error))
        return
      }
      setLoadError(null)
      setOpen(current => current !== null && current.version === value.version
        ? current
        : { board: value.board, version: value.version })
    })()
    return () => { cancelled = true }
  }, [canvasId, boardRev, readBoard, run, errorText])

  /** Apply one board mutation's answer in place; false when it was refused. */
  const landed = useCallback((value: BoardMutationResult | null, toastKey?: Parameters<typeof t>[0]): boolean => {
    if (value === null) return false
    if (!value.ok) {
      showToast(errorText(value.error))
      return false
    }
    setOpen({ board: value.board, version: value.version })
    if (toastKey !== undefined) showToast(t(toastKey))
    return true
  }, [showToast, errorText, t])

  /** The brief's pictures go to the attachment store, like a card's (§10.3). */
  const uploadImages = useCallback(async (files: readonly CanvasImageFile[]): Promise<string[]> => {
    const lines: string[] = []
    for (const { file, mediaType } of files) {
      const outcome = await run(async () => attachImage({ data: await base64Of(file), mediaType, name: file.name }))
      if (outcome === null) return lines
      if (outcome.ok) lines.push(imageMarkdownOf(outcome.ref, file.name))
    }
    showToast(t(lines.length === files.length ? 'paste.image' : 'paste.imageUnavailable'))
    return lines
  }, [attachImage, run, showToast, t])

  const onPaste = useCallback((event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const files = imageFilesOf(event.clipboardData?.files)
    if (files.length === 0) return
    event.preventDefault()
    const element = event.currentTarget
    const from = element.selectionStart ?? element.value.length
    const to = element.selectionEnd ?? from
    void uploadImages(files).then(lines => {
      if (lines.length === 0) return
      element.setRangeText(lines.join('\n'), from, to, 'end')
      element.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }, [uploadImages])

  const markdownLabels = useMemo<MarkdownLabels>(() => ({
    code: { copyLabel: t('markdown.copy'), copiedLabel: t('markdown.copied') },
    footnotes: t('markdown.footnotes'),
  }), [t])

  const labels = useMemo(() => categoryLabelMap(open?.board.categories ?? [], t), [open?.board.categories, t])

  /* -------------------------------------------------------------- rendering */

  const category = open?.board.categories.find(row => row.id === kind)
  const notice = (text: string): ReactNode => (
    <div className={detailCss.root}>
      <div className={detailCss.header}>
        <DetailCrumbs t={t} crumbs={crumbs} here={crumbs.heading} cardId={null} />
      </div>
      <div className={detailCss.notice}>{text}</div>
    </div>
  )
  if (loadError !== null) return notice(loadError)
  if (open === null) return notice(t('state.loading'))
  if (category === undefined) return notice(t('type.gone'))

  const board = open.board
  const readonly = sessionId === undefined || board.archivedAt !== null
  const canTalk = sessionId !== undefined && !readonly && talkAvailable(sessionId)
  const label = labels.get(kind) ?? kind
  const labelOf = (id: string): string => labels.get(id) ?? id
  const definition = category.definition
  const proposal = category.proposal
  const cards = board.cards.filter(card => card.kind === kind && card.status !== 'archived')
  const nameOf = (cardId: string): string | undefined => {
    const card = board.cards.find(row => row.id === cardId)
    if (card === undefined) return undefined
    const def = board.categories.find(row => row.id === card.kind)?.definition
    return typedTitleOf(def, card.fields) || cardNameOf(card) || card.id
  }
  const brief = category.brief ?? ''
  const briefDrawings = category.briefDrawings ?? {}
  const hasBrief = brief.trim() !== '' || hasDrawings(briefDrawings)

  const askAgent = (): void => {
    if (sessionId === undefined) return
    const block = t('type.quote', { canvas: board.title, label, kind })
    showToast(quoteToConversation(sessionId, block) ? t('talk.quoted') : t('talk.unavailable'))
  }

  const decide = (decision: 'adopt' | 'reject'): void => {
    if (sessionId === undefined) return
    void run(() => decideType(sessionId, { canvasId, kind, decision })).then(value => {
      if (!landed(value, decision === 'adopt' ? 'type.adopted' : 'type.rejected')) return
      // Rejecting an Agent-started category with no cards deletes it: nothing
      // is left to design here, so the row goes back to the board.
      if (value !== null && value.ok && !value.board.categories.some(row => row.id === kind)) crumbs.onBack()
    })
  }

  const definitionBlock = (def: TypeDefinition): ReactNode => (
    <>
      <FieldTable t={t} definition={def} labelOf={labelOf} />
      {def.guide !== undefined && (
        <p className={css.guide}><span className={css.guideLabel}>{t('type.guide')}</span>{def.guide}</p>
      )}
    </>
  )
  const layoutText = (def: TypeDefinition): string =>
    t('type.layoutLabel', { layout: t(`type.layout.${def.layout}` as const) })

  return (
    <div className={detailCss.root}>
      <div className={detailCss.header}>
        <DetailCrumbs t={t} crumbs={crumbs} here={label} cardId={null} />
        <div className={detailCss.title}>{label}</div>
        <div className={detailCss.meta}>
          {category.draft === true && <Tag tone="info">{t('type.draftTag')}</Tag>}
          {definition !== undefined && (
            <>
              <span className={css.version}>{t('type.version', { version: String(definition.version) })}</span>
              <span>{layoutText(definition)}</span>
            </>
          )}
          <span>{t('cat.count', { count: String(cards.length) })}</span>
          <span className={detailCss.spacer} />
          {canTalk && (
            <button type="button" className={`${detailCss.iconButton} ${css.primary}`} title={t('type.askAgentTip')} onClick={askAgent}>
              <IconSparkleMedium size={12} />
              {t('type.askAgent')}
            </button>
          )}
        </div>
      </div>

      <section className={css.section}>
        <div className={css.sectionHead}>
          <span className={css.step}>1</span>
          <span className={css.sectionTitle}>{t('type.briefTitle')}</span>
          <span className={detailCss.spacer} />
          {!editing && !readonly && (
            <button type="button" className={detailCss.iconButton} onClick={() => { setEditing(true) }}>
              <IconEditOutlineMedium size={12} />
              {hasBrief ? t('type.briefEdit') : t('type.briefWrite')}
            </button>
          )}
        </div>
        {editing ? (
          <div className={css.briefEditor}>
            <BlockEditor
              t={t}
              text={brief}
              drawings={briefDrawings}
              submitOn="mod-enter"
              placeholder={t('type.briefPlaceholder')}
              autoFocus
              hint={t('type.briefHint')}
              saveLabel={t('block.save')}
              markdownLabels={markdownLabels}
              pathImages={pathImages}
              notify={showToast}
              uploadImages={uploadImages}
              onPaste={onPaste}
              onSave={(text, drawings) => {
                setEditing(false)
                const trimmed = text.trim()
                if (trimmed === brief && JSON.stringify(drawings) === JSON.stringify(briefDrawings)) return
                if (sessionId === undefined) return
                void run(() => setTypeBrief(sessionId, { canvasId, kind, brief: trimmed, drawings }))
                  .then(value => landed(value, 'type.briefSaved'))
              }}
              onCancel={() => { setEditing(false) }}
            />
          </div>
        ) : hasBrief ? (
          <div className={css.brief}>
            <CardFlow t={t} text={brief} drawings={briefDrawings} labels={markdownLabels} pathImages={pathImages} />
          </div>
        ) : (
          <p className={css.none}>{t('type.briefEmpty')}</p>
        )}
      </section>

      <section className={css.section} data-pending={proposal !== undefined || undefined}>
        <div className={css.sectionHead}>
          <span className={css.step}>2</span>
          <span className={css.sectionTitle}>{t('type.proposalTitle')}</span>
          {proposal !== undefined && (
            <>
              <Tag tone="warning">{t('type.pending')}</Tag>
              <span className={css.version}>{t('type.proposalVersion', { version: String(proposal.definition.version) })}</span>
              <span className={css.meta}>{layoutText(proposal.definition)}</span>
            </>
          )}
        </div>
        {proposal === undefined ? (
          <p className={css.none}>{t('type.proposalNone')}</p>
        ) : (
          <>
            <div className={css.previewRow}>
              <div className={css.preview}>
                <span className={css.previewLabel}>{t('type.preview')}</span>
                <div className={css.previewCard}>
                  <TypedFace
                    t={t}
                    definition={proposal.definition}
                    values={proposal.definition.example}
                    nameOf={nameOf}
                    fallbackTitle={label}
                  />
                </div>
              </div>
              {proposal.rationale !== '' && (
                <p className={css.rationale}>
                  <span className={css.guideLabel}>{t('type.rationale')}</span>
                  {proposal.rationale}
                </p>
              )}
            </div>
            {proposal.renames !== undefined && Object.keys(proposal.renames).length > 0 && (
              <p className={css.meta}>
                {t('type.renames', {
                  list: Object.entries(proposal.renames).map(([from, to]) => `${from} → ${to}`).join('，'),
                })}
              </p>
            )}
            {definitionBlock(proposal.definition)}
            {!readonly && (
              <div className={css.decide}>
                <Button size="sm" variant="primary" onClick={() => { decide('adopt') }}>{t('type.adopt')}</Button>
                <Button size="sm" onClick={() => { decide('reject') }}>{t('type.reject')}</Button>
              </div>
            )}
          </>
        )}
      </section>

      <section className={css.section}>
        <div className={css.sectionHead}>
          <span className={css.step}>3</span>
          <span className={css.sectionTitle}>{t('type.definitionTitle')}</span>
        </div>
        {definition === undefined
          ? <p className={css.none}>{t('type.definitionNone')}</p>
          : definitionBlock(definition)}
      </section>

      {cards.length > 0 && (
        <section className={css.section}>
          <div className={css.sectionHead}>
            <span className={css.sectionTitle}>{t('type.samples', { count: String(cards.length) })}</span>
          </div>
          <div className={css.samples}>
            {cards.slice(0, MAX_SAMPLES).map(card => {
              const name = nameOf(card.id) ?? card.id
              return (
                <button
                  key={card.id}
                  type="button"
                  className={css.sample}
                  onClick={() => { openCardDetail(canvasId, card.id, name) }}
                >
                  {definition !== undefined && definition.layout !== 'note' ? (
                    <TypedFace t={t} definition={definition} values={card.fields} nameOf={nameOf} fallbackTitle={name} />
                  ) : (
                    <span className={css.sampleName}>{name}</span>
                  )}
                </button>
              )
            })}
          </div>
        </section>
      )}

      {toast !== null && <Toast key={toast.seq} text={toast.text} onDone={() => { setToast(null) }} />}
      {fatal !== null && <div className={detailCss.fatal} onClick={() => { setFatal(null) }}>{fatal}</div>}
    </div>
  )
}
