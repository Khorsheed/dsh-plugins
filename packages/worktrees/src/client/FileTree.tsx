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
  IconBranchOutline16, IconChevronDownOutline14, IconChevronRightOutline14,
  IconFolderClose16, IconFolderOpen16, IconTreeCorner8x10,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChangedFile } from '../types.ts'
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

/** Render one row's line counts `+N −M` (nothing when counts are absent). */
function countsText(item: FileTreeItem): string | null {
  if (item.additions === null || item.additions === undefined) return null
  if (item.deletions === null || item.deletions === undefined) return `+${item.additions}`
  return `+${item.additions} −${item.deletions}`
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
  /** Locale-bound translator. */
  t: TranslateNS<'worktrees'>
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
export function FileTree({ groups, selectedPath, onSelect, treeTitle, t }: FileTreeProps): ReactNode {
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

  const renderNode = (node: FileNode, depth: number, groupKey: string): ReactNode => {
    const isDir = node.children.length > 0
    const isOpen = expanded.has(node.path)
    if (isDir) {
      return (
        <div key={`${groupKey}/${node.path}`}>
          <button
            type="button"
            className={css.row}
            style={{ paddingLeft: 8 + depth * 14 }}
            onClick={() => { toggle(node.path) }}
          >
            {isOpen ? <IconChevronDownOutline14 /> : <IconChevronRightOutline14 />}
            {isOpen ? <IconFolderOpen16 /> : <IconFolderClose16 />}
            <span className={css.rowName}>{node.name}</span>
          </button>
          {isOpen && <div className={css.children}>{node.children.map(child => renderNode(child, depth + 1, groupKey))}</div>}
        </div>
      )
    }
    const selected = selectedPath === node.path
    return (
      <button
        key={`${groupKey}/${node.path}`}
        type="button"
        className={`${css.row} ${css.fileRow} ${selected ? css.selected : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => { onSelect(node.path) }}
      >
        <span className={css.fileGlyph}><IconTreeCorner8x10 /></span>
        <span className={css.rowName}>{node.name}</span>
        {node.item !== null && node.item.status !== undefined && node.item.status !== '' && (
          <span className={`${css.status} ${css[`status_${statusClass(node.item.status)}`] ?? ''}`}>{statusText(node.item.status)}</span>
        )}
        {countsText(node.item ?? { path: node.path }) !== null && (
          <span className={css.counts}>{countsText(node.item as FileTreeItem)}</span>
        )}
      </button>
    )
  }

  return (
    <div className={css.tree}>
      <div className={css.treeHeader}>
        <span className={css.treeTitle}>{treeTitle ?? t('mode.worktree')}</span>
        <span className={css.treeActions}>
          <button type="button" className={css.treeAction} onClick={expandAll}>{t('tree.expandAll')}</button>
          <button type="button" className={css.treeAction} onClick={collapseAll}>{t('tree.collapseAll')}</button>
        </span>
      </div>
      {roots.map(group => (
        <div key={group.key}>
          <div className={css.groupHeader}>
            <IconBranchOutline16 />
            <span className={css.groupTitle}>{group.title}</span>
            <span className={css.groupCount}>{group.count}</span>
          </div>
          {group.nodes.map(node => renderNode(node, 0, group.key))}
        </div>
      ))}
    </div>
  )
}
