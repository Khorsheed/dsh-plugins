/**
 * A markdown document, read-only, in the official reading experience (T74).
 *
 * The same scheme as the datasets tab's preview (packages/datasets
 * `preview.tsx`): the official `MarkdownText` pipeline — the chat's own
 * renderer — inside the block chrome the official code and diff blocks use.
 * Cross-plugin imports are forbidden (each plugin installs alone), so this is
 * that file's markdown half re-assembled from the same official parts, not an
 * import of it; there is no self-rolled parser and no third-party library.
 * The analysis drafts (report block ⑤) read through it, and so will the
 * answer view's submitted reports (T75): one component, one look.
 */

import { MarkdownText, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { LabViewProps } from './contract.ts'
import css from './LabView.module.css'

/** The MarkdownText chrome copy, over the lab's own namespace. */
function markdownLabels(t: LabViewProps['t']): MarkdownLabels {
  return {
    code: { copyLabel: t('markdown.copy'), copiedLabel: t('markdown.copied') },
    footnotes: t('markdown.footnotes'),
  }
}

/**
 * One markdown text, rendered.
 * @param props - the text, the banner word (a file name, never a path), and the locale seat.
 */
export function MarkdownDoc(props: { text: string; banner?: string; t: LabViewProps['t'] }) {
  const { text, banner, t } = props
  return (
    <div className={css.markdownDoc}>
      <div className={css.markdownBanner}>
        <span className={css.markdownInfo}>{banner ?? 'markdown'}</span>
      </div>
      <div className={css.markdownBody}>
        <MarkdownText text={text} labels={markdownLabels(t)} />
      </div>
    </div>
  )
}
