import type { EditorView } from '@codemirror/view'
import { DEMO_TABS } from './demo'
import { detectLineEnding } from './editor/editor'
import { baseName } from './explorer'
import { isTauri, readTextFileAt, writeTextFileAtomic } from './tauri'

export type DocKind = 'md' | 'html' | 'txt'
export type SidebarView = 'files' | 'plan' | 'history'

export interface DocTab {
  id: number
  name: string
  path: string | null
  kind: DocKind
  content: string
  savedContent: string
  eol: '\n' | '\r\n'
}

let nextId = 1

export const app = $state({
  theme: 'light' as 'light' | 'dark',
  pinned: false,
  // Masquée par défaut (app « légère » — FR-6) ; l'état est persisté (settings).
  sidebarOpen: false,
  sidebarView: 'files' as SidebarView,
  sourceMode: false,
  tabs: [] as DocTab[],
  activeId: 0,
  // Dossier affiché par l'explorateur ; null = suit le dossier du document actif.
  explorerDir: null as string | null,
  // Bannière d'information transitoire (ex. fichiers de session introuvables).
  banner: null as string | null,
})

// Accès non réactif à la vue CM6 courante (scroll TOC, sauvegarde…)
export const editorRef: { view: EditorView | null } = { view: null }

const SETTINGS_KEY = 'doku-settings'

// Préférences persistées (thème, état sidebar) — localStorage, survit aux
// relancements du webview Tauri. Chargé dès l'import, avant tout composant.
export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) {
      const s = JSON.parse(raw)
      if (s.theme === 'dark' || s.theme === 'light') app.theme = s.theme
      if (typeof s.sidebarOpen === 'boolean') app.sidebarOpen = s.sidebarOpen
      if (s.sidebarView === 'files' || s.sidebarView === 'plan' || s.sidebarView === 'history') {
        app.sidebarView = s.sidebarView
      }
    }
  } catch {
    // settings corrompus/indisponibles : valeurs par défaut
  }
  applyTheme()
}

export function saveSettings() {
  try {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ theme: app.theme, sidebarOpen: app.sidebarOpen, sidebarView: app.sidebarView }),
    )
  } catch {
    // stockage indisponible : on ignore
  }
}

const SESSION_KEY = 'doku-session'
// Empêche la sauvegarde de session d'écraser l'enregistrement pendant le chargement.
let sessionReady = false

// Persiste les onglets ouverts (chemins) + l'actif. Le contenu n'est PAS stocké :
// la source de vérité reste le fichier sur disque, relu à la restauration.
export function saveSession() {
  if (!sessionReady) return
  try {
    const tabs = app.tabs.filter((t) => t.path).map((t) => t.path)
    localStorage.setItem(SESSION_KEY, JSON.stringify({ tabs, activePath: activeTab()?.path ?? null }))
  } catch {
    // stockage indisponible : on ignore
  }
}

// Restaure la session au démarrage (natif) : relit chaque fichier ; un fichier
// disparu est retiré et signalé via la bannière (FR-4).
export async function restoreSession() {
  let session: { tabs?: string[]; activePath?: string | null } | null = null
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (raw) session = JSON.parse(raw)
  } catch {
    session = null
  }
  const paths = session?.tabs ?? []
  const missing: string[] = []
  for (const p of paths) {
    const content = await readTextFileAt(p)
    if (content == null) {
      missing.push(p)
      continue
    }
    openTab(baseName(p), p, content)
  }
  const active = session?.activePath ? app.tabs.find((t) => t.path === session!.activePath) : undefined
  if (active) app.activeId = active.id
  if (missing.length) {
    app.banner = `${missing.length} fichier(s) introuvable(s), retiré(s) de la session : ${missing.map(baseName).join(', ')}`
  }
  sessionReady = true
}

export function initApp() {
  if (isTauri) {
    void restoreSession()
    return
  }
  // Mode navigateur (design/dev) : contenu de démonstration.
  if (app.tabs.length === 0) {
    for (const d of DEMO_TABS) openTab(d.name, d.path, d.content, d.kind)
    app.activeId = app.tabs[0]?.id ?? 0
  }
  sessionReady = true
}

export function applyTheme() {
  document.documentElement.dataset.theme = app.theme
}

export function toggleTheme() {
  app.theme = app.theme === 'dark' ? 'light' : 'dark'
  applyTheme()
}

loadSettings()

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
    eol: detectLineEnding(content),
  }
  app.tabs.push(tab)
  app.activeId = tab.id
  // Ouvrir un fichier resynchronise l'explorateur sur son dossier.
  app.explorerDir = null
  return tab
}

// Ouvre un fichier par chemin (clic dans l'explorateur). No-op en navigateur.
export async function openPath(path: string) {
  const existing = app.tabs.find((t) => t.path === path)
  if (existing) {
    app.activeId = existing.id
    return
  }
  const content = await readTextFileAt(path)
  if (content == null) return
  openTab(baseName(path), path, content)
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

// --- Sauvegarde ---

// Écrit un onglet sur disque (atomique). savedContent n'est marqué qu'après
// succès (mode navigateur : no-op d'écriture). Renvoie false si rien n'a été écrit.
export async function saveTab(tab: DocTab): Promise<boolean> {
  if (isTauri) {
    if (!tab.path) return false // « Enregistrer sous » : story ultérieure
    try {
      await writeTextFileAtomic(tab.path, tab.content)
    } catch (err) {
      console.error('Sauvegarde échouée', err)
      return false
    }
  }
  tab.savedContent = tab.content
  return true
}

// --- Modal de confirmation (Sauver / Ignorer / Annuler) ---

export type CloseChoice = 'save' | 'discard' | 'cancel'

export const dialog = $state({ open: false, title: '', message: '' })
let dialogResolver: ((choice: CloseChoice) => void) | null = null

export function askSave(title: string, message: string): Promise<CloseChoice> {
  dialog.title = title
  dialog.message = message
  dialog.open = true
  return new Promise((resolve) => {
    dialogResolver = resolve
  })
}

export function resolveDialog(choice: CloseChoice) {
  if (!dialog.open) return
  dialog.open = false
  const resolve = dialogResolver
  dialogResolver = null
  resolve?.(choice)
}

// Ferme un onglet en confirmant d'abord si des modifications sont non enregistrées.
export async function requestCloseTab(id: number) {
  const tab = app.tabs.find((t) => t.id === id)
  if (tab && isDirty(tab)) {
    const choice = await askSave(
      'Modifications non enregistrées',
      `« ${tab.name} » contient des modifications non enregistrées.`,
    )
    if (choice === 'cancel') return
    if (choice === 'save' && !(await saveTab(tab))) return
  }
  closeTab(id)
}
