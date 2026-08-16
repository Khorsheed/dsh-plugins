/**
 * Restored-assistant line ('message-tools-restored-assistant' keyed
 * renderer): one withdrawn assistant reply's text replayed at the
 * conversation tail by a restore. The body renders through the official
 * `MarkdownText` (the same public renderer behind ui-conversation's
 * AssistantMarkdown), so typography, code blocks, and lists match a native
 * assistant reply; the「已恢复 · 助手回复」caption stays as a small tertiary
 * marker. The model-facing frame text is not displayed (stripped in the
 * Definition). No action row: the group's user bubbles already carry copy.
 */
import type { ReactNode } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconUndoOutline16 } from './icons.tsx'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls this plugin's ChatNodeDataMap merge.
import type {} from './withdrawn-node.ts'
import css from './RestoredMessageView.module.css'

/** Full props of the restored-assistant renderer. */
export type RestoredMessageViewProps =
  PropsRuntime<'conversation.chat.node', 'message-tools-restored-assistant'>
  & PropsLocale<'message-tools'>

/** The restored assistant line: caption plus the reply body in official markdown chrome. */
export function RestoredMessageView({ node, t }: RestoredMessageViewProps): ReactNode {
  const data = node.data
  return (
    <div className={css.restoredAssistantRow}>
      <div className={css.restoredLabel}>
        <IconUndoOutline16 />
        <span>{t('restored.assistant')}</span>
      </div>
      <MarkdownText text={data.text} />
    </div>
  )
}
