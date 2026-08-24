/**
 * The file tree: a path trie rendered with IDE-explorer anatomy (compact
 * rows, chevron disclosure, indent guides, hover/selected backgrounds —
 * datasets' DatasetsView is the in-repo reference). The tree renders any
 * group list: the worktree mode's two change segments, the repository's full
 * file list, or one commit's files. Default expansion shows only the first
 * level; every node expands on demand and the header offers expand-all /
 * collapse-all, so the whole tree is always reachable.
 */
import { useMemo, useState, type ReactNode } from 'react'
import {
  IconChevronDownOutline14, IconChevronRightOutline14,
  IconFolderClose16, IconFolderOpen16, IconPanelLeftOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChangedFile } from '../types.ts'
import { formatCount } from './Overview.tsx'
import css from './FileTree.module.css'

/** One leaf entry: its path plus optional change metadata. */
export interface FileTreeItem {
  /** Repo-relative path. */
  path: string
  /** Change status letter ('' = plain file, e.g. the repo browse mode). */
  status?: ChangedFile['status'] | ''
  /** Diff line counts (null = unknown/untracked). */
  additions?: number | null
  deletions?: number | null
}

/** One top-level group of the tree (a change segment, a commit, or the whole repo). */
export interface FileTreeGroup {
  /** Stable group key. */
  key: string
  /** Group header title ('' hides the header, e.g. a single-group repo tree). */
  title: string
  /** Group header count. */
  count: number
  /** The group's leaf entries. */
  items: readonly FileTreeItem[]
}

/** One trie node. */
interface FileNode {
  /** Path segment (basename). */
  name: string
  /** Accumulated repo-relative path ('' for synthetic group roots). */
  path: string
  /** Directory children; empty for leaves. */
  children: FileNode[]
  /** Leaf metadata, present only for files. */
  item: FileTreeItem | null
}

/** Build a trie from the group's leaf entries. */
function buildNodes(items: readonly FileTreeItem[]): FileNode[] {
  const roots: FileNode[] = []
  for (const item of items) {
    const segments = item.path.split('/').filter(segment => segment !== '')
    let level = roots
    let accumulated = ''
    segments.forEach((segment, index) => {
      accumulated = accumulated === '' ? segment : `${accumulated}/${segment}`
      let node = level.find(candidate => candidate.name === segment)
      if (node === undefined) {
        node = {
          name: segment,
          path: accumulated,
          children: [],
          item: index === segments.length - 1 ? item : null,
        }
        level.push(node)
      }
      level = node.children
    })
  }
  return sortNodes(roots)
}

/** Directories before files, then name order — the explorer convention. */
function sortNodes(nodes: FileNode[]): FileNode[] {
  return [...nodes].sort((a, b) => {
    const aDir = a.children.length > 0 ? 0 : 1
    const bDir = b.children.length > 0 ? 0 : 1
    if (aDir !== bDir) return aDir - bDir
    return a.name.localeCompare(b.name)
  })
}

/** Status badge text ('' for a plain file). */
function statusText(status: FileTreeItem['status']): string {
  if (status === undefined || status === '') return ''
  if (status === '??') return '??'
  return status
}

/** CSS class suffix for a status letter ('??' is not a valid CSS identifier). */
function statusClass(status: FileTreeItem['status']): string {
  return status === '??' ? 'untracked' : (status ?? '')
}


/** Props of the file tree. */
export interface FileTreeProps {
  /** The groups rendered as top-level disclosures. */
  groups: readonly FileTreeGroup[]
  /** The selected file path, or null. */
  selectedPath: string | null
  /** Called when a file row is clicked. */
  onSelect: (path: string) => void
  /** The tree header title (defaults to the changes-mode label). */
  treeTitle?: string
  /** When given, renders a collapse-to-rail toggle at the right of the header. */
  collapsed?: boolean
  onToggleCollapse?: () => void
  /** Locale-bound translator. */
  t: TranslateNS<'worktrees'>
}

/** A neutral document glyph: the official icon set has no file icon (the
 * closest, IconCodeOutline16, reads as a '#'-like mark), so the tree draws its
 * own folded-corner paper in the neutral tone via currentColor. */
function FileGlyph(): ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M9 1.5H4.5A1.5 1.5 0 0 0 3 3v10a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 13V5.5L9 1.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" fill="none" />
      <path d="M9 1.5V5.5h4" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" fill="none" />
    </svg>
  )
}

