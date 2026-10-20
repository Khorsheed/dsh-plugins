/**
 * The wall's video / audio cards: what each one's transcript is (platform
 * captions, a local transcript, transcribing, none), read from the host for
 * the media cards on screen and re-read every few seconds while any of them
 * is transcribing — the card's pill is how a reader sees a job they left run.
 *
 * @module @khorsheed/dsh-reader/client/useMediaStates
 */
import { useEffect, useRef, useState } from 'react'
import type { MediaCardStates } from '../types.ts'
import type { ReaderPaneProps } from './contract.ts'

/** How often a wall with a transcribing card re-reads (ms). */
const POLL_MS = 3000

const LIVE = new Set(['fetching', 'queued', 'transcribing'])

/**
 * @param entryIds - the media cards on the wall.
 * @param active - whether the wall is on screen.
 * @param remote - the Remote verb.
 */
export function useMediaStates(entryIds: readonly string[], active: boolean, remote: Pick<ReaderPaneProps, 'mediaStates'>): MediaCardStates | undefined {
  const [states, setStates] = useState<MediaCardStates | undefined>(undefined)
  const remoteRef = useRef(remote)
  remoteRef.current = remote
  const key = entryIds.join(',')
  const live = states !== undefined && Object.values(states.states).some(status => LIVE.has(status.state))

  useEffect(() => {
    if (!active || key === '') return undefined
    let cancelled = false
    const read = (): void => {
      void remoteRef.current.mediaStates({ entryIds: key.split(',') }).then(answer => {
        if (!cancelled && answer.ok) setStates(answer.value)
      })
    }
    read()
    const timer = live ? setInterval(read, POLL_MS) : undefined
    return () => {
      cancelled = true
      if (timer !== undefined) clearInterval(timer)
    }
  }, [key, active, live])

  return states
}
