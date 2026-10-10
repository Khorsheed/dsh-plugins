/**
 * The art-style gallery (decision D10): the same little scene drawn in each
 * built-in style, so the choice is made by looking. Before a project exists
 * a pick puts 「美术风格选 X」 into the composer; inside a project it asks
 * for a restyle — everything is redrawn and the result always waits as a
 * candidate.
 */
import { useEffect, useRef, type ReactNode } from 'react'
import { ART_STYLES } from '../types.ts'
import type { ViewProps } from './contract.ts'
import { drawStyleSample } from './style-samples.ts'
import css from './GameTab.module.css'

/** One sample canvas. */
function Sample({ styleId }: { styleId: string }): ReactNode {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    const g = canvas?.getContext('2d')
    if (canvas && g) drawStyleSample(g, styleId, canvas.width, canvas.height)
  }, [styleId])
  return <canvas ref={ref} className={css.sample} width={200} height={112} aria-hidden="true" />
}

/** Props of the gallery. */
export interface StyleGalleryProps {
  readonly t: ViewProps['t']
  readonly current?: string | undefined
  readonly onPick: (styleId: string, label: string) => void
}

/** The gallery grid. */
export function StyleGallery({ t, current, onPick }: StyleGalleryProps): ReactNode {
  return <div className={css.gallery}>
    {ART_STYLES.map(style => <button key={style.id} type="button" className={css.styleCard} aria-pressed={current === style.id}
      onClick={() => { onPick(style.id, style.label) }}>
      <Sample styleId={style.id} />
      <span className={css.styleName}>{style.label}{current === style.id && <span className={css.badge}>{t('style.current')}</span>}</span>
      <span className={css.metaLine}>{style.look}</span>
      <span className={css.paletteStrip} aria-hidden="true">{style.palette.slice(0, 8).map(c => <span key={c} style={{ background: c }} />)}</span>
    </button>)}
  </div>
}
