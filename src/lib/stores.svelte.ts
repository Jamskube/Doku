import type { EditorView } from '@codemirror/view'
import { DEMO_DIR, DEMO_TABS } from './demo'
import { detectLineEnding } from './editor/editor'
import { baseName, isSupportedFile, joinPath, parentPath } from './explorer'
import { detectUnsupported } from './encoding'
import { classifyExternalChange } from './reload'
import { isTauri, readTextFileAt, scanFiles, writeTextFileAtomic } from './tauri'
import { matchWikilink, normalizeTarget } from './wikilink'

export type DocKind = 'md' | 'html' | 'txt'
export type SidebarView = 'files' | 'plan' | 'history'
export type ColumnWidth = 'narrow' | 'wide' | 'full'

// Largeur de la colonne de lecture (variable CSS --doc-width, consommée par
// l'éditeur et le doc-head). full = pas de max-width.
export const COLUMN_PX: Record<ColumnWidth, string> = { narrow: '680px', wide: '820px', full: 'none' }

export interface DocTab {
  id: number
  name: string
  path: string | null
  kind: DocKind
  content: string
  savedContent: string
  eol: '\n' | '\r\n'
  // Incrémenté à chaque rechargement externe : signale à l'éditeur de reconstruire
  // son état pour cet onglet (le contenu a changé hors frappe utilisateur).
  rev: number
  // Gros fichier : affiché en mode source léger + scroll-spy/plan désactivés pour
  // rester fluide (1.6). L'utilisateur peut forcer l'aperçu via forcePreview.
  heavy: boolean
}

// Au-delà de ce seuil (~1,5 M caractères ≈ 1,5 Mo), un Markdown est ouvert en mode
// source léger : le scroll-spy (docHeadings O(doc) à chaque scroll) et le panneau
// Plan sont désactivés pour éviter le gel de l'UI.
export const HEAVY_THRESHOLD = 1_500_000

let nextId = 1

export const app = $state({
  theme: 'light' as 'light' | 'dark',
  pinned: false,
  // Masquée par défaut (app « légère » — FR-6) ; l'état est persisté (settings).
  sidebarOpen: false,
  sidebarView: 'files' as SidebarView,
  columnWidth: 'narrow' as ColumnWidth,
  sourceMode: false,
  // Mode focus (F9) : masque tout le chrome ; transitoire (non persisté).
  focus: false,
  // Ligne du titre courant (scroll-spy de la table des matières).
  activeHeadingLine: 0,
  tabs: [] as DocTab[],
  activeId: 0,
  // Dossier affiché par l'explorateur ; null = suit le dossier du document actif.
  explorerDir: null as string | null,
  // Bannière d'information transitoire (ex. fichiers de session introuvables).
  banner: null as string | null,
  // Proposition de rechargement (modif externe + modifs locales) — non modale.
  reloadPrompt: null as { tabId: number; name: string } | null,
  // Un fichier est glissé au-dessus de la fenêtre (overlay de dépôt, 2.4).
  dragging: false,
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
      if (s.columnWidth === 'narrow' || s.columnWidth === 'wide' || s.columnWidth === 'full') {
        app.columnWidth = s.columnWidth
      }
    }
  } catch {
    // settings corrompus/indisponibles : valeurs par défaut
  }
  applyTheme()
  applyColumnWidth()
}

export function saveSettings() {
  try {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        theme: app.theme,
        sidebarOpen: app.sidebarOpen,
        sidebarView: app.sidebarView,
        columnWidth: app.columnWidth,
      }),
    )
  } catch {
    // stockage indisponible : on ignore
  }
}

export function applyColumnWidth() {
  document.documentElement.style.setProperty('--doc-width', COLUMN_PX[app.columnWidth])
}

export function cycleColumnWidth() {
  const order: ColumnWidth[] = ['narrow', 'wide', 'full']
  app.columnWidth = order[(order.indexOf(app.columnWidth) + 1) % order.length]
  applyColumnWidth()
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
    let content: string | null
    try {
      content = await readTextFileAt(p)
    } catch {
      continue // fichier illisible/encodage : on ne restaure pas, sans casser la boucle
    }
    if (content == null) {
      missing.push(p)
      continue
    }
    if (detectUnsupported(content)) continue // binaire/non-UTF-8 : ne pas restaurer
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
    rev: 0,
    heavy: content.length > HEAVY_THRESHOLD,
  }
  app.tabs.push(tab)
  app.activeId = tab.id
  // Ouvrir un fichier resynchronise l'explorateur sur son dossier.
  app.explorerDir = null
  return tab
}

