export const ORDINARY_TITLE = '[data-slot="main.conversation"] header:has([data-conversation-header-corner]) nav:has(> span:only-child > button:disabled + [data-slot="conversation.session.header.lineage"]:empty)'
/** Local overrides target official slot anchors; frame attributes are verified before activation. */
export const MOBILE_CSS = `
html[data-dsh-mobile] { --mobile-bar: 56px; --mobile-accent: #4d6bfe; }
html[data-dsh-mobile] body { overscroll-behavior: none; }
html[data-dsh-mobile] [data-mobile-frame] {
  box-sizing: border-box; height: var(--mobile-height, 100dvh) !important;
  padding-top: var(--mobile-bar); padding-bottom: env(safe-area-inset-bottom, 0px);
  grid-template-columns: 0px minmax(0, 1fr) 0px !important;
  grid-template-rows: minmax(0, 1fr); transition: none !important;
}
html[data-dsh-mobile] [data-mobile-frame] > div:has(> [data-slot="sidebar"]) {
  position: absolute; inset: var(--mobile-bar) auto 0 0; z-index: 22;
  width: min(88vw, 360px); border-radius: 0 24px 24px 0;
  box-shadow: 16px 0 60px #15244320;
}
html[data-dsh-mobile] [data-mobile-frame][data-sidebar-collapsed] > div:has(> [data-slot="sidebar"]) { display: none; }
html[data-dsh-mobile] [data-mobile-frame] > div:has(> [data-slot="main"]) { grid-column: 2; grid-row: 1; min-width: 0; }
html[data-dsh-mobile] [data-mobile-frame] > [data-rightbar-col] { grid-column: 3; grid-row: 1; }
html[data-dsh-mobile] [data-mobile-frame]:not([data-rightbar-collapsed]) > [data-rightbar-col] {
  position: absolute; inset: var(--mobile-bar) 0 0; z-index: 24; width: 100%;
  background: var(--dsw-alias-bg-base, white); min-width: 0;
}
html[data-dsh-mobile] [data-mobile-frame] > [data-side] { display: none; }
html[data-dsh-mobile] [data-mobile-frame] > [data-shell-overlay] { z-index: 23; pointer-events: none; }
html[data-dsh-mobile] [data-slot="main.conversation"] > div {
  --dsh-chat-content-width: calc(100vw - 48px);
  --dsh-composer-side-clearance: 12px;
}
html[data-dsh-mobile] [data-composer-card] { border-radius: 24px; }
html[data-dsh-mobile] [data-composer-card] [contenteditable="true"] { font-size: 16px; }
html[data-dsh-mobile] [data-width-handle] { display: none; }
html[data-dsh-mobile] [data-composer-seat] { padding-bottom: 8px; }
html[data-dsh-mobile] [data-conversation-scroll] { overscroll-behavior-y: contain; }
html[data-dsh-mobile] [data-slot="conversation.header.tabs"] { overflow-x: auto; }
html[data-dsh-mobile] [data-slot="conversation.input.left"],
html[data-dsh-mobile] [data-slot="conversation.input.right"] { max-width: 100%; }
[data-mobile-toolbar] {
  position: absolute; inset: 0 0 auto; height: var(--mobile-bar, 56px); display: flex;
  align-items: center; justify-content: space-between; gap: 8px; padding: 0 12px;
  box-sizing: border-box; background: var(--dsw-alias-bg-base, #fff);
  border-bottom: 1px solid var(--dsw-alias-border-l3, #edf0f5); pointer-events: auto;
}
[data-mobile-toolbar] button, [data-mobile-dialog] button {
  border: 0; border-radius: 16px; min-height: 44px; min-width: 44px;
  padding: 10px 14px; font: inherit; cursor: pointer;
  color: var(--dsw-alias-label-primary, #152443); background: transparent;
  -webkit-tap-highlight-color: transparent;
}
[data-mobile-toolbar] button:hover, [data-mobile-dialog] button:hover { background: #4d6bfe12; }
[data-mobile-toolbar] strong { font-size: 18px; font-weight: 600; letter-spacing: -0.6px; color: var(--mobile-accent, #4d6bfe); }
[data-mobile-toolbar] small { color: var(--dsw-alias-label-tertiary, #778195); font-size: 11px; display: block; text-align: center; }
[data-mobile-toolbar] svg { display: block; }
[data-mobile-shade] { position: absolute; inset: var(--mobile-bar) 0 0 min(88vw, 360px); border: 0; background: #15244330; pointer-events: auto; }
[data-mobile-dialog] {
  color: var(--dsw-alias-label-primary, #152443); background: var(--dsw-alias-bg-base, white);
  border: 1px solid var(--dsw-alias-border-l3, #e6eaf2); border-radius: 28px;
  width: min(440px, calc(100vw - 32px)); box-sizing: border-box; padding: 24px;
  max-height: calc(100dvh - 48px); overflow-y: auto; box-shadow: 0 24px 90px #15244325;
}
[data-mobile-dialog] input { box-sizing: border-box; width: 100%; margin-top: 12px; padding: 14px; border: 1px solid #ccd3df; border-radius: 14px; font: inherit; font-size: 16px; }
[data-mobile-dialog] button:disabled { opacity: .4; cursor: default; }
[data-mobile-dialog]::backdrop { background: #15244355; backdrop-filter: blur(8px); }
[data-mobile-dialog] h2 { margin: 0 0 24px; font-size: 24px; font-weight: 500; }
[data-mobile-dialog] h3 { font-size: 13px; font-weight: 500; color: var(--dsw-alias-label-tertiary, #778195); margin: 24px 0 10px; }
[data-mobile-dialog] p { font-size: 13px; line-height: 1.7; color: var(--dsw-alias-label-tertiary, #778195); overflow-wrap: anywhere; }
[data-mobile-dialog] [role="group"] { display: flex; flex-wrap: wrap; gap: 6px; }
[data-mobile-dialog] button[aria-pressed="true"] { color: #4d6bfe; background: #4d6bfe12; }
[data-mobile-dialog] [data-mobile-done] { display: block; width: 100%; margin-top: 24px; background: #4d6bfe; color: white; border-radius: 100px; }

/* Only the checked rc1 single, ordinary breadcrumb is redundant with our title.
   Keep child lineage, ancestor navigation, actions, utilities and tabs untouched. */
html[data-dsh-mobile]:has([data-mobile-session-title]) ${ORDINARY_TITLE} { display:none; }
[data-mobile-restore] { position:fixed; right:16px; bottom:max(16px,env(safe-area-inset-bottom)); z-index:1200; pointer-events:auto; min-height:44px; padding:10px 18px; border:1px solid #4d6bfe40; border-radius:24px; background:var(--dsw-alias-bg-base,white); color:#4d6bfe; font:inherit; box-shadow:0 3px 18px #15244318; }

/* Mobile-owned library: scrolling content and a separate keyboard-aware search dock. */
[data-mobile-library] { position:absolute; inset:var(--mobile-bar,56px) 0 0; display:flex; flex-direction:column; overflow:hidden; pointer-events:auto; background:var(--dsw-alias-bg-base,white); color:var(--dsw-alias-label-primary,#181a20); }
[data-mobile-library] button { font:inherit; cursor:pointer; color:inherit; -webkit-tap-highlight-color:transparent; }
[data-mobile-library-header] { display:flex; align-items:center; justify-content:space-between; flex-shrink:0; gap:12px; padding:12px 22px 14px; }
[data-mobile-library] h1 { margin:0; font-size:30px; font-weight:600; letter-spacing:-1px; }
[data-mobile-grouping] { display:flex; padding:3px; border-radius:13px; background:var(--dsw-alias-bg-l1,#f2f3f6); }
[data-mobile-grouping] button { border:0; border-radius:10px; min-height:44px; padding:0 12px; font-size:12px; background:none; }
[data-mobile-grouping] button[aria-pressed=true] { background:var(--dsw-alias-bg-base,white); box-shadow:0 1px 4px #17203815; }
[data-mobile-recents] { flex:1; min-height:0; overflow-y:auto; padding:0 22px 12px; overscroll-behavior:contain; }
[data-mobile-session-group] h2 { color:var(--dsw-alias-label-tertiary,#727680); font-size:12px; font-weight:500; margin:16px 0 4px; }
[data-mobile-session-group] ul { list-style:none; padding:0; margin:0; }
[data-mobile-workspace-group] { display:grid; grid-template-columns:18px minmax(0,1fr) auto 18px; align-items:center; width:100%; gap:9px; padding:14px 0; min-height:48px; text-align:left; background:none; border:0; }
[data-mobile-workspace-group] svg { display:block; }
[data-mobile-workspace-group] strong, [data-mobile-workspace-group] small { line-height:20px; margin:0; }
[data-mobile-workspace-group] strong { min-width:0; overflow-wrap:anywhere; font-size:14px; font-weight:500; }
[data-mobile-workspace-group] small { color:var(--dsw-alias-label-tertiary,#727680); font-size:12px; }
[data-mobile-session] { display:flex; align-items:center; gap:12px; width:100%; min-height:78px; padding:16px 0; text-align:left; border:0; border-bottom:1px solid var(--dsw-alias-border-l3,#e8e9ee); background:none; }
[data-mobile-session-copy] { min-width:0; flex:1; }
[data-mobile-session-copy] strong { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:16px; line-height:1.5; font-weight:500; }
[data-mobile-session-copy] small { display:block; color:var(--dsw-alias-label-tertiary,#727680); font-size:12px; margin-top:6px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
[data-mobile-session] time { font-size:11px; color:var(--dsw-alias-label-tertiary,#727680); flex-shrink:0; }
[data-mobile-session]:active { background:#4d6bfe0a; }
[data-mobile-activity] { font-size:11px; color:var(--mobile-accent,#4d6bfe); white-space:nowrap; }
[data-mobile-activity]::before { content:''; display:inline-block; width:5px; height:5px; margin-right:5px; vertical-align:middle; border-radius:50%; background:currentColor; }
[data-mobile-empty] { color:var(--dsw-alias-label-tertiary,#727680); padding:32px 0; text-align:center; font-size:14px; }
[data-mobile-search-dock] { display:flex; flex-shrink:0; align-items:center; gap:10px; padding:12px 16px max(10px,env(safe-area-inset-bottom)); background:var(--dsw-alias-bg-base,white); }
[data-mobile-search] { display:flex; flex:1; min-width:0; align-items:center; gap:8px; min-height:50px; border:1px solid var(--dsw-alias-border-l3,#e8e9ee); border-radius:28px; padding:0 16px; background:var(--dsw-alias-bg-l1,#f2f3f6); color:var(--dsw-alias-label-tertiary,#727680); }
[data-mobile-search] svg { flex-shrink:0; }
[data-mobile-search] input { width:100%; min-width:0; border:0; background:none; color:var(--dsw-alias-label-primary,#181a20); font:inherit; font-size:16px; padding:12px 0; }
[data-mobile-search]:focus-within { outline:2px solid #4d6bfe65; outline-offset:2px; }
[data-mobile-scan] { display:grid; place-items:center; width:50px; height:50px; flex-shrink:0; border:1px solid var(--dsw-alias-border-l3,#e8e9ee); background:var(--dsw-alias-bg-l1,#f2f3f6); border-radius:50%; }
[data-mobile-search-cancel] { min-height:50px; min-width:44px; color:var(--mobile-accent,#4d6bfe) !important; background:none; border:0; font-size:14px; }
[data-mobile-nav-title] { flex:1; min-width:0; text-align:center; }
[data-mobile-nav-title] strong { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--dsw-alias-label-primary,#181a20); font-size:16px; }
html[data-dsh-mobile] [data-mobile-toolbar] { border-bottom:0; padding:0 12px; }
[data-mobile-toolbar] button { color:var(--mobile-accent,#4d6bfe); }
[data-mobile-connection-status] { position:absolute; top:var(--mobile-bar); left:12px; right:12px; display:flex; align-items:center; justify-content:space-between; gap:12px; border-radius:12px; padding:0 12px; font-size:12px; background:var(--dsw-alias-bg-l1,#f2f3f6); pointer-events:auto; z-index:1; }
[data-mobile-connection-status] button { border:0; background:none; color:var(--mobile-accent,#4d6bfe); min-height:40px; }
html[data-dsh-mobile]:has([data-mobile-connection-status]) { --mobile-bar:96px; }
html[data-dsh-mobile]:has([data-mobile-connection-status]) [data-mobile-toolbar] { height:56px; }
html[data-dsh-mobile]:has([data-mobile-connection-status]) [data-mobile-connection-status] { top:56px; }
[data-mobile-dialog] { margin:auto 0 0; width:100%; max-width:none; max-height:75dvh; border-radius:26px 26px 0 0; padding-bottom:max(24px,env(safe-area-inset-bottom)); }
[data-mobile-dialog] [data-mobile-option] { width:100%; display:block; text-align:left; border-radius:0; border-bottom:1px solid var(--dsw-alias-border-l3,#e8e9ee); padding:14px 0; }
/* Preserve the official composer, controls, confirmations and message actions. */
html[data-dsh-mobile] [data-composer-card] { border-radius:20px; box-shadow:none; background:var(--dsw-alias-bg-l1,#f2f3f6); }
html[data-dsh-mobile] [data-composer-card] [data-input-scroll] { max-height:min(28dvh,220px); }
html[data-dsh-mobile] [data-composer-card] > div:last-child { flex-wrap:wrap; gap:8px; }
html[data-dsh-mobile] [data-composer-card] > div:last-child > div { flex-wrap:wrap; min-width:0; gap:6px; }
html[data-dsh-mobile] [data-composer-card] > div:last-child > div:last-child { margin-left:auto; }
html[data-dsh-mobile] [data-composer-card] > div:last-child button { min-height:44px; }
html[data-dsh-mobile] [data-slot="conversation.input.model"] { min-width:0; max-width:min(62vw,270px); }
/* Dock the same blank-session composer; the checked hero mark anchors its optional headline. */
html[data-dsh-mobile] [data-slot="main.conversation"] [data-phase="hero"] [data-conversation-scroll] { justify-content:flex-end; }
html[data-dsh-mobile] [data-slot="main.conversation"] [data-phase="hero"] [data-composer-seat] { flex:1; min-height:0; }
html[data-dsh-mobile] [data-phase="hero"] [data-composer-seat] > div:has([data-slot="conversation.hero.brand.mark"]) { flex:1; align-self:stretch; padding-bottom:8px; }
html[data-dsh-mobile] [data-phase="hero"] [data-composer-seat] > div > div:first-child:has([data-slot="conversation.hero.brand.mark"]) { flex:1; min-height:100px; justify-content:center; }
/* rc1 semantic menu anchors, only inside the official composer/hero seats. */
html[data-dsh-mobile] :is([data-composer-card],[data-slot="conversation.hero.agentPreset"],[data-slot="conversation.hero.workspace"]) [role="menu"]:not([role="menu"] [role="menu"]) {
  position:fixed !important; inset:auto 12px max(12px,env(safe-area-inset-bottom)) !important; width:auto !important; min-width:0; max-width:none; max-height:min(65dvh,520px); overflow-y:auto; border-radius:24px; padding:12px; z-index:1100;
}
html[data-dsh-mobile] :is([data-composer-card],[data-slot="conversation.hero.agentPreset"],[data-slot="conversation.hero.workspace"]) [role="menuitem"] { min-height:48px; }
@media (prefers-reduced-motion: reduce) { [data-mobile-frame] * { scroll-behavior:auto !important; } }
`
