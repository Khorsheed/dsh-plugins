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
  /** Whether this entry is a directory (the local-browser trie needs this to
   *  render an expandable dir even when its children are lazily loaded). */
  isDir?: boolean
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
  /** The node's resolved absolute path ('' for the root of a static group). */
  dirPath: string
  /** Directory children; empty for leaves. */
  children: FileNode[]
  /** Leaf metadata, present only for files. */
  item: FileTreeItem | null
  /** Whether this node is a directory even without static children (lazy). */
  dir: boolean
}

/** Build a trie from the group's leaf entries. */
function buildNodes(items: readonly FileTreeItem[], rootDirPath = ''): FileNode[] {
  const roots: FileNode[] = []
  for (const item of items) {
    const segments = item.path.split('/').filter(segment => segment !== '')
    let level = roots
    let accumulated = ''
    segments.forEach((segment, index) => {
      accumulated = accumulated === '' ? segment : `${accumulated}/${segment}`
      const isLast = index === segments.length - 1
      let node = level.find(candidate => candidate.name === segment)
      if (node === undefined) {
        node = {
          name: segment,
          path: accumulated,
          dirPath: rootDirPath === '' ? accumulated : `${rootDirPath}/${accumulated}`,
          children: [],
          item: isLast ? item : null,
          dir: isLast ? item.isDir === true : true,
        }
        level.push(node)
      } else if (isLast) {
        // A later item identifies this path as a leaf (file); keep any dir flag.
        node.item = item
        node.dir = item.isDir === true
      }
      level = node.children
    })
  }
  return sortNodes(roots)
}

