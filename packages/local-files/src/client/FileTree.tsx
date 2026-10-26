/**
 * The workspace file tree: a path trie rendered with IDE-explorer anatomy
 * (compact rows, chevron disclosure, indent guides, hover/selected
 * backgrounds — datasets' DatasetsView is the in-repo reference). The tree
 * renders the local-files browser's directory groups (git-agnostic: no change
 * status, no diff counts). Default expansion shows only the first level; every
 * node expands on demand and the header offers expand-all / collapse-all, so
 * the whole tree is always reachable. A lazily-loaded directory expands its
 * children on demand (per-level local browsing) rather than from a static
 * trie.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { IconChevronDownOutlineMedium, IconChevronRightOutlineMedium, IconFolderCloseMedium, IconFolderOpenMedium, IconPanelLeftOutlineMedium, IconSearchOutlineMedium } from './icons.tsx'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import css from './FileTree.module.css'

/** One leaf entry: its path plus optional change metadata (kept optional so a
 * caller can still pass status/counts; the local browser omits them). */
export interface FileTreeItem {
  /** Repo-relative path. */
  path: string
  /** Change status letter (undefined/' ' = plain file, e.g. the local browse). */
  status?: string | undefined
  /** Diff line counts (null = unknown/untracked; local browse omits them). */
  additions?: number | null
  deletions?: number | null
  /** Whether this entry is a directory (the local-browser trie needs this to
   *  render an expandable dir even when its children are lazily loaded). */
  isDir?: boolean
  /** Search mode: whether the entry's own basename matched the query (vs an
   * ancestor's name pulling it in through the path match). Seeds the default
   * expansion — see searchExpanded below. */
  nameMatch?: boolean
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

/** Format a number with thousands separators (1,054). Inlined from the
 * worktrees Overview so this file stays dependency-free of the git surfaces. */
function formatCount(value: number): string {
  return value.toLocaleString('en-US')
}

/** Props of the file tree. */
export interface FileTreeProps {
  /** The groups rendered as top-level disclosures. */
  groups: readonly FileTreeGroup[]
  /** The selected file path, or null. */
  selectedPath: string | null
  /** Called when a file row is clicked. */
  onSelect: (path: string) => void
  /** The tree header title (defaults to the files label). */
  treeTitle?: string
  /** When given, renders a collapse-to-rail toggle at the right of the header. */
  collapsed?: boolean
  onToggleCollapse?: () => void
  /** Optional lazy-children loader for directory rows: when a directory is
   * expanded and this is given, the dir's children are fetched once (and
   * cached) instead of coming from the static group trie. Renders the dir as
   * an expandable row even when the static trie has no children yet. Used by
   * the local-files browser (per-level browsing); static groups omit it and
   * keep the fully-built trie.
   * @param dirPath - the directory's resolved path (rootPath + relative path).
   */
  loadChildren?: (dirPath: string) => Promise<FileTreeItem[]>
  /** Prefix for resolving a directory's absolute path (local browser root). */
  rootPath?: string
  /** Keeps this tree's expansion, loaded children and scroll offset across
   * unmounts (a tab switch, a page switch) under this key. The parent keys
   * the tree by it too, so a different root or session starts fresh. */
  memoryKey?: string
  /** When given, renders a show-hidden toggle (eye) in the tree header; the
   * parent owns the visibility state and filtering. */
  showHidden?: boolean
  onToggleHidden?: () => void
  /** When true, the header's expand/collapse-all is an icon button (the
   * local-files browser header, which keeps the title short). */
  iconActions?: boolean
  /** Drop the header strip (title + actions): the caller's own panel header
   * already carries them (the compact local-files browser). The search row
   * still opens below, driven by `searchOpen`. */
  headerless?: boolean
  /** Search chrome: when onToggleSearch is given the header shows a search
   * toggle and, while open, an input row below the header. The parent owns the
   * query, runs the search, and hands the hits back through `groups` — in
   * search mode (row open + non-empty query) each fresh hit set seeds the
   * default expansion: ancestors of name hits start open so a buried hit is
   * visible, a folder that is itself a name hit starts collapsed, and every
   * row stays freely toggleable from there. */
  searchOpen?: boolean
  onToggleSearch?: () => void
  searchQuery?: string
  onSearchQuery?: (query: string) => void
  /** True while the parent's search round-trip is in flight. */
  searching?: boolean
  /** True when the host cut the walk at a cap (the hits are a subset). */
  searchTruncated?: boolean
  /** Locale-bound translator. */
  t: TranslateNS<'localFiles'>
}

/** A neutral document glyph: the official icon set has no file icon (the
 * closest, IconCodeOutlineMedium, reads as a '#'-like mark), so the tree draws its
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
export function EyeGlyph({ open }: { open: boolean }): ReactNode {
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
  return open ? <IconFolderOpenMedium /> : <IconFolderCloseMedium />
}

/** Relative time for a commit (compact form). */
/**
 * One tree's view state, kept across unmounts under its `memoryKey`: the
 * right sidebar unmounts a tab's body whenever another tab or page takes
 * over, and the tree's own state would go with it — every folder collapsed,
 * the scroll back at the top. Module level, like the content pane's scroll
 * offsets: the memory outlives the component, never the page.
 */
interface TreeMemory {
  expanded: ReadonlySet<string>
  lazy: Readonly<Record<string, readonly FileTreeItem[]>>
  scrollTop: number
}
const treeMemory = new Map<string, TreeMemory>()

/** The nearest ancestor that scrolls vertically (the tree scrolls inside its column, not itself). */
function scrollParentOf(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node !== null; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY
    if (overflow === 'auto' || overflow === 'scroll') return node
  }
  return null
}

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
export function FileTree({ groups, selectedPath, onSelect, treeTitle, collapsed, onToggleCollapse, loadChildren, rootPath = '', memoryKey, showHidden = false, onToggleHidden, iconActions = false, headerless = false, searchOpen = false, onToggleSearch, searchQuery = '', onSearchQuery, searching = false, searchTruncated = false, t }: FileTreeProps): ReactNode {
  const remembered = memoryKey === undefined ? undefined : treeMemory.get(memoryKey)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => remembered?.expanded ?? new Set())
  // Lazy sub-directory children, keyed by the directory's resolved path.
  const [lazy, setLazy] = useState<Readonly<Record<string, readonly FileTreeItem[]>>>(() => remembered?.lazy ?? {})
  // Directories whose children were requested but are still loading.
  const [lazyLoading, setLazyLoading] = useState<ReadonlySet<string>>(() => new Set())
  // Search mode: the parent filtered the groups down to the hits. Each fresh
  // hit set SEEDS the default expansion (the useLayoutEffect below); from
  // there every row toggles freely.
  const searchActive = searchOpen && searchQuery.trim() !== ''
  const [searchExpanded, setSearchExpanded] = useState<ReadonlySet<string>>(() => new Set())

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

  // Seed search-mode expansion from each fresh hit set (a new `roots` identity
  // while searchActive). A dir starts open iff its subtree holds a name hit
  // BELOW it: a file the query named is revealed through its ancestor chain,
  // while a folder the query named starts collapsed — its contents are
  // path-dragged-along hits, shown on demand. Layout effect so the seeded
  // state paints with the results, never one frame collapsed.
  useLayoutEffect(() => {
    if (!searchActive) {
      setSearchExpanded(new Set())
      return
    }
    const seed = new Set<string>()
    // Returns whether the subtree rooted at node contains a name hit
    // (counting the node itself); seeds every dir with a hit BELOW it.
    const walk = (node: FileNode): boolean => {
      let descendantHit = false
      for (const child of node.children) {
        descendantHit = walk(child) || descendantHit
      }
      if (descendantHit && isDirNode(node)) seed.add(node.path)
      return descendantHit || node.item?.nameMatch === true
    }
    for (const group of roots) {
      for (const node of group.nodes) walk(node)
    }
    setSearchExpanded(seed)
  }, [roots, searchActive])

  const childrenOf = (node: FileNode): FileNode[] => {
    // Search mode: a hit-path ancestor renders ONLY its hit chain — the lazy
    // cache holds the full listing, which would defeat the filter.
    if (searchActive && node.children.length > 0) return node.children
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

  // Remember the view under the key as it changes; the scroll offset is
  // tracked by its own listener below.
  const rootRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (memoryKey === undefined) return
    treeMemory.set(memoryKey, { expanded, lazy, scrollTop: treeMemory.get(memoryKey)?.scrollTop ?? 0 })
  }, [memoryKey, expanded, lazy])
  // Restore the scroll offset before paint (the remembered children are
  // already rendered, so the height is right), then follow the user's scroll.
  useLayoutEffect(() => {
    if (memoryKey === undefined || rootRef.current === null) return undefined
    const scroller = scrollParentOf(rootRef.current)
    if (scroller === null) return undefined
    const saved = treeMemory.get(memoryKey)?.scrollTop
    if (saved !== undefined && saved > 0) scroller.scrollTop = saved
    const onScroll = (): void => {
      const entry = treeMemory.get(memoryKey)
      if (entry !== undefined) entry.scrollTop = scroller.scrollTop
      else treeMemory.set(memoryKey, { expanded: new Set(), lazy: {}, scrollTop: scroller.scrollTop })
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [memoryKey])
  // A restored tree paints from memory, then re-lists every folder it shows
  // open, so what changed on disk while the tab was away shows up.
  useEffect(() => {
    if (loadChildren === undefined || remembered === undefined) return
    for (const path of remembered.expanded) {
      const dirPath = rootPath === '' ? path : `${rootPath}/${path}`
      if (remembered.lazy[dirPath] === undefined) continue
      void loadChildren(dirPath).then(
        (items) => { setLazy(previous => ({ ...previous, [dirPath]: items })) },
        () => undefined,
      )
    }
    // Mount only: a key change remounts the tree (the parent keys it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggle = (path: string): void => {
    const apply = (previous: ReadonlySet<string>): Set<string> => {
      const next = new Set(previous)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    }
    // Search-mode rows ride the seeded set; the normal tree keeps its own.
    if (searchActive) setSearchExpanded(apply)
    else setExpanded(apply)
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
    return <div className={css.empty}>{t('local.empty')}</div>
  }

  const renderNode = (node: FileNode, groupKey: string): ReactNode => {
    const isDir = isDirNode(node)
    const isOpen = searchActive ? searchExpanded.has(node.path) : expanded.has(node.path)
    const dirPath = node.dirPath
    if (isDir) {
      const kids = childrenOf(node)
      return (
        <div key={`${groupKey}/${node.path}`}>
          <button type="button" className={css.row} onClick={() => {
            // A search-mode dir with hit children renders from the static
            // trie — no fetch; a hit dir WITHOUT trie children lazy-loads.
            if (!isOpen && loadChildren !== undefined && !(searchActive && node.children.length > 0)) lazyChildren(node)
            toggle(node.path)
          }}>
            <span className={css.chevron}>{isOpen ? <IconChevronDownOutlineMedium size={18} /> : <IconChevronRightOutlineMedium size={18} />}</span>
            {isOpen ? <IconFolderOpenMedium /> : <IconFolderCloseMedium />}
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
    <div ref={rootRef} className={css.tree}>
      {!headerless && <div className={css.treeHeader}>
        <span className={css.treeTitle}>{treeTitle ?? t('tree.changedFilesTitle')}</span>
        <span className={css.treeActions}>
          {onToggleSearch !== undefined && (
            <button
              type="button"
              className={`${css.treeAction} ${searchOpen ? css.treeActionActive : ''}`}
              title={searchOpen ? t('tree.closeSearch') : t('tree.search')}
              aria-pressed={searchOpen}
              onClick={onToggleSearch}
            >
              <IconSearchOutlineMedium />
            </button>
          )}
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
              {/* Expand/collapse-all is a whole-tree gesture: meaningless
                  against a filtered hit list, so search mode hides it. */}
              {!searchActive && (
                <button
                  type="button"
                  className={css.treeAction}
                  title={expanded.size === 0 ? t('tree.expandAll') : t('tree.collapseAll')}
                  onClick={expanded.size === 0 ? expandAll : collapseAll}
                >
                  <ExpandGlyph open={expanded.size > 0} />
                </button>
              )}
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
              <IconPanelLeftOutlineMedium />
            </button>
          )}
        </span>
      </div>}
      {searchOpen && (
        <div className={css.searchRow}>
          <input
            type="search"
            className={css.searchInput}
            placeholder={t('tree.searchPlaceholder')}
            aria-label={t('tree.searchPlaceholder')}
            value={searchQuery}
            autoFocus
            onChange={event => { onSearchQuery?.(event.target.value) }}
            onKeyDown={event => {
              if (event.key !== 'Escape') return
              if (searchQuery === '') onToggleSearch?.()
              else onSearchQuery?.('')
            }}
          />
        </div>
      )}
      {searchActive && searching && <div className={css.lazyLoading} />}
      {searchActive && !searching && roots.length === 0 && (
        <div className={css.empty}>{t('tree.searchNoMatch')}</div>
      )}
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
      {searchActive && searchTruncated && (
        <div className={css.searchHint}>{t('tree.searchTruncated')}</div>
      )}
    </div>
  )
}
