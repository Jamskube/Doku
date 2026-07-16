import type { EditorView } from '@codemirror/view'
import { DEMO_DIR, DEMO_TABS } from './demo'
import { detectLineEnding } from './editor/editor'
import { baseName, isSupportedFile, joinPath, parentPath } from './explorer'
import { detectUnsupported } from './encoding'
import { classifyExternalChange } from './reload'
import { makeSearchDoc, searchDocs, type SearchDoc, type SearchResult } from './search'
import { snapshotKey, type SnapshotInfo } from './snapshot'
import { buildSearchIndex, isTauri, listSnapshots, purgeAllSnapshots, readSnapshot, readTextFileAt, recordSnapshot, scanFiles, setAlwaysOnTop, writeTextFileAtomic } from './tauri'
import { normalizeTarget, wikilinkCandidates, wikilinkFileName } from './wikilink'

export type DocKind = 'md' | 'html' | 'txt' | 'pdf'
export type SidebarView = 'files' | 'plan' | 'history' | 'search'
// Vue interne du panneau copilote droit (14.0). Transitoire : boot toujours en
// 'chat' (coquille statique, ne démarre PAS le moteur) ; 'models' déclenche
// ensureReady à l'ouverture (intention explicite) — évite un spawn Ollama au boot.
export type CopilotView = 'chat' | 'models'
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

// Wikilink cliqué sans cible unique (4.5) : soit proposer la création, soit choisir
// parmi plusieurs candidats homonymes.
export type WikiPrompt =
  | { kind: 'create'; target: string; fileName: string; dir: string }
  | { kind: 'choose'; target: string; candidates: { path: string; name: string; dir: string }[] }

let nextId = 1

export const app = $state({
  theme: 'light' as 'light' | 'dark',
  // Toujours au-dessus (FR-11) : geste momentané, non persisté (comme focus/sourceMode).
  pinned: false,
  // Masquée par défaut (app « légère » — FR-6) ; l'état est persisté (settings).
  sidebarOpen: false,
  sidebarView: 'files' as SidebarView,
  columnWidth: 'narrow' as ColumnWidth,
  // Modèle IA actif (copilote, 13.4) ; persisté (settings). '' = aucun choisi.
  activeModel: '',
  // Panneau copilote droit (14.0) : ouvert/fermé, persisté (settings) comme sidebarOpen.
  copilotOpen: false,
  // Vue interne du panneau (transitoire, non persistée) : boot toujours 'chat'.
  copilotView: 'chat' as CopilotView,
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
  // Historique (FR-12) : versions du fichier actif, chargées à l'ouverture du
  // panneau et après chaque save. snapshotsFor = onglet auquel la liste appartient.
  snapshots: [] as SnapshotInfo[],
  snapshotsFor: null as number | null,
  // Wikilink ambigu ou inexistant en attente de décision (4.5).
  wikiPrompt: null as WikiPrompt | null,
  // Recherche plein-texte (FR-1) : requête courante, résultats, indexation en cours.
  // Le panneau (9.3) les consomme ; le moteur vit dans runSearch.
  searchQuery: '',
  searchResults: [] as SearchResult[],
  searching: false,
  // Occurrence à révéler dans l'éditeur après ouverture (clic sur un résultat, 9.4).
  // Consommée par DocumentView une fois l'onglet monté, puis remise à null.
  pendingReveal: null as { path: string; line: number; col: number; length: number } | null,
})

// Accès non réactif à la vue CM6 courante (scroll TOC, sauvegarde…)
export const editorRef: { view: EditorView | null } = { view: null }