/** Directories before files, then name order — the explorer convention. */
function sortNodes(nodes: FileNode[]): FileNode[] {
  return [...nodes].sort((a, b) => {
    const aDir = a.dir || a.children.length > 0 ? 0 : 1
    const bDir = b.dir || b.children.length > 0 ? 0 : 1
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
  /** Optional lazy-children loader for directory rows: when a directory is
   * expanded and this is given, the dir's children are fetched once (and
   * cached) instead of coming from the static group trie. Renders the dir as
   * an expandable row even when the static trie has no children yet. Used by
   * the local-files browser (per-level browsing); the git modes omit it and
   * keep the fully-built trie.
   * @param dirPath - the directory's resolved path (rootPath + relative path).
   */
  loadChildren?: (dirPath: string) => Promise<FileTreeItem[]>
  /** Prefix for resolving a directory's absolute path (local browser root). */
  rootPath?: string
  /** When given, renders a show-hidden toggle (eye) in the tree header; the
   * parent owns the visibility state and filtering. */
  showHidden?: boolean
  onToggleHidden?: () => void
  /** When true, the header's expand/collapse-all is an icon button (the
   * local-files browser header, which keeps the title short). */
  iconActions?: boolean
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

/** The show-hidden eye toggle: an open (filled) eye when hidden files are
 * shown; a closed lid with downward lashes when hidden files are hidden. */
function EyeGlyph({ open }: { open: boolean }): ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {open ? (
        <>
          <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          <circle cx="8" cy="8" r="2.2" fill="currentColor" />
        </>
      ) : (
        /* Closed lid: a downward-hanging lid curve (corners high, middle low)
           with lashes dropping from the corners, so the lid and lashes read as
           one closed eye. */
        <>
          <path d="M2.5 6c1.2 1.4 3.2 2.3 5.5 2.3S12.3 7.4 13.5 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M3.1 7.4l-0.7 1.5M5.6 8.1l-0.4 1.7M8 8.4V10.3M10.4 8.1l0.4 1.7M12.9 7.4l0.7 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </>
      )}
    </svg>
  )
}

/** Expand/collapse-all glyph: a folder-open icon when collapsed (click to
 * expand all), a folder-close icon when any level is expanded. */
function ExpandGlyph({ open }: { open: boolean }): ReactNode {
  return open ? <IconFolderOpen16 /> : <IconFolderClose16 />
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
export function FileTree({ groups, selectedPath, onSelect, treeTitle, collapsed, onToggleCollapse, loadChildren, rootPath = '', showHidden = false, onToggleHidden, iconActions = false, t }: FileTreeProps): ReactNode {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  // Lazy sub-directory children, keyed by the directory's resolved path.
  const [lazy, setLazy] = useState<Record<string, readonly FileTreeItem[]>>({})
  // Directories whose children were requested but are still loading.
  const [lazyLoading, setLazyLoading] = useState<ReadonlySet<string>>(() => new Set())

  const roots = useMemo(
    () => groups
      .filter(group => group.items.length > 0)
      .map(group => ({
        key: group.key,
        title: group.title,
        count: group.count,
        nodes: buildNodes(group.items, rootPath),
      })),
    [groups, rootPath],
  )

  const isDirNode = (node: FileNode): boolean => node.dir || node.children.length > 0

  const childrenOf = (node: FileNode): FileNode[] => {
    // Lazy mode: a directory's sub-items come from the fetched cache once
    // loaded, superseding the (empty) static trie children. Each fetched item
    // is a single-segment sibling; build its node with name = the segment and
    // path = parent's path + name, dirPath = parent's dirPath + name — NOT by
    // re-running buildNodes (which would re-introduce the parent segment and
    // self-recurse).
    if (loadChildren !== undefined) {
      const items = lazy[node.dirPath]
      if (items !== undefined) {
        return sortNodes(items.map(item => ({
          name: item.path,
          path: node.path === '' ? item.path : `${node.path}/${item.path}`,
          dirPath: node.dirPath === '' ? item.path : `${node.dirPath}/${item.path}`,
          children: [],
          item,
          dir: item.isDir === true,
        })))
      }
    }
    return node.children
  }

  const lazyChildren = (node: FileNode): void => {
    if (loadChildren === undefined) return
    const dirPath = node.dirPath
    if (lazy[dirPath] !== undefined || lazyLoading.has(dirPath)) return
    setLazyLoading(previous => new Set(previous).add(dirPath))
    void loadChildren(dirPath).then(items => {
      setLazy(previous => ({ ...previous, [dirPath]: items }))
      setLazyLoading(previous => {
        const next = new Set(previous)
        next.delete(dirPath)
        return next
      })
    }).catch(() => {
      setLazyLoading(previous => {
        const next = new Set(previous)
        next.delete(dirPath)
        return next
      })
    })
  }

  // Current visible directory nodes (dir rows), following lazy children when
  // they've loaded. Used by expand/collapse-all.
  const collectDirNodes = (nodes: FileNode[]): FileNode[] => {
    const out: FileNode[] = []
    for (const node of nodes) {
      if (isDirNode(node)) {
        out.push(node)
        out.push(...collectDirNodes(childrenOf(node)))
      }
    }
    return out
  }

  const toggle = (path: string): void => {
    setExpanded(previous => {
      const next = new Set(previous)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }
  const expandAll = (): void => {
    // Lazy mode: expanding a directory needs its children fetched, so walk the
    // visible dirs, trigger each one's lazy load, and expand every one of them
    // (their children appear once the fetch resolves).
    const toExpand = new Set<string>()
    for (const group of roots) {
      for (const node of collectDirNodes(group.nodes)) {
        toExpand.add(node.path)
        if (loadChildren !== undefined) lazyChildren(node)
      }
    }
    setExpanded(toExpand)
  }
  const collapseAll = (): void => setExpanded(new Set())

  if (roots.length === 0 && loadChildren === undefined) {
    return <div className={css.empty}>{t('group.empty')}</div>
  }

  const renderNode = (node: FileNode, groupKey: string): ReactNode => {
    const isDir = isDirNode(node)
    const isOpen = expanded.has(node.path)
    const dirPath = node.dirPath
    if (isDir) {
      const kids = childrenOf(node)
      return (
        <div key={`${groupKey}/${node.path}`}>
          <button type="button" className={css.row} onClick={() => {
            if (!isOpen && loadChildren !== undefined) lazyChildren(node)
            toggle(node.path)
          }}>
            <span className={css.chevron}>{isOpen ? <IconChevronDownOutline14 size={18} /> : <IconChevronRightOutline14 size={18} />}</span>
            {isOpen ? <IconFolderOpen16 /> : <IconFolderClose16 />}
            <span className={css.dirName}>{node.name}</span>
          </button>
          {isOpen && (
            <div className={css.children}>
              {lazyLoading.has(dirPath) && <div className={css.lazyLoading} />}
              {kids.map(child => renderNode(child, groupKey))}
            </div>
          )}
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
          {iconActions ? (
            <>
              {onToggleHidden !== undefined && (
                <button
                  type="button"
                  className={css.treeAction}
                  title={showHidden ? t('tree.showHidden') : t('tree.hideHidden')}
                  onClick={onToggleHidden}
                >
                  <EyeGlyph open={showHidden} />
                </button>
              )}
              <button
                type="button"
                className={css.treeAction}
                title={expanded.size === 0 ? t('tree.expandAll') : t('tree.collapseAll')}
                onClick={expanded.size === 0 ? expandAll : collapseAll}
              >
                <ExpandGlyph open={expanded.size > 0} />
              </button>
            </>
          ) : (
            <button
              type="button"
              className={css.treeAction}
              onClick={expanded.size === 0 ? expandAll : collapseAll}
            >
              {expanded.size === 0 ? t('tree.expandAll') : t('tree.collapseAll')}
            </button>
          )}
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
          {group.title !== '' && (
            <div className={css.groupHeader}>
              <span className={css.groupTitle}>{group.title}</span>
              <span className={css.groupCount}>{group.count}</span>
            </div>
          )}
          {group.nodes.map(node => renderNode(node, group.key))}
        </div>
      ))}
    </div>
  )
}
