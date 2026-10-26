/**
 * Display forms of the titles the coach writes: a textbook's main title with
 * its trailing parenthesis split off as a subtitle, and a station's title
 * without the 「站 1：」 prefix (the disc carries the number) or a trailing
 * 「（教材 A 第 1-3 章）」 (the meta line carries the rows). Stored titles are
 * untouched.
 *
 * @module @khorsheed/dsh-library/client/titles
 */

/** 「Blender 4.5 手册（Getting Started / …）」 → main + sub; a title that is all parenthesis stays whole. */
export function splitTitle(title: string): { main: string; sub?: string } {
  const match = /^(.+?)\s*[（(]([^（）()]+)[)）]\s*$/.exec(title.trim())
  if (match === null || match[1]!.trim() === '') return { main: title.trim() }
  return { main: match[1]!.trim(), sub: match[2]!.trim() }
}

/** A station title as the rail and cards show it. */
export function stationTitle(title: string): string {
  const cleaned = title.trim()
    .replace(/^(?:站|第)\s*\d+\s*站?\s*[:：.、\s-]\s*/, '')
    .replace(/\s*[（(][^（）()]*(?:第\s*[\d\s,，、–—-]+\s*章|章节?\s*\d)[^（）()]*[)）]\s*$/, '')
  return cleaned === '' ? title.trim() : cleaned
}