// Résout et ouvre un wikilink `[[note]]` (FR-7) : d'abord un onglet déjà ouvert
// du même nom, sinon le fichier dans le dossier du doc actif (+ sous-dossiers).
// Cible absente → no-op (création = story 4.5).
export async function openWikilink(target: string) {
  const t = normalizeTarget(target)
  const open = app.tabs.find((tab) => normalizeTarget(tab.name) === t)
  if (open) {
    app.activeId = open.id
    return
  }
  const base = parentPath(activeTab()?.path ?? null)
  if (!base) return
  const files = isTauri
    ? await scanFiles(base)
    : DEMO_DIR.filter((e) => !e.isDir).map((e) => ({ name: e.name, path: joinPath(base, e.name) }))
  const path = matchWikilink(target, files)
  if (path) await openPath(path)
}

// Ouvre un fichier par chemin (clic dans l'explorateur). No-op en navigateur.
export async function openPath(path: string) {
  const existing = app.tabs.find((t) => t.path === path)
  if (existing) {
    app.activeId = existing.id
    return
  }
  let content: string | null
  try {
    content = await readTextFileAt(path)
  } catch {
    // Tauri readTextFile lève sur UTF-8 invalide → format/encodage non supporté.
    app.banner = `Impossible d'ouvrir « ${baseName(path)} » : lecture ou encodage non pris en charge.`
    return
  }
  if (content == null) return
  const reason = detectUnsupported(content, baseName(path))
  if (reason) {
    app.banner = reason
    return
  }
  openTab(baseName(path), path, content)
}

// Ouvre un fichier glissé-déposé (2.4) : les formats non supportés (PDF, images…)
// sont refusés avec un message clair (ils sont masqués ailleurs, mais un dépôt est
// explicite). Le contenu binaire/non-UTF-8 est ensuite géré par openPath (1.2).
export async function openDropped(path: string) {
  const name = baseName(path)
  if (!isSupportedFile(name)) {
    app.banner = `« ${name} » : format non pris en charge.`
    return
  }
  await openPath(path)
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

// Force l'aperçu (live preview) sur un gros fichier ouvert en mode source (1.6).
// Bump `rev` pour que l'éditeur reconstruise son état avec les décorations.
export function forcePreview(id: number) {
  const tab = app.tabs.find((t) => t.id === id)
  if (tab?.heavy) {
    tab.heavy = false
    tab.rev++
  }
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

// --- Rechargement sur modification externe (FR-3, 3.5) ---

// Adopte le contenu disque dans l'onglet : redevient propre et signale l'éditeur.
function applyDiskContent(tab: DocTab, disk: string) {
  tab.content = disk
  tab.savedContent = disk
  tab.eol = detectLineEnding(disk)
  tab.rev++
}

// Au retour du focus : relit chaque fichier ouvert et compare au disque.
// Non-dirty → recharge silencieusement. Dirty + disque différent → propose (le
// premier conflit rencontré ; les autres seront reproposés au focus suivant).
export async function checkExternalChanges() {
  let conflict: DocTab | null = null
  for (const tab of app.tabs) {
    if (!tab.path) continue
    let disk: string | null
    try {
      disk = await readTextFileAt(tab.path)
    } catch {
      continue // supprimé/illisible depuis : ne casse pas la boucle (readTextFile lève)
    }
    if (disk == null) continue
    const decision = classifyExternalChange(disk, tab)
    if (decision === 'reload') applyDiskContent(tab, disk)
    else if (decision === 'conflict' && !conflict) conflict = tab
  }
  if (conflict) app.reloadPrompt = { tabId: conflict.id, name: conflict.name }
}

// Applique la proposition de rechargement (relit le disque à cet instant).
export async function reloadPromptedTab() {
  const prompt = app.reloadPrompt
  app.reloadPrompt = null
  if (!prompt) return
  const tab = app.tabs.find((t) => t.id === prompt.tabId)
  if (!tab?.path) return
  let disk: string | null
  try {
    disk = await readTextFileAt(tab.path)
  } catch {
    app.banner = `Impossible de recharger « ${tab.name} » : fichier illisible ou supprimé.`
    return
  }
  if (disk != null) applyDiskContent(tab, disk)
}

export function dismissReloadPrompt() {
  app.reloadPrompt = null
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
