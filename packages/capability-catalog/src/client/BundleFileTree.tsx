import { useMemo, useState, type ReactNode } from 'react'
  import { IconChevronDownOutlineMedium, IconChevronRightOutlineMedium, IconFolderCloseMedium, IconFolderOpenMedium } from './icons.tsx'
  import css from './CapabilityCatalogCard.module.css'

/** One node of the bundle file tree. */
interface BundleNode {
  name: string
  path: string
  children: BundleNode[]
  isDir: boolean
}

/** Build a directory trie from flat bundle-relative paths. */
function buildBundleTree(files: readonly string[]): BundleNode[] {
  const roots: BundleNode[] = []
  for (const file of files) {
    const segments = file.split('/').filter(s => s !== '')
    let level = roots
    let acc = ''
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      if (seg === undefined) continue
      acc = acc === '' ? seg : `${acc}/${seg}`
      const last = i === segments.length - 1
      let node = level.find(n => n.name === seg)
      if (node === undefined) {
        node = { name: seg, path: acc, children: [], isDir: !last }
        level.push(node)
      }
      level = node.children
    }
  }
  return [...roots].sort((a, b) => {
    const aDir = a.isDir ? 0 : 1
    const bDir = b.isDir ? 0 : 1
    if (aDir !== bDir) return aDir - bDir
    return a.name.localeCompare(b.name)
  })
}

/** A neutral document glyph for file rows (folded-corner page). */
function BundleFileGlyph(): ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M9 1.5H4.5A1.5 1.5 0 0 0 3 3v10a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 13V5.5L9 1.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" fill="none" />
      <path d="M9 1.5V5.5h4" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" fill="none" />
    </svg>
  )
}

/** Skill-bundle file tree (IDE-explorer anatomy: chevron, folder, indent). */
export function BundleFileTree({ files, selectedPath, onSelect }: {
  files: readonly string[]
  selectedPath: string
  onSelect: (path: string) => void
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => {
    const all = new Set<string>()
    const walk = (nodes: BundleNode[]): void => {
      for (const node of nodes) {
        if (node.isDir) {
          all.add(node.path)
          walk(node.children)
        }
      }
    }
    walk(buildBundleTree(files))
    return all
  })
  const roots = useMemo(() => buildBundleTree(files), [files])

  const toggle = (path: string): void => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const renderNode = (node: BundleNode, depth: number): ReactNode => {
    const indent = { paddingLeft: `${depth * 16 + 4}px` }
    if (node.isDir) {
      const open = expanded.has(node.path)
      return (
        <div key={node.path}>
          <button type="button" className={css.treeRow} style={indent} onClick={() => toggle(node.path)}>
            <span className={css.treeChevron}>{open ? <IconChevronDownOutlineMedium size={16} /> : <IconChevronRightOutlineMedium size={16} />}</span>
            {open ? <IconFolderOpenMedium /> : <IconFolderCloseMedium />}
            <span className={css.treeName}>{node.name}</span>
          </button>
          {open && node.children.length > 0 ? (
            <div>{node.children.map(child => renderNode(child, depth + 1))}</div>
          ) : null}
        </div>
      )
    }
    const selected = selectedPath === node.path
    return (
      <button
        type="button"
        className={`${css.treeRow} ${css.treeFile} ${selected ? css.treeSelected : ''}`}
        style={indent}
        key={node.path}
        onClick={() => onSelect(node.path)}
      >
        <span className={css.treeGlyph}><BundleFileGlyph /></span>
        <span className={css.treeName}>{node.name}</span>
      </button>
    )
  }

  return (
    <div className={css.tree}>
      {roots.map(node => renderNode(node, 0))}
    </div>
  )
}
