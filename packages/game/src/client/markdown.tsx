/**
 * A deliberately small markdown view for design chapters: headings, lists,
 * quotes, pipe tables and paragraphs. No HTML passes through — every line is
 * rendered as text.
 */
import type { ReactNode } from 'react'
import css from './GameTab.module.css'

/** Split a pipe-table row into its cells. */
function cells(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())
}

/** Render chapter text. */
export function Markdown({ text }: { text: string }): ReactNode {
  const lines = text.split('\n')
  const out: ReactNode[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (line.trim() === '') continue
    const heading = /^(#{1,3})\s+(.*)$/.exec(line)
    if (heading !== null) {
      out.push(heading[1]!.length === 1 ? <h3 key={i} className={css.mdH1}>{heading[2]}</h3> : <h4 key={i} className={css.mdH2}>{heading[2]}</h4>)
      continue
    }
    if (/^\s*\|/.test(line)) {
      const rows: string[][] = []
      while (i < lines.length && /^\s*\|/.test(lines[i] ?? '')) {
        const row = lines[i] ?? ''
        if (!/^\s*\|[\s:|-]+\|\s*$/.test(row)) rows.push(cells(row))
        i++
      }
      i--
      const [head, ...body] = rows
      out.push(<div key={i} className={css.mdTableWrap}><table className={css.mdTable}>
        {head !== undefined && <thead><tr>{head.map((c, j) => <th key={j}>{c}</th>)}</tr></thead>}
        <tbody>{body.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table></div>)
      continue
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const items: string[] = []
      const ordered = /^\s*\d+\./.test(line)
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i] ?? '')) {
        items.push((lines[i] ?? '').replace(/^\s*([-*]|\d+\.)\s+/, ''))
        i++
      }
      i--
      const list = items.map((item, k) => <li key={k}>{item}</li>)
      out.push(ordered ? <ol key={i} className={css.mdList}>{list}</ol> : <ul key={i} className={css.mdList}>{list}</ul>)
      continue
    }
    if (line.startsWith('>')) {
      out.push(<blockquote key={i} className={css.mdQuote}>{line.replace(/^>\s?/, '')}</blockquote>)
      continue
    }
    out.push(<p key={i} className={css.mdP}>{line}</p>)
  }
  return <div className={css.md}>{out}</div>
}
