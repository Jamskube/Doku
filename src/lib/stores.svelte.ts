import type { EditorView } from '@codemirror/view'
import { DEMO_TABS } from './demo'

export type DocKind = 'md' | 'html' | 'txt'
export type SidebarView = 'files' | 'plan' | 'history'

export interface DocTab {
  id: number
  name: string
  path: string | null
  kind: DocKind
  content: string
  savedContent: string
}

let nextId = 1

export const app = $state({
  theme: 'light' as 'light' | 'dark',
  pinned: false,
  sidebarOpen: true,
  sidebarView: 'files' as SidebarView,
  sourceMode: false,
  tabs: [] as DocTab[],
  activeId: 0,
})

// Accès non réactif à la vue CM6 courante (scroll TOC, sauvegarde…)
export const editorRef: { view: EditorView | null } = { view: null }

export function initApp() {
  const saved = localStorage.getItem('doku-theme')
  if (saved === 'dark' || saved === 'light') app.theme = saved
  applyTheme()
  if (app.tabs.length === 0) {
    for (const d of DEMO_TABS) openTab(d.name, d.path, d.content, d.kind)
    app.activeId = app.tabs[0]?.id ?? 0
  }
}

export function applyTheme() {
  document.documentElement.dataset.theme = app.theme
}

export function toggleTheme() {
  app.theme = app.theme === 'dark' ? 'light' : 'dark'
  localStorage.setItem('doku-theme', app.theme)
  applyTheme()
}

export function activeTab(): DocTab | undefined {
  return app.tabs.find((t) => t.id === app.activeId)
}

export function isDirty(tab: DocTab): boolean {
  return tab.content !== tab.savedContent
}

export function kindFromName(name: string): DocKind {
  const ext = name.split('.').pop()?.toLowerCase()
  if (ext === 'html' || ext === 'htm') return 'html'
  if (ext === 'md' || ext === 'markdown') return 'md'
  return 'txt'
}

export function openTab(name: string, path: string | null, content: string, kind?: DocKind): DocTab {
  const existing = path ? app.tabs.find((t) => t.path === path) : undefined
  if (existing) {
    app.activeId = existing.id
    return existing
  }
  const tab: DocTab = {
    id: nextId++,
    name,
    path,
    kind: kind ?? kindFromName(name),
    content,
    savedContent: content,
  }
  app.tabs.push(tab)
  app.activeId = tab.id
  return tab
}

export function closeTab(id: number) {
  const idx = app.tabs.findIndex((t) => t.id === id)
  if (idx === -1) return
  app.tabs.splice(idx, 1)
  if (app.activeId === id) {
    const next = app.tabs[Math.min(idx, app.tabs.length - 1)]
    app.activeId = next?.id ?? 0
  }
}

export function cycleTab(dir: 1 | -1) {
  if (app.tabs.length < 2) return
  const idx = app.tabs.findIndex((t) => t.id === app.activeId)
  const next = app.tabs[(idx + dir + app.tabs.length) % app.tabs.length]
  app.activeId = next.id
}

export function toggleSidebarView(view: SidebarView) {
  if (app.sidebarView === view && app.sidebarOpen) {
    app.sidebarOpen = false
  } else {
    app.sidebarView = view
    app.sidebarOpen = true
  }
}

export interface Heading {
  level: number
  text: string
  line: number
}

export function docHeadings(content: string): Heading[] {
  const out: Heading[] = []
  const lines = content.split('\n')
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (/^(```|~~~)/.test(l)) inFence = !inFence
    if (inFence) continue
    const m = /^(#{1,3})\s+(.+)$/.exec(l)
    if (m) out.push({ level: m[1].length, text: m[2].trim(), line: i + 1 })
  }
  return out
}

export function scrollToLine(line: number) {
  const view = editorRef.view
  if (!view) return
  const docLine = view.state.doc.line(Math.min(line, view.state.doc.lines))
  view.dispatch({
    selection: { anchor: docLine.from },
    effects: [],
    scrollIntoView: true,
  })
  view.focus()
}
