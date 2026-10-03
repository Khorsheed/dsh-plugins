import { useEffect, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { DockController, DockLayout, getPane } from '@deepseek-ai/dsh-client-ui-dockkit'
import { MobilePanels } from '../../src/client/panels.ts'
import { MobilePanelEntry, MobilePanelNavigation } from '../../src/client/MobilePanelNavigation.tsx'
import { MOBILE_CSS } from '../../src/client/styles.ts'
import { zh as mobileZh } from '../../src/client/locales.ts'
import { Files, Worktrees } from './file-fixtures.tsx'
import { LinkView } from '../../../canvas/src/client/space/LinkView.tsx'
import { zh as canvasZh } from '../../../canvas/src/client/locales.ts'
import { defaultCategories } from '../../../canvas/src/types.ts'
import frameCss from 'preview-host-frame'
import panelCss from 'preview-host-panel'
import './preview.css'
const t = (key: string) => mobileZh[key] ?? key
const ct = (key: string, params = {}) => (canvasZh[key] ?? key).replace(/\{(\w+)\}/g, (match, name) => params[name] ?? match)
const seed = id => ({ id, kind: 'guide', contentId: 'guide', title: '面板首页' })
const dock = new DockController({ makeInitialTab: seed, makePaneTab: seed })
const names = { guide: '面板首页', files: '文件列表', worktrees: '工作树', canvas: '画布' }
const open = kind => dock.openContent({ kind, contentId: kind, title: names[kind] })
dock.setExpanded(true)
const panels = new MobilePanels(document)
const state = () => dock.getSnapshot().state
panels.set({ mounted: { getSnapshot: () => 'preview', subscribe: dock.subscribe }, openTabs: { subscribe: dock.subscribe },
  isExpanded: () => state().expanded, toggleExpanded: () => dock.toggleExpanded(),
  active: () => state().tabs[getPane(state(), state().activePaneId).activeTabId],
  tabsIn: () => Object.values(state().tabs), focus: id => dock.focusTab(id), close: id => dock.closeTab(id), openTab: open,
})
const intents = Object.fromEntries(['focusTab','focusPane','splitPane','addTab','closeTab','duplicateTab','floatTab','unfloatPane','placeTab','dropTab','moveFloat','resizeFloat','resizeSplit'].map(key => [key, (...args) => dock[key](...args)]))
const labels = { emptyPane:'空面板', splitPane:'拆分', splitPaneDisabled:'已达上限', splitPaneNarrow:'宽度不足', closeTab:'关闭', addTab:'添加', dockFloat:'停靠', closeFloat:'关闭浮窗', dropZone:{center:'移入',left:'左',right:'右',top:'上',bottom:'下'} }
const now = '2026-10-02T00:00:00Z'
const initial = { id:'canvas_preview',title:'Mobile sidebar 设计',attachedWorkspaces:[],chat:{sessionId:null},categories:defaultCategories(),manuscripts:[],archivedAt:null,createdAt:now,updatedAt:now,stats:{proposed:{accepted:0,rejected:0},kindCounts:{},lastActiveAt:now},
 cards:[['c1','通用面板外壳',30,55],['c2','保留原插件内容',255,70],['c3','点选两张卡片连线',80,240]].map(([id,text,x,y]) => ({id,text,x,y,kind:'fragment',status:'kept',comments:[],createdBy:'user',createdAt:now,updatedAt:now})),
 links:[{from:'c1',to:'c2'}],lanes:[{id:'lane_demo',label:'移动端适配',x:15,y:35,w:460,h:320}] }
function Canvas() {
 const [board,setBoard] = useState(initial),[selected,setSelected] = useState(new Set<string>()),[detail,setDetail] = useState<string|null>(null),[toast,setToast] = useState('')
 return <div className="canvasBody" data-mobile-gesture-owner><div className="canvasTitle">Mobile sidebar 设计 <small>真实 LinkView · 样例数据</small></div><div className="canvasStage" hidden={!!detail}><LinkView t={ct} readonly={false} board={board} labels={new Map([['fragment','灵感']])} selection={selected} onToggleSelect={id => setSelected(old => {const next=new Set(old);next.has(id)?next.delete(id):next.add(id);return next})} onAddSelection={ids => setSelected(old => new Set([...old,...ids]))} onClearSelection={() => setSelected(new Set())} onOpenDetail={setDetail} talkAvailable={false} onTalk={()=>{}} onWrite={()=>{}} onToast={setToast} onLayout={patch => setBoard(old => ({...old,...(patch.links?{links:patch.links}:{}),...(patch.lanes?{lanes:patch.lanes}:{}),cards:old.cards.map(card=>({...card,...patch.positions?.find(pos=>pos.id===card.id)}))}))}/></div>{detail && <article><button onClick={()=>setDetail(null)}>← 返回画布</button><h2>编辑卡片</h2><textarea value={board.cards.find(card=>card.id===detail)?.text ?? ''} onChange={event=>setBoard(old=>({...old,cards:old.cards.map(card=>card.id===detail?{...card,text:event.target.value}:card)}))}/><p>此预览编辑直接保存在内存中；正式插件继续使用原有保存流程。</p></article>}{toast && <output>{toast}</output>}</div>
}
function App() {
 const snapshot=useSyncExternalStore(dock.subscribe,dock.getSnapshot),[mobile,setMobile]=useState(true),[width,setWidth]=useState(390),[track,setTrack]=useState(false),[hero,setHero]=useState(true),[dark,setDark]=useState(true)
 useEffect(()=>{document.documentElement.toggleAttribute('data-dsh-mobile',mobile)},[mobile])
 useEffect(()=>{document.body.dataset.previewTheme=dark?'dark':'light'},[dark])
 return <><style>{MOBILE_CSS}</style><main className="review"><h1>移动端面板 · 组件预览</h1><p>真实面板导航、宿主 DockLayout、文件浏览器、工作树与画布连线组件。样例数据仅保留在当前页面，不连接生产实例。</p><div className="controls"><label><input type="checkbox" checked={dark} onChange={e=>setDark(e.target.checked)}/>深色预览</label><button onClick={()=>setMobile(!mobile)}>{mobile?'查看桌面布局':'查看移动布局'}</button><button onClick={()=>dock.floatTab(getPane(state(),state().activePaneId).activeTabId)}>浮动当前面板</button><label><input type="checkbox" checked={track} onChange={e=>setTrack(e.target.checked)}/>保留右侧栏宽度</label><label><input type="checkbox" checked={hero} onChange={e=>setHero(e.target.checked)}/>新建会话</label><label>宽度 {width}px <input type="range" min="320" max="960" value={width} onChange={event=>setWidth(+event.target.value)}/></label></div><div className={`device ${frameCss.frame}`} style={{width,'--mobile-height':'720px'} as React.CSSProperties} data-mobile-frame data-rightbar-collapsed={!track || !snapshot.state.expanded || undefined}>
 <div className={frameCss.centerCol}><div data-slot="main"><div data-phase={hero ? "hero" : "conversation"}><article><button data-sidebar-right-expand onClick={()=>dock.toggleExpanded()}>宿主面板入口</button><h2>聊天页面</h2><p>右上角面板按钮可返回工作面板。</p><textarea placeholder="聊天草稿也会保留"/></article></div></div></div>
 <div className={frameCss.rightbarCol} data-rightbar-col><div className={panelCss.session}><div className={panelCss.panel} style={{width:"100vw","--dsh-sidebar-width":"100vw"} as React.CSSProperties} data-sidebar-right-panel="fullscreen" data-sidebar-right-session="preview" data-sidebar-right-open={snapshot.state.expanded || undefined}><div className={panelCss.panelBody}><DockLayout state={snapshot.state} canSplit={snapshot.canSplit} intents={intents} labels={labels} active={snapshot.state.expanded} keepMounted={()=>true} renderTab={tab=>tab.kind==='files'?<Files/>:tab.kind==='worktrees'?<Worktrees/>:tab.kind==='canvas'?<Canvas/>:<article><h2>面板首页</h2>{['files','worktrees','canvas'].map(kind=><button className="guide" key={kind} onClick={()=>open(kind)}>{names[kind]} →</button>)}</article>}/></div></div></div></div>
 <div data-shell-overlay><nav data-mobile-toolbar data-library={false}><span>←</span><b>Mobile 适配讨论</b><div data-mobile-header-actions><MobilePanelEntry panels={panels} t={t} beforeOpen={()=>{}}/><button data-mobile-new="true" aria-label="新建会话">＋</button></div></nav><MobilePanelNavigation panels={panels} active={mobile} prepareNavigation={()=>{}} t={t}/></div></div><p>可体验：切换面板、＋打开首页、文件详情返回、画布平移/选卡/移动/连线、缩放和删除连线。桌面模式可拆分与浮动，再切回移动模式检查布局保留。</p></main></>
}
createRoot(document.getElementById('root')!).render(<App/> )