// Sélection courante de l'éditeur (16.1) — publiée par DocumentView à chaque changement de
// sélection. Le copilote s'en sert pour proposer « Reformuler » : la barre d'action n'apparaît
// que quand `text` est non vide. Réactif ($state, même motif que `app`).
export const editorSel = $state({ from: 0, to: 0, text: '' })

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
      if (s.sidebarView === 'files' || s.sidebarView === 'plan' || s.sidebarView === 'history' || s.sidebarView === 'search') {
        app.sidebarView = s.sidebarView
      }
      if (s.columnWidth === 'narrow' || s.columnWidth === 'wide' || s.columnWidth === 'full') {
        app.columnWidth = s.columnWidth
      }
      if (typeof s.activeModel === 'string') app.activeModel = s.activeModel
      if (typeof s.copilotOpen === 'boolean') app.copilotOpen = s.copilotOpen
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
        activeModel: app.activeModel,
        copilotOpen: app.copilotOpen,
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
    // PDF (11.1) : rouvrir sans lecture texte (sinon readTextFile lève → faux « introuvable »).
    if (kindFromName(baseName(p)) === 'pdf') {
      openTab(baseName(p), p, '', 'pdf')
      continue
    }
    let content: string | null
    try {
      content = await readTextFileAt(p)
    } catch {
      // readTextFile lève sur un fichier supprimé (natif) : le compter comme
      // introuvable (sinon la bannière FR-4 ne se déclenche jamais en natif).
      missing.push(p)
      continue
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
    void purgeAllSnapshots(Date.now()) // purge de démarrage de l'historique (ADR-0003)
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

// Épingle la fenêtre au-dessus des autres apps (FR-11). Logique partagée entre le
// bouton de la barre de titre et le raccourci Ctrl+Maj+T. L'état visuel (app.pinned)
// bascule de suite ; l'appel natif est asynchrone (no-op en navigateur).
export function togglePin() {
  app.pinned = !app.pinned
  setAlwaysOnTop(app.pinned).catch((err) => console.error('Épinglage échoué', err))
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
  if (ext === 'pdf') return 'pdf'
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

// Résout et ouvre un wikilink `[[note]]` (FR-7, FR-10) : d'abord un onglet déjà
// ouvert du même nom, sinon les fichiers du dossier du doc actif (+ sous-dossiers).
// 1 candidat → ouvre ; 2+ → menu de désambiguïsation ; 0 → proposition de création (4.5).
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
  const candidates = wikilinkCandidates(target, files)
  if (candidates.length === 1) {
    await openPath(candidates[0].path)
  } else if (candidates.length > 1) {
    app.wikiPrompt = {
      kind: 'choose',
      target,
      candidates: candidates.map((c) => ({ path: c.path, name: c.name, dir: baseName(parentPath(c.path) ?? '') })),
    }
  } else {
    const fileName = wikilinkFileName(target)
    if (fileName) app.wikiPrompt = { kind: 'create', target, fileName, dir: base }
  }
}

// Crée la note proposée pour un wikilink inexistant (4.5), puis l'ouvre. Garde
// anti-écrasement : si le fichier a été créé entre-temps, on l'ouvre sans l'écraser.
export async function createWikilinkTarget() {
  const p = app.wikiPrompt
  app.wikiPrompt = null
  if (p?.kind !== 'create') return
  const path = joinPath(p.dir, p.fileName)
  try {
    const existing = await readTextFileAt(path)
    if (existing != null) {
      await openPath(path)
      return
    }
  } catch {
    // readTextFile lève sur un fichier absent : c'est le cas nominal, on le crée
  }
  try {
    await writeTextFileAtomic(path, '')
  } catch (err) {
    console.error('Création de note échouée', err)
    app.banner = `Impossible de créer « ${p.fileName} ».`
    return
  }
  await openPath(path)
}

// Ouvre le candidat choisi dans le menu de désambiguïsation (4.5).
export async function chooseWikilinkCandidate(path: string) {
  app.wikiPrompt = null
  await openPath(path)
}

export function dismissWikiPrompt() {
  app.wikiPrompt = null
}

// --- Recherche plein-texte (FR-1, 9.2) ---

// Index en mémoire du dossier courant (ADR-0007), non réactif. Reconstruit
// paresseusement quand le dossier change ; maintenu au fil des saves/reloads.
let searchIndex: SearchDoc[] | null = null
let searchIndexDir: string | null = null
// Build d'index en vol, mémoïsé par dossier : des frappes rapides avant que l'index
// soit prêt réutilisent la MÊME promesse au lieu de relancer un scan IPC par frappe.
let indexBuild: { dir: string | null; promise: Promise<SearchDoc[]> } | null = null
let searchReq = 0

// Dossier où chercher : celui de l'explorateur s'il est fixé, sinon celui du doc actif.
function searchDir(): string | null {
  return app.explorerDir ?? parentPath(activeTab()?.path ?? null)
}

function buildIndexFor(dir: string | null): Promise<SearchDoc[]> {
  if (!isTauri) {
    return Promise.resolve(DEMO_TABS.filter((t) => t.path).map((t) => makeSearchDoc(t.path as string, t.name, t.content)))
  }
  return dir ? buildSearchIndex(dir) : Promise.resolve([])
}

// Lance une recherche. (Re)construit l'index du dossier courant (une seule fois, même
// sous des frappes rapides) puis cherche en mémoire. Jeton anti-périmé : une requête
// plus récente annule le résultat obsolète (même garde que loadSnapshotsForActive).
export async function runSearch(query: string) {
  app.searchQuery = query
  const req = ++searchReq
  const q = query.trim()
  if (!q) {
    app.searchResults = []
    app.searching = false
    return
  }
  const dir = searchDir()
  app.searching = true
  if (searchIndex == null || searchIndexDir !== dir) {
    if (!indexBuild || indexBuild.dir !== dir) indexBuild = { dir, promise: buildIndexFor(dir) }
    let built: SearchDoc[]
    try {
      built = await indexBuild.promise
    } catch {
      if (req === searchReq) {
        app.searchResults = []
        app.searching = false
      }
      return
    }
    if (req !== searchReq) return // requête plus récente : index périmé, on abandonne
    searchIndex = built
    searchIndexDir = dir
  }
  const results = searchDocs(searchIndex, q)
  if (req !== searchReq) return
  app.searchResults = results
  app.searching = false
}

export function clearSearch() {
  searchReq++ // annule toute recherche en vol
  app.searchQuery = ''
  app.searchResults = []
  app.searching = false
}

// Ouvre le fichier d'un résultat de recherche et demande la révélation de l'occurrence
// (saut à la ligne + cadre, 9.4). Le pending est posé AVANT l'ouverture : DocumentView
// le consomme une fois l'onglet monté (nouvel onglet) ou immédiatement (déjà ouvert).
export async function openSearchHit(path: string, line: number, col: number, length: number) {
  app.pendingReveal = { path, line, col, length }
  await openPath(path)
}

// Un chemin appartient-il à l'arbre du dossier indexé (pour capter les créations) ?
function withinSearchDir(path: string): boolean {
  const dir = searchIndexDir
  if (!dir) return false
  const sep = dir.includes('\\') ? '\\' : '/'
  return path.startsWith(dir.endsWith(sep) ? dir : dir + sep)
}

// Reflète un changement de contenu (save, restauration, reload externe) dans l'index
// sans le reconstruire : met à jour le document s'il y figure, sinon l'ajoute s'il
// appartient au dossier indexé (fichier nouvellement créé). Une suppression externe
// est captée au prochain rebuild (changement de dossier) — hit fantôme inoffensif
// entre-temps (le clic échoue proprement via openPath).
function invalidateSearchDoc(path: string, name: string, content: string) {
  if (!searchIndex) return
  const i = searchIndex.findIndex((d) => d.path === path)
  if (i >= 0) searchIndex[i] = makeSearchDoc(path, name, content)
  else if (withinSearchDir(path)) searchIndex.push(makeSearchDoc(path, name, content))
}

// Ouvre un fichier par chemin (clic dans l'explorateur). No-op en navigateur.
export async function openPath(path: string) {
  const existing = app.tabs.find((t) => t.path === path)
  if (existing) {
    app.activeId = existing.id
    return
  }
  // PDF (11.1) : document binaire lecture seule. Ne PAS lire en texte (detectUnsupported
  // le rejetterait comme binaire) ; les octets sont chargés à l'affichage par PdfView.
  if (kindFromName(baseName(path)) === 'pdf') {
    openTab(baseName(path), path, '', 'pdf')
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
  // PDF : lecture seule, aucun contenu texte. Sans cette garde, Ctrl+S écrirait content=''
  // dans le .pdf et DÉTRUIRAIT le fichier (le save n'est PAS gaté sur `changed`).
  if (tab.kind === 'pdf') return false
  // Capturés AVANT tout await : on écrit et on archive exactement cette valeur,
  // même si l'utilisateur tape pendant l'écriture asynchrone. `now` capturé ici (et
  // non dans la chaîne async) pour que l'horodatage suive l'ordre d'émission des saves.
  const changed = tab.content !== tab.savedContent
  const saved = tab.content
  const now = Date.now()
  if (isTauri) {
    if (!tab.path) return false // « Enregistrer sous » : story ultérieure
    try {
      await writeTextFileAtomic(tab.path, saved)
    } catch (err) {
      console.error('Sauvegarde échouée', err)
      return false
    }
    tab.savedContent = saved
    invalidateSearchDoc(tab.path, tab.name, saved) // garder l'index de recherche à jour
    // Snapshot du contenu sauvé (FR-12), seulement s'il a réellement changé.
    // Fire-and-forget : un échec d'historique ne doit JAMAIS casser le save.
    if (changed) {
      const path = tab.path
      void snapshotKey(path)
        .then((key) => recordSnapshot(key, saved, path, now))
        .then(() => {
          if (app.sidebarView === 'history' && app.sidebarOpen) return loadSnapshotsForActive()
        })
        .catch((err) => console.error('Snapshot échoué', err))
    }
    return true
  }
  tab.savedContent = saved
  return true
}

// --- Historique / versions (FR-12) ---

let snapshotReq = 0

// Charge l'historique du fichier actif dans app.snapshots. Jeton anti-périmé : un
// changement d'onglet pendant la lecture annule le résultat obsolète. Onglet sans
// chemin (non enregistré) → liste vide.
export async function loadSnapshotsForActive() {
  const tab = activeTab()
  const req = ++snapshotReq
  if (!tab || !tab.path) {
    app.snapshots = []
    app.snapshotsFor = tab?.id ?? null
    return
  }
  const key = await snapshotKey(tab.path)
  const list = await listSnapshots(key)
  if (req !== snapshotReq) return // onglet changé entre-temps : résultat périmé
  app.snapshots = list
  app.snapshotsFor = tab.id
}

// Restaure une version depuis l'historique (7.3). L'état courant est d'abord
// snapshotté (réversible : même des édits non enregistrés sont préservés), puis le
// fichier est remplacé et l'onglet rechargé (mécanisme rev, cf. 3.5).
export async function restoreSnapshot(name: string) {
  const tab = activeTab()
  if (!tab?.path) return
  const path = tab.path
  const key = await snapshotKey(path)
  const content = await readSnapshot(key, name)
  if (content == null) {
    app.banner = 'Version introuvable — elle a peut-être été purgée.'
    void loadSnapshotsForActive()
    return
  }
  if (content === tab.content) return // déjà cette version
  // On n'archive l'état courant QUE s'il porte des modifications non enregistrées :
  // sinon il est déjà dans l'historique (dernière save ou version en cours) et le
  // re-snapshotter ne ferait que des doublons à chaque clic.
  const preserved = isDirty(tab)
  if (preserved) await recordSnapshot(key, tab.content, path, Date.now())
  try {
    await writeTextFileAtomic(path, content)
  } catch (err) {
    console.error('Restauration échouée', err)
    app.banner = `Impossible de restaurer « ${tab.name} » (erreur d'écriture).`
    return
  }
  applyDiskContent(tab, content)
  app.banner = preserved
    ? "Version restaurée. Vos modifications non enregistrées ont été ajoutées à l'historique."
    : 'Version restaurée.'
  await loadSnapshotsForActive()
}

// --- Rechargement sur modification externe (FR-3, 3.5) ---

// Adopte le contenu disque dans l'onglet : redevient propre et signale l'éditeur.
function applyDiskContent(tab: DocTab, disk: string) {
  tab.content = disk
  tab.savedContent = disk
  tab.eol = detectLineEnding(disk)
  tab.rev++
  if (tab.path) invalidateSearchDoc(tab.path, tab.name, disk) // restauration / reload externe
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
