/**
 * A project's reference recording can be several legs of one continuous
 * session (pause → resume): the edit timeline is the legs butt-joined, and
 * every leg knows where it starts on that joint axis. Single-recording
 * projects are the one-leg case — every helper degenerates cleanly.
 */
import type { Project, Source } from './types.ts'

export interface PartRef {
  source: Source
  startSec: number
}

/** The reference legs in joint-axis order. Empty when nothing is imported yet. */
export function referencePartsOf(p: Project): PartRef[] {
  if (p.referenceParts?.length) {
    const out: PartRef[] = []
    for (const part of p.referenceParts) {
      const source = p.sources.find((s) => s.id === part.sourceId)
      if (source) out.push({ source, startSec: part.startSec })
    }
    if (out.length) return out
  }
  const ref = p.sources.find((s) => s.id === p.referenceId)
  return ref ? [{ source: ref, startSec: 0 }] : []
}

/** Total reference length (the joint axis). */
export function partsDuration(parts: readonly PartRef[]): number {
  const last = parts[parts.length - 1]
  return last ? last.startSec + last.source.durationSec : 0
}

/** Seam times on the joint axis (every leg start after the first). */
export function seamTimes(parts: readonly PartRef[]): number[] {
  return parts.slice(1).map((p) => p.startSec)
}

/** The leg containing joint time t (the last one starting at or before t). */
export function partAt(parts: readonly PartRef[], t: number): PartRef | undefined {
  let cur: PartRef | undefined
  for (const p of parts) {
    if (t >= p.startSec - 1e-6) cur = p
    else break
  }
  return cur
}

/** Video time of a joint-axis time: the containing leg's own offset for this video. */
export function videoTimeOf(parts: readonly PartRef[], video: Source, t: number): number {
  const part = partAt(parts, t)
  if (!part) return t + video.offsetSec
  const off = video.partOffsets?.[part.source.id] ?? video.offsetSec
  return t - part.startSec + off
}

export interface FrameMap {
  /** Video time, snapped to the frame grid. */
  video: { start: number; end: number }
  /** Reference (joint-axis) time covering exactly the same content. */
  ref: { start: number; end: number }
}

/**
 * Kept reference ranges mapped to video-time frame pairs, splitting at seams:
 * a range that crosses into the next leg is cut there, because the video's
 * offset changes at the seam (the recorder paused, the camera may not have).
 * Snapping happens in video time so picture and sound keep the same length.
 */
export function mapFramesToVideo(kept: readonly { start: number; end: number }[], parts: readonly PartRef[], video: Source, fps = 30): FrameMap[] {
  const out: FrameMap[] = []
  for (const r of kept) {
    let cursor = r.start
    while (cursor < r.end - 1e-6) {
      const part = partAt(parts, cursor)
      if (!part) break
      const pieceEnd = Math.min(r.end, part.startSec + part.source.durationSec)
      const off = video.partOffsets?.[part.source.id] ?? video.offsetSec
      const vs = Math.max(0, Math.round((cursor - part.startSec + off) * fps) / fps)
      const ve = Math.min(Math.floor(video.durationSec * fps) / fps, Math.round((pieceEnd - part.startSec + off) * fps) / fps)
      if (ve - vs >= 1 / fps) {
        out.push({
          video: { start: vs, end: ve },
          ref: { start: vs - off + part.startSec, end: ve - off + part.startSec },
        })
      }
      cursor = pieceEnd
    }
  }
  return out
}
