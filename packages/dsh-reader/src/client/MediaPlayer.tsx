/**
 * The player at the top of a video or audio entry.
 *
 * Three players, one surface (measured 2026-10-20):
 * - **YouTube**: the official embed in a frame of OUR making (scripts +
 *   its own origin + presentation — the article body's strict sandbox would
 *   break it), driven over postMessage (`enablejsapi=1`): `seekTo` / `playVideo`
 *   commands, and `infoDelivery` messages report the current time about four
 *   times a second, which is what follows the transcript.
 * - **Bilibili**: the official external player. It exposes no control
 *   channel and reports nothing, so a seek reloads it with `t`, and there is
 *   no current time to follow.
 * - **Audio** (a feed enclosure, a Xiaoyuzhou episode): the native element.
 *
 * @module @khorsheed/dsh-reader/client/MediaPlayer
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react'
import { embedUrl, type ReaderMedia } from '../media.ts'
import { formatClock } from '../captions.ts'
import css from './MediaPlayer.module.css'

/** What the pane can ask of the player. */
export interface MediaPlayerHandle {
  /** Jump to `seconds` and play. */
  seek: (seconds: number) => void
}

/** The player's props. */
export interface MediaPlayerProps {
  readonly media: ReaderMedia
  readonly title: string
  /** Where to start (a remembered position). */
  readonly startAt: number
  /** The current time, whenever the player knows it (YouTube, audio). */
  readonly onTime: (seconds: number) => void
  readonly labels: { readonly collapse: string; readonly expand: string; readonly noFollow: string }
}

/** Post one YouTube IFrame API message. */
function postYouTube(frame: HTMLIFrameElement | null, message: Record<string, unknown>): void {
  frame?.contentWindow?.postMessage(JSON.stringify(message), 'https://www.youtube.com')
}

/** The player. */
export const MediaPlayer = forwardRef<MediaPlayerHandle, MediaPlayerProps>(function MediaPlayer(props, ref): ReactNode {
  const { media, title, startAt, onTime, labels } = props
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [time, setTime] = useState(startAt)
  // Bilibili seeks by reloading: the start of the CURRENT load.
  const [biliStart, setBiliStart] = useState(startAt)
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const [ytSrc] = useState(() => media.provider === 'youtube' ? embedUrl(media, startAt, origin) : undefined)

  const report = useCallback((seconds: number) => {
    setTime(seconds)
    onTime(seconds)
  }, [onTime])

  // YouTube: subscribe to its state messages once the frame loads.
  useEffect(() => {
    if (media.provider !== 'youtube') return
    const listen = (event: MessageEvent): void => {
      if (!/^https:\/\/www\.youtube(-nocookie)?\.com$/.test(event.origin) || typeof event.data !== 'string') return
      try {
        const data = JSON.parse(event.data) as { event?: string; info?: { currentTime?: number } }
        const current = data.info?.currentTime
        if ((data.event === 'infoDelivery' || data.event === 'initialDelivery') && typeof current === 'number') report(current)
      } catch {
        // Not a player message.
      }
    }
    window.addEventListener('message', listen)
    return () => { window.removeEventListener('message', listen) }
  }, [media.provider, report])

  useImperativeHandle(ref, () => ({
    seek: (seconds: number) => {
      setCollapsed(false)
      if (media.provider === 'youtube') {
        postYouTube(frameRef.current, { event: 'command', func: 'seekTo', args: [seconds, true] })
        postYouTube(frameRef.current, { event: 'command', func: 'playVideo', args: [] })
        report(seconds)
      } else if (media.provider === 'bilibili') {
        setBiliStart(seconds)
        report(seconds)
      } else if (audioRef.current !== null) {
        audioRef.current.currentTime = seconds
        void audioRef.current.play().catch(() => undefined)
      }
    },
  }), [media.provider, report])

  const video = media.kind === 'video' && (media.provider === 'youtube' || media.provider === 'bilibili')
  return (
    <div className={css.player} data-collapsed={collapsed ? 'true' : undefined}>
      {video && (
        <div className={css.frameBox} hidden={collapsed}>
          {media.provider === 'youtube'
            ? (
              <iframe
                ref={frameRef}
                className={css.frame}
                title={title}
                src={ytSrc}
                sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
                allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
                referrerPolicy="strict-origin-when-cross-origin"
                onLoad={() => { postYouTube(frameRef.current, { event: 'listening', id: 'dsh-reader' }) }}
              />
            )
            : (
              <iframe
                key={biliStart}
                className={css.frame}
                title={title}
                src={embedUrl(media, biliStart, origin)}
                sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
                allow="autoplay; fullscreen"
                referrerPolicy="strict-origin-when-cross-origin"
              />
            )}
        </div>
      )}
      {!video && (
        <audio
          ref={audioRef}
          className={css.audio}
          controls
          preload="metadata"
          src={media.ref}
          onLoadedMetadata={event => { if (startAt > 0) event.currentTarget.currentTime = startAt }}
          onTimeUpdate={event => { report(event.currentTarget.currentTime) }}
        />
      )}
      <div className={css.strip}>
        {video && (
          <button type="button" className={css.link} onClick={() => { setCollapsed(value => !value) }}>
            {collapsed ? labels.expand : labels.collapse}
          </button>
        )}
        {collapsed && <span className={css.clock}>{formatClock(time)}{media.durationSec === undefined ? '' : ` / ${formatClock(media.durationSec)}`}</span>}
        {media.provider === 'bilibili' && <span className={css.muted}>{labels.noFollow}</span>}
      </div>
    </div>
  )
})
