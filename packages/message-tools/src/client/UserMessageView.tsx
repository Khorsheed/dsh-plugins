/**
 * Shadow user-message renderer (keys 'user' and 'steering', priority -1; also
 * the plugin's own 'message-tools-edited' and 'message-tools-restored' rows):
 * a visual clone of the official bubble chrome — ui-conversation ships no
 * public components, so the structure is replicated against ui-primitives
 * platform modules, with historical images rendered through the owner-prop
 * `renderMessageImages` attachment slot (rc8 contract) — plus the
 * copy/edit/withdraw action row and the「已编辑」/「已恢复」labels. User
 * messages inside a withdrawn span render nothing; the withdrawal divider
 * marks the spot.
 */
import { memo, useEffect, useRef, useState, type ReactNode } from 'react'
import { shallowEqual } from '@deepseek-ai/dsh-client-store'
import type { UserMessageNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import {
  Button, IconCheckOutline16, IconCopyOutline16, IconEditOutline16,
  JsonBlock, RiskConfirmation, Tooltip, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { IconUndoOutline16 } from './icons.tsx'
import { foldHiddenRanges, isSeqHidden } from './withdrawn-node.ts'
import { chatHookOf, type ChatSlice } from './chat-hook.ts'
import { withdrawAndBackfill } from './withdraw-backfill.ts'
import { ModelChip, type ModelChipProps } from './ModelChip.tsx'
import type { UserMessageViewProps } from './slots.ts'
import css from './UserMessageView.module.css'

type Translate = UserMessageViewProps['t']
type UserImage = Extract<UserMessageNode['content'][number], { type: 'image' }>

/** Selector identity kept module-level so uSES memoization holds. */
function selectHiddenRanges(chat: ChatSlice): number[] {
  return foldHiddenRanges(chat.nodes.values())
}

/** Split user content into joined text, images, and leftover blocks. */
function contentParts(content: readonly unknown[]): {
  text: string
  images: { attachment: UserImage['attachment'] }[]
  rest: unknown[]
} {
  const texts: string[] = []
  const images: { attachment: UserImage['attachment'] }[] = []
  const rest: unknown[] = []
  for (const block of content) {
    const b = block as { type?: string; text?: string; attachment?: unknown }
    if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text)
    else if (b.type === 'image' && b.attachment !== undefined) {
      images.push({ attachment: (b as UserImage).attachment })
    } else rest.push(block)
  }
  return { text: texts.join(''), images, rest }
}

/** Plaintext `/name` and `@name` word-boundary tokens decorate as chips; the logged text stays the truth. */
function projectUserText(text: string): ReactNode {
  const re = /(^|\s)([/@][\w-]+)(?=\s|$)/g
  const parts: ReactNode[] = []
  let cursor = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    /* v8 ignore next -- the `(^|\s)` group always participates in a match, so m[1] is never undefined. */
    const tokenStart = m.index + (m[1]?.length ?? 0)
    /* v8 ignore next -- the token group always participates in a match, so m[2] is never undefined. */
    const label = m[2] ?? ''
    // Plain runs render through the local text-run block (the official
    // `MessageText` primitive was retired in host 0.1.5; `.textRun` keeps its
    // exact metrics).
    if (tokenStart > cursor) parts.push(<div key={cursor} className={css.textRun}>{text.slice(cursor, tokenStart)}</div>)
    parts.push(
      <span key={tokenStart} className={css.refChip} data-ref-chip={label.startsWith('@') ? 'subagent' : 'skill'}>
        {label}
      </span>,
    )
    cursor = tokenStart + label.length
  }
  if (parts.length === 0) return <div className={css.textRun}>{text}</div>
  if (cursor < text.length) parts.push(<div key={cursor} className={css.textRun}>{text.slice(cursor)}</div>)
  return <>{parts}</>
}

/** Copy action: the copy icon swaps to a short-lived check after a successful write. */
function CopyButton({ text, t }: { text: string; t: Translate }): ReactNode {
  const [copied, setCopied] = useState(false)
  const pending = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const epoch = useRef(0)
  useEffect(() => () => {
    epoch.current += 1
    pending.current = false
    if (timer.current !== null) clearTimeout(timer.current)
  }, [])
  const onCopy = (): void => {
    if (copied || pending.current) return
    const current = ++epoch.current
    pending.current = true
    void writeClipboard(text).then((ok) => {
      if (current !== epoch.current) return
      pending.current = false
      if (!ok) return
      setCopied(true)
      timer.current = setTimeout(() => {
        timer.current = null
        setCopied(false)
      }, 1000)
    })
  }
  return (
    <Tooltip label={copied ? t('copied') : t('copy')} side="bottom">
      <button type="button" className={css.action} aria-label={copied ? t('copied') : t('copy')} onClick={onCopy}>
        {copied ? <IconCheckOutline16 /> : <IconCopyOutline16 />}
      </button>
    </Tooltip>
  )
}

/** Cap for the auto-grown edit box height; longer text scrolls inside it. */
const EDITOR_MAX_HEIGHT = 240

/**
 * Inline editor (MessageEditBox structure): the textarea is backfilled with
 * the true original text and auto-grows to its content, capped so a long
 * message scrolls inside instead of pushing the row's anchor. The trailing
 * seat renders the real model chip when the session's model directory is
 * available; its margin-right: auto container keeps the buttons
 * right-aligned either way.
 */
