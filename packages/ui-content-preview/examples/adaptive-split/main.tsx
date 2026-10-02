import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AdaptiveSplit } from '../../src/client/AdaptiveSplit.tsx'
import './preview.css'

function Preview() {
  const [width, setWidth] = useState(390)
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState('README.md')
  const [expanded, setExpanded] = useState(true)
  const [query, setQuery] = useState('')
  return <main><h1>移动面板 · 真实组件预览</h1><p>布局使用分支中的 AdaptiveSplit；文件和内容为演示数据，不连接会话。</p>
    <label>面板宽度 {width}px <input aria-label="面板宽度" type="range" min="320" max="900" value={width} onChange={event => setWidth(+event.target.value)}/></label>
    <section className="panel" style={{ width }} aria-label="文件面板">
      <header><strong>文件列表</strong><span>dsh-plugins</span></header>
      <AdaptiveSplit detailOpen={open} onBack={() => setOpen(false)} backLabel="文件列表"
        master={<div className="files"><input aria-label="筛选文件" placeholder="筛选文件" value={query} onChange={e => setQuery(e.target.value)}/><button aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '⌄' : '›'} docs</button>{expanded && ['README.md', 'mobile-plan.md', 'canvas.md'].filter(name => name.includes(query)).map(name => <button key={name} aria-pressed={file === name} onClick={() => { setFile(name); setOpen(true) }}>{name}</button>)}</div>}
        detail={<article><h2>{file}</h2><p>窄屏整页阅读，宽屏并列显示。返回和调整宽度不会卸载两侧组件。</p><label>临时草稿<textarea defaultValue="返回文件列表，再打开；这段内容仍然保留。"/></label></article>}/>
    </section>
  </main>
}
createRoot(document.getElementById('app')!).render(<Preview />)
