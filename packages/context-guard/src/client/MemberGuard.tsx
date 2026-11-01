/**
 * The compaction reminder for an external-CLI member (a local-agent family
 * session), registered through `localAgentUi.registerMemberTool` when that
 * family is installed. local-agent supplies the occupancy and the compact
 * action; this decides WHEN the button shows, by the member's own ratio, else
 * its CLI's, else the global one:
 * - `composer` / `row`: 「⚠ 压缩」 past the ratio (「压缩中…」 while it runs);
 * - `dot`: an orange mark past the ratio (the room's members chip);
 * - `panel`: 「此成员的提醒比例」 inside the occupancy ring's panel.
 *
 * The face is declared structurally here: this package never imports
 * local-agent, and without it nothing below ever renders.
 * @module @khorsheed/dsh-context-guard/client/member-guard
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { IconWarningOutlineMedium } from './icons.tsx'
import { memberThresholdOf, resolveConfig, type ContextGuardConfig, type MemberThreshold } from './config.ts'
import type { GuardScope } from './scope.ts'
import css from './CompactGuardButton.module.css'
import panelCss from './MemberGuard.module.css'

/** The member-tool face local-agent hands each registered tool (structural copy). */
export interface MemberToolFace {
  readonly childSessionId: string
  readonly memberName?: string | undefined
  readonly provider: string
  readonly harness?: string | undefined
  readonly harnessDisplayName?: string | undefined
  readonly usedTokens?: number | undefined
  readonly contextWindow?: number | undefined
  readonly ratio?: number | undefined
  readonly state: 'idle' | 'running' | 'compacting'
  readonly placement: 'composer' | 'row' | 'panel' | 'dot'
  compact(): Promise<void>
}

export interface MemberGuardProps extends PropsLocale<'context-guard'> {
  readonly face: MemberToolFace
  readonly scope: GuardScope
  /** The composition-time section, while no settings surface serves it. */
  readonly fallback: ContextGuardConfig
}

/** The live section, resolved (defaults, clamps) over the composition fallback. */
function useSection(scope: GuardScope, fallback: ContextGuardConfig): { config: ContextGuardConfig; writable: boolean } {
  const snapshot = useSyncExternalStore(scope.subscribe, scope.getSnapshot)
  if (snapshot.status !== 'ready' || snapshot.value === undefined) return { config: fallback, writable: false }
  return { config: resolveConfig(snapshot.value), writable: snapshot.writable }
}

/** One member's reminder at one placement. */
export function MemberGuard({ face, scope, fallback, t }: MemberGuardProps) {
  const { config, writable } = useSection(scope, fallback)
  const threshold = memberThresholdOf(config, face)
  const over = face.ratio !== undefined && face.ratio >= threshold.ratio
  if (face.placement === 'panel') return <MemberRatioField face={face} scope={scope} config={config} writable={writable} t={t} />
  if (face.placement === 'dot') {
    return over ? <span className={panelCss.dot} role="img" aria-label={t('member.dot', { name: face.memberName ?? face.harnessDisplayName ?? face.provider })} /> : null
  }
  if (face.state === 'compacting') {
    return <span className={`${css.button} ${css.warning}`} role="status">{t('member.compacting')}</span>
  }
  if (!over) return null
  return <CompactButton face={face} t={t} />
}

/** How long an accepted request may sit queued on an idle member before the button re-arms. */
const QUEUED_REARM_MS = 30_000

function CompactButton({ face, t }: Pick<MemberGuardProps, 'face' | 't'>) {
  const [busy, setBusy] = useState(false)
  // Accepted but not started: a room queues the compaction behind a running
  // round, and the member reads 「压缩中」 only once it starts. Stay disabled
  // until the member's state moves (the compaction starting unmounts this
  // button; a cancelled queue moves running → idle), so a second click never
  // queues a second compaction.
  const [queued, setQueued] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])
  useEffect(() => { setQueued(false) }, [face.state])
  useEffect(() => {
    if (!queued || face.state !== 'idle') return
    const timer = setTimeout(() => { setQueued(false) }, QUEUED_REARM_MS)
    return () => { clearTimeout(timer) }
  }, [queued, face.state])
  const run = (): void => {
    setBusy(true)
    setError(null)
    face.compact().then(() => {
      if (!alive.current) return
      setBusy(false)
      setQueued(true)
    }, (reason: unknown) => {
      if (!alive.current) return
      setBusy(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }
  return (
    <span className={css.wrap}>
      <button
        type="button"
        className={`${css.button} ${css.warning}`}
        aria-label={t('button.aria', { percent: String(Math.round((face.ratio ?? 0) * 100)) })}
        disabled={busy || queued}
        onClick={run}
      >
        <span className={css.icon} aria-hidden>
          <IconWarningOutlineMedium size={14} />
        </span>
        {t('button.label')}
      </button>
      {error !== null && (
        <span className={css.error} role="status" title={error}>
          {t('button.error')}
        </span>
      )}
    </span>
  )
}

/**
 * 「此成员的提醒比例」: empty = follow the CLI's (or the global) ratio. Writes
 * the whole `memberThresholds` table (the settings surface sets one field at
 * a time).
 */
function MemberRatioField({ face, scope, config, writable, t }: Pick<MemberGuardProps, 'face' | 'scope' | 't'> & { config: ContextGuardConfig; writable: boolean }) {
  const own = config.memberThresholds[face.childSessionId]
  const [text, setText] = useState(own === undefined ? '' : String(own.ratio))
  const [failed, setFailed] = useState(false)
  useEffect(() => { setText(own === undefined ? '' : String(own.ratio)) }, [own?.ratio])
  const harnessRatio = face.harness === undefined ? undefined : config.harnessThresholds[face.harness]
  const follow = harnessRatio ?? config.thresholdRatio
  const parsed = text.trim() === '' ? undefined : Number(text.trim())
  const invalid = parsed !== undefined && (!Number.isFinite(parsed) || parsed < 0.01 || parsed > 1)
  const dirty = (parsed ?? undefined) !== own?.ratio
  const save = (): void => {
    if (invalid || !writable) return
    const next: Record<string, MemberThreshold> = { ...config.memberThresholds }
    if (parsed === undefined) delete next[face.childSessionId]
    else {
      next[face.childSessionId] = {
        ratio: parsed,
        ...face.memberName === undefined ? {} : { name: face.memberName },
        ...face.harness === undefined ? {} : { harness: face.harness },
      }
    }
    setFailed(false)
    void scope.set('memberThresholds', next).catch(() => { setFailed(true) })
  }
  return (
    <div className={panelCss.panel}>
      <label className={panelCss.label}>
        <span>{t('member.ratio')}</span>
        <input
          className={invalid ? `${panelCss.input} ${panelCss.invalid}` : panelCss.input}
          type="number"
          step="0.05"
          min="0.01"
          max="1"
          value={text}
          disabled={!writable}
          placeholder={String(follow)}
          aria-label={t('member.ratio')}
          onChange={(event) => { setText(event.target.value) }}
          onKeyDown={(event) => { if (event.key === 'Enter') save() }}
        />
        <button type="button" className={panelCss.save} disabled={!writable || invalid || !dirty} onClick={save}>
          {t('settings.save')}
        </button>
      </label>
      <span className={panelCss.hint}>
        {harnessRatio !== undefined
          ? t('member.ratio.followHarness', { harness: face.harnessDisplayName ?? face.harness ?? face.provider, ratio: String(follow) })
          : t('member.ratio.followGlobal', { ratio: String(follow) })}
      </span>
      {failed && <span className={panelCss.error}>{t('settings.error')}</span>}
    </div>
  )
}
