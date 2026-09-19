/**
 * The error seat both tabs use (ui-spec §九, 错误态三段式): one human sentence
 * saying what happened, one saying how to fix it, and the raw exception plus
 * the path folded away under «详情».
 *
 * WHY a component rather than `{t('x.error')}: {message}` at each site: the
 * message on the wire is written for whoever debugs the host — it is English,
 * it carries a stack-ish `GitError: git rev-parse --show-toplevel failed`, and
 * it quotes an absolute path. Printed straight onto the page it tells the
 * tab's user neither what broke nor what to do, and the I5 walkthrough found
 * both tabs doing exactly that on their FIRST screen. The raw text still has a
 * reader, so it is folded away rather than dropped.
 *
 * WHY the cause is recovered from the message text: a Remote failure crosses
 * the wire under one of the gateway's three TRANSPORT codes, so the domain
 * cause survives only inside `message`. {@link classifyError} matches the
 * markers the hosts themselves emit, and a host-side test in each package pins
 * those sentences — reword one and a test fails here rather than the page
 * quietly degrading to its unknown-cause copy.
 *
 * This file is DUPLICATED in the sibling tab's package on purpose: a client
 * bundle never imports a sibling plugin (ui-spec §八), so the two tabs share
 * one implementation by being copies of it, kept identical by hand.
 *
 * The compact variant applies two classes rather than one `composes:` class:
 * this bundler drops `composes` without a word, so a composed variant renders
 * as an unstyled box.
 */

import type { DatasetsKey } from './locales.ts'
import type { DatasetsViewProps } from './contract.ts'
import css from './DatasetsView.module.css'

/** What went wrong, as far as the message lets us tell. */
export type ErrorKind =
  | 'notGitRepo'
  | 'notDatasetRepo'
  | 'pathMissing'
  | 'unbound'
  | 'serviceMissing'
  | 'cancelled'
  | 'unknown'

/**
 * Marker → kind, in priority order; the first match wins. The dataset-repo
 * test sits ahead of the git one because a dataset repository IS a git
 * repository — the more specific complaint must not be swallowed by the
 * general one.
 */
const MARKERS: ReadonlyArray<readonly [RegExp, ErrorKind]> = [
  [/not a dataset repository|no datasets\/ directory|holds no datasets\//i, 'notDatasetRepo'],
  [/not a git repository|rev-parse --show-toplevel/i, 'notGitRepo'],
  [/no dataset repository/i, 'unbound'],
  [/\bENOENT\b|no such file or directory|does not exist|is not a directory/i, 'pathMissing'],
  [/\bno \w+ service\b|mounts no |mount the dsh-/i, 'serviceMissing'],
  [/\bcancelled\b|\bcanceled\b|\baborted\b/i, 'cancelled'],
]

/**
 * Recover the cause of one failure from its message.
 * @param message - the raw failure message as it crossed the wire.
 * @returns the matching kind, or 'unknown' when no marker fits.
 */
export function classifyError(message: string): ErrorKind {
  for (const [marker, kind] of MARKERS) {
    if (marker.test(message)) return kind
  }
  return 'unknown'
}

/**
 * The two sentences of each kind. 'unknown' has no headline of its own — the
 * caller's `what` says which read failed, which is the only true thing there
 * is to say about a cause nobody recognized.
 */
const COPY: Readonly<Record<ErrorKind, { head: DatasetsKey | null; fix: DatasetsKey }>> = {
  notGitRepo: { head: 'error.notGitRepo', fix: 'error.notGitRepo.fix' },
  notDatasetRepo: { head: 'error.notDatasetRepo', fix: 'error.notDatasetRepo.fix' },
  pathMissing: { head: 'error.pathMissing', fix: 'error.pathMissing.fix' },
  unbound: { head: 'error.unbound', fix: 'error.unbound.fix' },
  serviceMissing: { head: 'error.serviceMissing', fix: 'error.serviceMissing.fix' },
  cancelled: { head: 'error.cancelled', fix: 'error.cancelled.fix' },
  unknown: { head: null, fix: 'error.unknownFix' },
}

/** The error seat's props. */
export interface ErrorStateProps {
  /**
   * One human sentence for WHICH read failed («题集列表没读出来»). Shown as the
   * headline when the cause is unrecognized, and inside the fold otherwise, so
   * a recognized cause still says what it happened to.
   */
  what: string
  /** The raw failure message. Never rendered outside the fold. */
  message: string
  /**
   * The path the failed call was about, when the page knows one. Folded with
   * the raw text: §九 keeps absolute paths off the page itself.
   */
  path?: string | undefined
  /**
   * The fix line to use when the classifier does NOT recognize the cause.
   *
   * The markers below read messages the HOSTS emit, and some failures are
   * specific to one caller rather than to a host — a plan document whose
   * dataset working tree was deleted is the lab tab's own, and the generic
   * 「再试一次或看详情」 is a worse answer than the caller's own sentence
   * (I5·T67 · W11). A recognized cause still wins: the classifier knows more
   * about `ENOENT` than any caller does.
   */
  fix?: DatasetsKey | undefined
  /** Compact form for an error inside a field or a strip, rather than a page's body. */
  compact?: boolean
  t: DatasetsViewProps['t']
}

/**
 * The three-part error seat.
 * @param props - see {@link ErrorStateProps}.
 */
export function ErrorState(props: ErrorStateProps) {
  const { what, message, path, compact = false, t } = props
  const kind = classifyError(message)
  const { head, fix: known } = COPY[kind]
  const fix = kind === 'unknown' && props.fix !== undefined ? props.fix : known
  return (
    <div className={compact ? `${css.errorSeat} ${css.errorSeatCompact}` : css.errorSeat}>
      <div className={css.errorHead}>{head === null ? what : t(head)}</div>
      <div className={css.errorFix}>{t(fix)}</div>
      <details className={css.errorDetails}>
        <summary className={css.errorSummary}>{t('error.details')}</summary>
        {head !== null && <div className={css.errorDetailLine}>{what}</div>}
        {path !== undefined && path !== '' && (
          <div className={css.errorDetailLine}>{t('error.detailsPath')}: {path}</div>
        )}
        <pre className={css.errorRaw}>{message}</pre>
      </details>
    </div>
  )
}
