/**
 * TeX rendering for the pane: $…$ / $$…$$ segments in coach-authored text
 * (quiz prompts, options, explanations, station notes) render as MathML —
 * browser-native, so no KaTeX fonts or CSS need bundling.
 *
 * @module @khorsheed/dsh-library/client/math
 */
import { Fragment, useMemo, type ReactNode } from 'react'
import katex from 'katex'
import css from './LibraryPane.module.css'

/** One TeX segment, rendered to MathML; falls back to the source text. */
export function Tex({ tex, block }: { tex: string; block?: boolean }): ReactNode {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, { output: 'mathml', throwOnError: false, displayMode: block === true })
    } catch {
      return undefined
    }
  }, [tex, block])
  if (html === undefined) return <code>{tex}</code>
  return <span className={block === true ? css.mathBlock : undefined} dangerouslySetInnerHTML={{ __html: html }} />
}

/** Text with its $…$ / $$…$$ segments rendered; everything else plain. */
export function MathText({ text }: { text: string }): ReactNode {
  const parts = useMemo(() => splitMath(text), [text])
  return (
    <>
      {parts.map((part, at) => part.tex === undefined
        ? <Fragment key={at}>{part.text}</Fragment>
        : <Tex key={at} tex={part.tex} {...(part.block === undefined ? {} : { block: part.block })} />)}
    </>
  )
}

/** Split text into plain runs and $…$ (inline) / $$…$$ (block) TeX segments. */
export function splitMath(text: string): readonly { text?: string; tex?: string; block?: boolean }[] {
  const parts: { text?: string; tex?: string; block?: boolean }[] = []
  const pattern = /\$\$([\s\S]+?)\$\$|\$([^$\n]+)\$/g
  let at = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index > at) parts.push({ text: text.slice(at, match.index) })
    parts.push({ tex: match[1] ?? match[2] ?? '', block: match[1] !== undefined })
    at = match.index + match[0].length
  }
  if (at < text.length) parts.push({ text: text.slice(at) })
  return parts
}
