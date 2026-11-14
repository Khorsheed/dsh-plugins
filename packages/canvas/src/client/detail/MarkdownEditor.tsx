import type { ClipboardEvent as ReactClipboardEvent, ReactNode } from 'react'
import { Button, type MarkdownLabels, type MarkdownPathImages } from '@deepseek-ai/dsh-client-ui-primitives'
import { CardTextarea } from '../space/CardTextarea.tsx'
import { CardMarkdown } from './CardMarkdown.tsx'
import css from './CanvasDetailView.module.css'

/** One raw-markdown editing layout, with optional live preview and explicit actions. */
export function MarkdownEditor({
  text, submitOn, hint, markdownLabels, pathImages, onSave, onTextChange, onPaste, onCancel,
  placeholder, autoFocus = false, blurSubmits = true, preview = false, previewText, previewClassName, actions,
}: {
  readonly text: string
  readonly submitOn: 'mod-enter' | 'auto-enter'
  readonly hint: string
  readonly markdownLabels: MarkdownLabels
  readonly pathImages?: MarkdownPathImages | undefined
  readonly onSave: (text: string) => void
  readonly onTextChange?: ((text: string) => void) | undefined
  readonly onPaste?: ((event: ReactClipboardEvent<HTMLTextAreaElement>) => void) | undefined
  readonly onCancel?: (() => void) | undefined
  readonly placeholder?: string | undefined
  readonly autoFocus?: boolean
  readonly blurSubmits?: boolean
  readonly preview?: boolean
  readonly previewText?: string | undefined
  readonly previewClassName?: string | undefined
  readonly actions?: { readonly cancelLabel: string; readonly saveLabel: string; readonly onCancel?: (() => void) | undefined } | undefined
}): ReactNode {
  return (
    <div className={css.body} data-mode={preview ? 'split' : 'source'}>
      <div className={css.sourcePane}>
        <CardTextarea
          className={css.editor}
          defaultValue={text}
          {...(placeholder === undefined ? {} : { placeholder })}
          submitOn={submitOn}
          blurSubmits={blurSubmits}
          autoFocus={autoFocus}
          {...(onTextChange === undefined ? {} : { onTextChange })}
          {...(onPaste === undefined ? {} : { onPaste })}
          onSubmit={onSave}
          {...(onCancel === undefined ? {} : { onCancel })}
        />
        <div className={css.editorFooter}>
          <span className={css.editHint}>{hint}</span>
          {actions !== undefined && (
            <>
              <span className={css.spacer} />
              <Button size="sm" onClick={actions.onCancel ?? onCancel}>{actions.cancelLabel}</Button>
              <Button size="sm" variant="primary" onClick={() => { onSave(text) }}>{actions.saveLabel}</Button>
            </>
          )}
        </div>
      </div>
      {preview && (
        <div className={previewClassName === undefined ? css.renderPane : `${css.renderPane} ${previewClassName}`}>
          <CardMarkdown text={previewText ?? text} labels={markdownLabels} pathImages={pathImages} />
        </div>
      )}
    </div>
  )
}
