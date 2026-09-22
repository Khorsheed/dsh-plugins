/**
 * Type vocabulary and wire-facing constants of `@khorsheed/dsh-capture`.
 *
 * The Remote contract is deliberately minimal: one verb, `render`, whose
 * business result is the serialized rendered page. Every refusal — a bad URL,
 * a private-network target, a missing browser, a timeout, a full queue — is a
 * thrown `RemoteError` with a `capture/*` code, so the caller's `RemoteResult`
 * error branch carries it; the success value never doubles as an error union.
 *
 * @module @khorsheed/dsh-capture/types
 */
import type {} from '@deepseek-ai/dsh-typert-protocol'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The URL does not parse, is not http(s), or carries credentials. */
    'capture/invalid-url': { readonly url: string }
    /** The host resolves to a loopback/private/link-local/metadata/reserved address (re-checked per redirect). */
    'capture/private-target': { readonly hostname: string }
    /** No managed browser: the binary is not installed and could not be downloaded or launched. */
    'capture/unavailable': {}
    /** The navigation itself failed (DNS/TLS/HTTP error status), not the page. */
    'capture/navigation-failed': { readonly status?: number }
    /** The navigation exceeded the granted timeout. */
    'capture/timeout': { readonly timeoutMs: number }
    /** Another render is in flight and the wait queue is full. */
    'capture/busy': {}
  }
}

/** One `capture.render` invocation's parameters. */
export interface CaptureRenderRequest {
  /** The http(s) page to render. Credentials and non-web schemes are refused. */
  readonly url: string
  /** Navigation timeout in ms; clamped to [CAPTURE_MIN_TIMEOUT_MS, CAPTURE_MAX_TIMEOUT_MS]. */
  readonly timeoutMs?: number
}

/**
 * The serialized rendered page. This exact shape is mirrored structurally by
 * callers (the reader's `ReaderCaptureRemote`) — it changes only with a
 * coordinated bump.
 */
export interface CaptureRenderedPage {
  /** `<!DOCTYPE html>` + the serialized document, styles inlined, scripts removed. */
  readonly html: string
  /** Where the navigation actually landed, when redirects moved it. */
  readonly finalUrl?: string
  /** `document.title` at capture time, when non-empty. */
  readonly title?: string
  /** True when the serialized document was cut at the size cap. */
  readonly truncated?: boolean
}

/** One site's persisted allow record (written after the first successful render). */
export interface CaptureSiteRecord {
  /** ISO-8601 instant of the first successful (gesture-approved) render. */
  readonly firstAllowedAt: string
  /** ISO-8601 instant of the most recent successful render. */
  readonly lastRenderAt: string
  /** How many renders this host has completed. */
  readonly renders: number
}

/** The durable state document (`<stateRoot>/state.json`). */
export interface CaptureStateDoc {
  /** Durable format version; unknown versions read as empty, never guessed. */
  readonly version: typeof CAPTURE_STORAGE_VERSION
  /** Per-site allow records keyed by URL host. */
  readonly sites: Record<string, CaptureSiteRecord>
}

/** State-root directory segment under `$DSH_HOME/state/`. */
export const STATE_ROOT_SEGMENT = 'dsh-capture'

/** The durable state format this build reads and writes. */
export const CAPTURE_STORAGE_VERSION = 1

/** Per-site allow records retained (least-recently-rendered hosts pruned first). */
export const MAX_SITE_RECORDS = 500

/** Default navigation timeout (30 s), used when the caller passes none. */
export const DEFAULT_TIMEOUT_MS = 30_000

/** Bounds on a caller-supplied `timeoutMs`. */
export const CAPTURE_MIN_TIMEOUT_MS = 1_000
export const CAPTURE_MAX_TIMEOUT_MS = 120_000

/** Serialized-output cap in characters (~8 MB); the tail is cut and `truncated` set. */
export const DEFAULT_MAX_CHARS = 8_000_000

/** Idle time after the last render before the managed Chrome exits. */
export const DEFAULT_IDLE_TIMEOUT_MS = 60_000

/** Renders that may wait behind the one in flight before `capture/busy` refuses. */
export const DEFAULT_MAX_QUEUE = 4

/** Dwell per viewport step of the scroll sweep (IntersectionObserver needs ≥ ~400 ms). */
export const DEFAULT_DWELL_MS = 500

/** Total budget for the scroll sweep; longer pages capture what the budget reached. */
export const DEFAULT_MAX_SWEEP_MS = 20_000

/** One viewport-fraction step of the scroll sweep (overlap keeps boundary figures in view). */
export const SCROLL_STEP_RATIO = 0.8

/** Post-load network quiescence: quiet window, and the cap on waiting for it. */
export const QUIESCENCE_QUIET_MS = 500
export const QUIESCENCE_MAX_MS = 5_000

/** Interactive widgets snapshotted per render (document order; the rest keep their DOM). */
export const DEFAULT_MAX_SNAPSHOTS = 40

/** A widget box larger than this in either dimension stays DOM (screenshot cost and payload explode). */
export const MAX_SNAPSHOT_DIMENSION = 4096

/** Raster zoom of the widget screenshot — 2 keeps widget text crisp on retina displays. */
export const SNAPSHOT_CLIP_SCALE = 2

/** WebP quality of the widget screenshot. */
export const SNAPSHOT_WEBP_QUALITY = 80

/** Characters of a widget's non-caption text kept as the snapshot img's alt (the searchable residue). */
export const WIDGET_ALT_MAX_CHARS = 400

/** Chrome for Testing build tag installed when no binary is configured. */
export const DEFAULT_CHROME_BUILD = 'stable'

/** The viewport every render is given. */
export const CAPTURE_VIEWPORT = { width: 1280, height: 800 } as const
