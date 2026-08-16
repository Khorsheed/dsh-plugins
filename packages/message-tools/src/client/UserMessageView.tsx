/**
 * Shadow user-message renderer (priority -1): replaces the official user
 * bubble to add edit/withdraw actions. Uses only official ui-primitives
 * components (RiskConfirmation, Button, MessageText, writeClipboard, icons)
 * and theme tokens, so visual language matches dsh and dark/light adapts.
 */
import { useState, type ReactNode } from 'react'
import {
  Button, IconCheckOutline16, IconEditOutline16, IconTrashOutline16,
  MessageText, RiskConfirmation, Tooltip, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'

/** Effective user message this view renders. */
export interface ViewMessage {
  /** Original session seq. */
  seq: number
  /** Current visible text (resolved by projection). */
  text: string
  /** True when withdrawn (render divider placeholder). */
  withdrawn: boolean
}

/** File-impact summary for the withdraw confirmation. */
export interface WithdrawImpact {
  /** e.g. "lib/config.js  +28行". */
  lines: string[]
}

/** Props: message data + actions. */
export interface UserMessageViewProps {
  message: ViewMessage
  /** Save an edit: append user/message/edited and start a new turn. */
  onEdit: (seq: number, newText: string) => void
  /** Withdraw: append user/message/withdrawn. */
  onWithdraw: (seq: number) => void
  /** File-impact summary shown in the withdraw confirm. */
  withdrawImpact?: WithdrawImpact | undefined
}

/** Copy button (official writeClipboard + icons). */
function CopyButton({ text }: { text: string }): ReactNode {
  const [copied, setCopied] = useState(false)
  return (
    <Tooltip label={copied ? '已复制' : '复制'}>
      <button
        type="button"
        aria-label="copy"
        onClick={() => { void writeClipboard(text).then((ok) => { if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1500) } }) }}
      >
        <IconCheckOutline16 />
      </button>
    </Tooltip>
  )
}

/** Inline edit box: textarea (auto-height, max 240px) + model selector + actions. */
function InlineEditor({ initial, onSave, onCancel }: {
  initial: string
  onSave: (text: string) => void
  onCancel: () => void
}): ReactNode {
  const [text, setText] = useState(initial)
  return (
    <div data-message-tools-editor className="mt-editor-box">
      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value) }}
        rows={Math.min(6, Math.max(2, text.split('\n').length))}
        aria-label="edit message"
      />
      <div className="mt-editor-toolbar">
        <span className="mt-model-chip">DeepSeek-V4-Flash · High ▾</span>
        <span>
          <Button variant="outline" onClick={onCancel}>取消</Button>
          <Button variant="primary" disabled={text.trim() === ''} onClick={() => { onSave(text) }}>重新发送</Button>
        </span>
      </div>
    </div>
  )
}

/** Withdraw confirmation via official RiskConfirmation. */
function WithdrawConfirm({ impact, onConfirm, onCancel }: {
  impact: WithdrawImpact | undefined
  onConfirm: () => void
  onCancel: () => void
}): ReactNode {
  const description = impact === undefined
    ? '撤回这条消息及其引发的文件改动。'
    : `以下操作将被撤回：\n${impact.lines.map((l) => `- ${l}`).join('\n')}`
  return (
    <RiskConfirmation
      open
      title="撤回这条消息？"
      description={description}
      cancelLabel="取消"
      confirmLabel="确认撤回"
      acknowledgeLabel="确认撤回影响"
      acknowledged
      onCancel={onCancel}
      onConfirm={onConfirm}
      onAcknowledgedChange={() => {}}
    />
  )
}

/** Withdrawn divider: label centered in a full-width line. */
function WithdrawnDivider(): ReactNode {
  return (
    <div className="mt-withdrawn-zone">
      <span className="mt-withdrawn-label">已撤回 1 条消息</span>
    </div>
  )
}

/**
 * The shadow user-message view: bubble + hover-revealed actions
 * (copy/edit/withdraw), inline editor, official withdraw modal.
 */
export function UserMessageView(props: UserMessageViewProps): ReactNode {
  const { message, onEdit, onWithdraw, withdrawImpact } = props
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)

  if (message.withdrawn) return <WithdrawnDivider />

  if (editing) {
    return (
      <InlineEditor
        initial={message.text}
        onSave={(text) => { onEdit(message.seq, text); setEditing(false) }}
        onCancel={() => { setEditing(false) }}
      />
    )
  }

  return (
    <div className="mt-user-message" data-message-tools-user-message>
      <div className="mt-bubble">
        <MessageText text={message.text} />
      </div>
      <div className="mt-actions">
        <CopyButton text={message.text} />
        <Tooltip label="编辑">
          <button type="button" aria-label="edit" onClick={() => { setEditing(true) }}>
            <IconEditOutline16 />
          </button>
        </Tooltip>
        <Tooltip label="撤回">
          <button type="button" aria-label="withdraw" onClick={() => { setConfirming(true) }}>
            <IconTrashOutline16 />
          </button>
        </Tooltip>
      </div>
      {confirming && (
        <WithdrawConfirm
          impact={withdrawImpact}
          onConfirm={() => { onWithdraw(message.seq); setConfirming(false) }}
          onCancel={() => { setConfirming(false) }}
        />
      )}
    </div>
  )
}