function InlineEditor({ initial, busy, t, onSave, onCancel, models }: {
  initial: string
  busy: boolean
  t: Translate
  onSave: (text: string) => void
  onCancel: () => void
  /** Model-chip wiring; undefined when ui-model-selection is not composed. */
  models: ModelChipProps | undefined
}): ReactNode {
  const [draft, setDraft] = useState(initial)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const autoGrow = (): void => {
    const el = inputRef.current
    /* v8 ignore next -- the textarea ref is attached before the mount/change effects run. */
    if (el === null) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, EDITOR_MAX_HEIGHT)}px`
  }
  // Grow once on mount (the backfilled text may exceed the default height)
  // and on every edit; the cap keeps the box bounded.
  useEffect(autoGrow, [])
  const save = (): void => {
    /* v8 ignore next -- the save button is disabled while the draft is blank, and jsdom drops clicks on disabled controls. */
    if (draft.trim() === '') return
    onSave(draft)
  }
  return (
    <div className={css.editor} data-message-tools-edit-box>
      <textarea
        ref={inputRef}
        className={css.editorInput}
        value={draft}
        aria-label={t('editor.aria')}
        placeholder={t('editor.placeholder')}
        disabled={busy}
        rows={1}
        onChange={(event) => {
          setDraft(event.currentTarget.value)
          autoGrow()
        }}
      />
      <div className={css.editorActions}>
        <div className={css.editorTrailing}>{models !== undefined && <ModelChip {...models} />}</div>
        <Button variant="outline" disabled={busy} onClick={onCancel}>{t('cancel')}</Button>
        <Button variant="primary" disabled={busy || draft.trim() === ''} onClick={save}>
          {t('editor.save')}
        </Button>
      </div>
    </div>
  )
}

/** The shadowed user-message view: bubble plus copy/edit/withdraw actions. */
export const UserMessageView = memo(function UserMessageView({
  node, renderMessageImages, t, editMessage, withdrawMessage, backfillDraft,
  useModelDirectory, modelsAvailable, loadModels, selectModel,
  ...standard
}: UserMessageViewProps): ReactNode {
  // Chat data lives in the `useChat` session standard prop on host 0.1.2
  // (the helper degrades to the frozen empty snapshot without it).
  const ranges = chatHookOf(standard as Pick<UserMessageViewProps, 'useChat'>)(selectHiddenRanges, shallowEqual)
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<'edit' | 'withdraw' | null>(null)
  const data = node.data
  if (isSeqHidden(ranges, data.seq)) return null

  const { text, images, rest } = contentParts(data.content)
  const truncated = (total: number): string => t('json.truncated', { total })
  const showBubble = text !== '' || rest.length > 0

  const saveEdit = (newText: string): void => {
    setBusy(true)
    setFailed(null)
    void editMessage(data.seq, newText)
      .then(() => { setEditing(false) })
      .catch(() => { setFailed('edit') })
      .finally(() => { setBusy(false) })
  }
  const confirmWithdraw = (): void => {
    setBusy(true)
    setFailed(null)
    // A landed withdrawal auto-backfills the target's original text into the
    // composer draft (never sends); a failed one backfills nothing.
    void withdrawAndBackfill({ withdraw: () => withdrawMessage(data.seq), backfill: backfillDraft }, text)
      .catch(() => { setFailed('withdraw') })
      .finally(() => {
        setBusy(false)
        setConfirming(false)
        setAcknowledged(false)
      })
  }

  if (editing) {
    return (
      <div className={css.userRow}>
        <div className={css.userStack}>
          <InlineEditor
            initial={text}
            busy={busy}
            t={t}
            onSave={saveEdit}
            onCancel={() => { setEditing(false) }}
            models={modelsAvailable
              ? { useModelDirectory, loadModels, selectModel, t }
              : undefined}
          />
          {failed === 'edit' && <div className={css.actionError} role="status">{t('error.edit')}</div>}
        </div>
      </div>
    )
  }

  return (
    <div className={css.userRow} data-time-hover-root>
      <div className={css.userStack}>
        {node.kind === 'message-tools-edited' && (
          <div className={css.editedLabel}>{t('edited.badge')}</div>
        )}
        {node.kind === 'message-tools-restored' && (
          <div className={css.editedLabel}>{t('withdrawn.restored')}</div>
        )}
        {images.length > 0 ? renderMessageImages({ images, align: 'end' }) : null}
        {showBubble && (
          <div className={css.bubble}>
            {projectUserText(text)}
            {rest.map((block, index) => (
              <JsonBlock key={index} label={t('message.extraBlock')} payload={block} truncatedLabel={truncated} />
            ))}
          </div>
        )}
      </div>
      <div className={css.actions}>
        <CopyButton text={text} t={t} />
        <Tooltip label={t('edit')} side="bottom">
          <button
            type="button"
            className={css.action}
            aria-label={t('edit')}
            onClick={() => { setFailed(null); setEditing(true) }}
          >
            <IconEditOutline16 />
          </button>
        </Tooltip>
        <Tooltip label={t('action.withdraw')} side="bottom">
          <button
            type="button"
            className={css.action}
            aria-label={t('action.withdraw')}
            onClick={() => { setFailed(null); setAcknowledged(false); setConfirming(true) }}
          >
            <IconUndoOutline16 />
          </button>
        </Tooltip>
      </div>
      {failed === 'withdraw' && <div className={css.actionError} role="status">{t('error.withdraw')}</div>}
      {confirming && (
        <RiskConfirmation
          open
          title={t('withdraw.title')}
          description={t('withdraw.description')}
          acknowledgeLabel={t('withdraw.acknowledge')}
          cancelLabel={t('cancel')}
          closeLabel={t('close')}
          confirmLabel={t('withdraw.confirm')}
          acknowledged={acknowledged}
          disabled={busy}
          onAcknowledgedChange={setAcknowledged}
          onCancel={() => { setConfirming(false); setAcknowledged(false) }}
          onConfirm={confirmWithdraw}
        />
      )}
    </div>
  )
})
