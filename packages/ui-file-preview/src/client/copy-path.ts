/** Copy-path gesture feedback shared by the file view and the link-click
 * drawer. The clipboard write itself is the injected `copyPath` verb (the
 * apply closure resolves the recorded display path against the session cwd,
 * so both surfaces copy the same host-facing absolute spelling the open
 * gestures use); this hook only owns the transient "copied" feedback that a
 * successful write flips on for one second. A refused write leaves the flag
 * untouched, so the control never claims a copy the host declined. */

import { useCallback, useEffect, useState } from 'react'

/** How long the `copied` flag stays true after a successful write, in ms. */
const COPIED_FEEDBACK_MS = 1000

/** The copy-feedback hook's return: the transient flag and the copy handler. */
export interface CopyPathFeedback {
  /** True for {@link COPIED_FEEDBACK_MS} after a successful write; render the success label off it. */
  copied: boolean
  /** Copy the selected path; no-op while `copied` is still true or without a selection, silent on a refused write. */
  onCopy: () => void
}

/**
 * Copy `path` through the injected verb with one-second success feedback.
 * The flag resets when the target path changes, so a stale "copied" never
 * rides along to the next selection.
 * @param copyPath - the injected copy verb (resolves and writes the path).
 * @param path - the currently selected path, or null when nothing is selected.
 * @returns the `copied` flag and the `onCopy` handler.
 */
export function useCopyPathFeedback(
  copyPath: (path: string) => Promise<boolean>,
  path: string | null,
): CopyPathFeedback {
  const [copied, setCopied] = useState(false)
  useEffect(() => { setCopied(false) }, [path])
  const onCopy = useCallback(() => {
    if (path === null || copied) return
    void copyPath(path).then((ok) => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, COPIED_FEEDBACK_MS)
    })
  }, [copyPath, path, copied])
  return { copied, onCopy }
}
