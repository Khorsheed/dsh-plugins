/**
 * The player at the top of a video or audio entry.
 *
 * Three players, one surface (measured 2026-10-20):
 * - **YouTube**: the official embed in a frame of OUR making (scripts +
 *   its own origin + presentation — the article body's strict sandbox would
 *   break it), driven over postMessage (`enablejsapi=1`): `seekTo` / `playVideo`
 *   / `pauseVideo` commands, and `infoDelivery` messages report the current
 *   time (about four times a second) and the play state, which is what
 *   follows the transcript.
 * - **Bilibili**: the official external player. It exposes no control
 *   channel and reports nothing, so a seek reloads it with `t`, and there is
 *   no current time to follow.
 * - **Audio** (a feed enclosure, a Xiaoyuzhou episode): the native element.
 *
 * A video has two sizes: full (16:9, at most ~40% of the window high) and a
 * MINI bar (a small live picture, the title, the time) the pane switches to
 * while the reader is down in the transcript. Both are the SAME frame resized
 * by CSS — the video keeps playing; nothing reloads.
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
  /** The mini bar instead of the full picture (videos only). */
  readonly mini: boolean
  readonly onMini: (mini: boolean) => void
  /** The control row's own items: before the 收起 toggle, and at its end. */
  readonly leading?: ReactNode
  readonly trailing?: ReactNode
  readonly labels: {
    readonly collapse: string
    readonly expand: string
    readonly noFollow: string
    readonly play: string
    readonly pause: string
    readonly startedAt: string
  }
}

/** Post one YouTube IFrame API message. */
function postYouTube(frame: HTMLIFrameElement | null, message: Record<string, unknown>): void {
  frame?.contentWindow?.postMessage(JSON.stringify(message), 'https://www.youtube.com')
}

/** The player. */
export const MediaPlayer = forwardRef<MediaPlayerHandle, MediaPlayerProps>(function MediaPlayer(props, ref): ReactNode {
  const { media, title, startAt, onTime, mini, onMini, leading, trailing, labels } = props
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [time, setTime] = useState(startAt)
  const [duration, setDuration] = useState<number | undefined>(media.durationSec)
  const [playing, setPlaying] = useState(false)
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
        const data = JSON.parse(event.data) as { event?: string; info?: { currentTime?: number; duration?: number; playerState?: number } }
        if (data.event !== 'infoDelivery' && data.event !== 'initialDelivery') return
        const current = data.info?.currentTime
        if (typeof current === 'number') report(current)
        if (typeof data.info?.duration === 'number' && data.info.duration > 0) setDuration(data.info.duration)
        // 1 playing, 2 paused, 0 ended, 3 buffering.
        const state = data.info?.playerState
        if (typeof state === 'number') setPlaying(state === 1 || state === 3)
      } catch {
        // Not a player message.
      }
    }
    window.addEventListener('message', listen)
    return () => { window.removeEventListener('message', listen) }
  }, [media.provider, report])

  useImperativeHandle(ref, () => ({
    seek: (seconds: number) => {
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

  const toggle = (): void => {
    postYouTube(frameRef.current, { event: 'command', func: playing ? 'pauseVideo' : 'playVideo', args: [] })
    setPlaying(!playing)
  }

  const video = media.kind === 'video' && (media.provider === 'youtube' || media.provider === 'bilibili')
  const small = video && mini
  const knowsTime = media.provider === 'youtube'
  return (
    <div className={css.player} data-mini={small ? 'true' : undefined}>
      {video && (
        <div className={css.videoStage}>
          <div className={css.frameBox}>
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
            {/* The mini picture is a handle, not a control surface: a tap expands. */}
            {small && <button type="button" className={css.miniCover} aria-label={labels.expand} onClick={() => { onMini(false) }} />}
          </div>
        </div>
      )}
      {small && (
        <>
          <div className={css.miniInfo}>
            <b>{title}</b>
            <span>
              {knowsTime
                ? `${formatClock(time)}${duration === undefined ? '' : ` / ${formatClock(duration)}`}`
                : labels.startedAt.replace('{time}', formatClock(biliStart))}
            </span>
          </div>
          {knowsTime && (
            <button type="button" className={css.miniButton} aria-label={playing ? labels.pause : labels.play} title={playing ? labels.pause : labels.play} onClick={toggle}>
              {playing ? <span className={css.pauseGlyph} /> : <span className={css.playGlyph} />}
            </button>
          )}
          <button type="button" className={css.miniButton} aria-label={labels.expand} title={labels.expand} onClick={() => { onMini(false) }}>
            <span className={css.expandGlyph} />
          </button>
          {knowsTime && duration !== undefined && (
            <span className={css.miniProgress}><i style={{ width: `${Math.min(100, (time / duration) * 100)}%` }} /></span>
          )}
        </>
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
      {!small && (
        <div className={css.strip}>
          {leading}
          {video && (
            <button type="button" className={css.link} onClick={() => { onMini(true) }}>{labels.collapse}</button>
          )}
          <span className={css.spacer} />
          {trailing}
          {media.provider === 'bilibili' && (
            <span className={css.info} title={labels.noFollow} aria-label={labels.noFollow} tabIndex={0}>i</span>
          )}
        </div>
      )}
    </div>
  )
})