/** Relative time for a commit (compact form). */
export function relativeTime(seconds: number, now = Date.now()): string {
  if (seconds <= 0) return ''
  const delta = Math.max(0, Math.floor(now / 1000) - seconds)
  if (delta < 60) return `${delta}s`
  if (delta < 3600) return `${Math.floor(delta / 60)}m`
  if (delta < 86400) return `${Math.floor(delta / 3600)}h`
  if (delta < 86400 * 30) return `${Math.floor(delta / 86400)}d`
  return `${Math.floor(delta / (86400 * 30))}mo`
}

/** The file tree. */
export function FileTree({ groups, selectedPath, onSelect, treeTitle, collapsed, onToggleCollapse, t }: FileTreeProps): ReactNode {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())

  const roots = useMemo(
    () => groups
      .filter(group => group.items.length > 0)
      .map(group => ({
        key: group.key,
        title: group.title,
        count: group.count,
        nodes: buildNodes(group.items),
      })),
    [groups],
  )

  const allPaths = useMemo(() => {
    const paths = new Set<string>()
    for (const group of roots) {
      const walk = (nodes: FileNode[]): void => {
        for (const node of nodes) {
          if (node.children.length > 0) {
            paths.add(node.path)
            walk(node.children)
          }
        }
      }
      walk(group.nodes)
    }
    return paths
  }, [roots])

  const toggle = (path: string): void => {
    setExpanded(previous => {
      const next = new Set(previous)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }
  const expandAll = (): void => setExpanded(new Set(allPaths))
  const collapseAll = (): void => setExpanded(new Set())

  if (roots.length === 0) {
    return <div className={css.empty}>{t('group.empty')}</div>
  }

  const renderNode = (node: FileNode, groupKey: string): ReactNode => {
    const isDir = node.children.length > 0
    const isOpen = expanded.has(node.path)
    if (isDir) {
      return (
        <div key={`${groupKey}/${node.path}`}>
          <button type="button" className={css.row} onClick={() => { toggle(node.path) }}>
            <span className={css.chevron}>{isOpen ? <IconChevronDownOutline14 size={18} /> : <IconChevronRightOutline14 size={18} />}</span>
            {isOpen ? <IconFolderOpen16 /> : <IconFolderClose16 />}
            <span className={css.dirName}>{node.name}</span>
          </button>
          {isOpen && <div className={css.children}>{node.children.map(child => renderNode(child, groupKey))}</div>}
        </div>
      )
    }
    const selected = selectedPath === node.path
    return (
      <button
        key={`${groupKey}/${node.path}`}
        type="button"
        className={`${css.row} ${css.fileRow} ${selected ? css.selected : ''}`}
        onClick={() => { onSelect(node.path) }}
      >
        <span className={css.fileGlyph}><FileGlyph /></span>
        <span className={css.rowName}>{node.name}</span>
        {node.item !== null && node.item.status !== undefined && node.item.status !== '' && (
          <span className={`${css.status} ${css[`status_${statusClass(node.item.status)}`] ?? ''}`}>{statusText(node.item.status)}</span>
        )}
        {(() => {
          const add = (node.item as FileTreeItem).additions
          const del = (node.item as FileTreeItem).deletions
          const showAdd = add !== null && add !== undefined && add > 0
          const showDel = del !== null && del !== undefined && del > 0
          if (!showAdd && !showDel) return null
          return (
            <span className={css.counts}>
              {showAdd && <span className={css.add}>+{formatCount(add ?? 0)}</span>}
              {showDel && <span className={css.del}> −{formatCount(del ?? 0)}</span>}
            </span>
          )
        })()}
      </button>
    )
  }

  return (
    <div className={css.tree}>
      <div className={css.treeHeader}>
        <span className={css.treeTitle}>{treeTitle ?? t('mode.worktree')}</span>
        <span className={css.treeActions}>
          <button
            type="button"
            className={css.treeAction}
            onClick={expanded.size === 0 ? expandAll : collapseAll}
          >
            {expanded.size === 0 ? t('tree.expandAll') : t('tree.collapseAll')}
          </button>
          {onToggleCollapse !== undefined && (
            <button
              type="button"
              className={css.collapseButton}
              title={collapsed ? t('tree.expand') : t('tree.collapse')}
              onClick={onToggleCollapse}
            >
              <IconPanelLeftOutline16 />
            </button>
          )}
        </span>
      </div>
      {roots.map(group => (
        <div key={group.key}>
          {group.nodes.map(node => renderNode(node, group.key))}
        </div>
      ))}
    </div>
  )
}
