import { DEMO_DIR, DEMO_TABS } from './demo'
import { dropEditorRuntime, editorForPane, selectionForPane } from './editor-registry.svelte'
import { detectLineEnding } from './editor/editor'
import { baseName, DEFAULT_SORT, isSupportedFile, joinPath, parentPath, validateExpandedPaths, type ExplorerSort, type SortKey } from './explorer'
import { detectUnsupported } from './encoding'
import { DEFAULT_EMBED_MODEL } from './rag'
import { ragFileChanged } from './rag-index.svelte'
import { classifyExternalChange } from './reload'
import { makeSearchDoc, searchDocs, type SearchDoc, type SearchResult } from './search'
import { snapshotKey, type SnapshotInfo } from './snapshot'
import { canonicalPathKey, runSaveAs, type TextSaveSnapshot } from './save-as'
import { buildSession, parseSession, restoreWorkspace } from './session'
import { buildSearchIndex, confirmReplacePath, isTauri, listSnapshots, pathExistsAt, purgeAllSnapshots, readSnapshot, readTextFileAt, recordSnapshot, saveTextDialog, scanFiles, setAlwaysOnTop, syncSystemBackdrop, writeTextFileAtomic } from './tauri'
import { normalizeTarget, wikilinkCandidates, wikilinkFileName } from './wikilink'
import type { CopilotVerbosity } from './copilot-service'
import { activateWorkspacePane, assignWorkspaceTab, closeWorkspaceTab, createWorkspaceState, openWorkspaceSplit, otherPane, reuniteWorkspace, selectWorkspaceTab, setWorkspaceRatio, swapWorkspacePanes, type PaneId, type WorkspaceState } from './workspace'

export type DocKind = 'md' | 'html' | 'txt' | 'pdf' | 'docx'

// Documents BINAIRES : leur onglet ne porte aucun contenu texte (`content` reste vide),
// ils s'affichent par un composant dédié et ne passent jamais par l'écriture texte.
// Le prédicat existe pour que ces trois règles ne se répètent pas en `kind === 'pdf'`
// disséminés — un oubli signifierait un Ctrl+S écrivant `''` par-dessus le fichier.
export type BinaryKind = 'pdf' | 'docx'
const BINARY_KINDS: BinaryKind[] = ['pdf', 'docx']

// Garde de TYPE, pas simple booléen : c'est ce qui permet au compilateur d'exclure les
// kinds binaires du chemin d'écriture texte. Un booléen laisserait passer un `docx`
// jusqu'à `runSaveAs` — et donc jusqu'à écrire `''` dans le fichier.
export function isBinaryKind(kind: DocKind): kind is BinaryKind {
  return BINARY_KINDS.includes(kind as BinaryKind)
}
export type SidebarView = 'files' | 'plan' | 'history' | 'search'
// Vue interne du panneau copilote droit (14.0). Transitoire : boot toujours en
// 'chat' (coquille statique, ne démarre PAS le moteur) ; 'models' déclenche
// ensureReady à l'ouverture (intention explicite) — évite un spawn Ollama au boot.
export type CopilotView = 'chat' | 'models' | 'memory'
export type CopilotProvider = 'ollama' | 'openai' | 'minimax'

// LE prédicat cloud — badge, budget de contexte, refresh, personas et libellés d'erreur
// lisent tous celui-ci : deux ternaires divergents = la régression badge/décision de S13.
export function isCloudProvider(p: CopilotProvider): boolean {
  return p !== 'ollama'
}
export type ColumnWidth = 'narrow' | 'wide' | 'full'
export type NoticeTone = 'error' | 'warning' | 'success'

export interface AppNotice {
  tone: NoticeTone
  title: string
  message: string
}

// Largeur de la colonne de lecture (variable CSS --doc-width, consommée par
// l'éditeur). full = pas de max-width.
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
  // Modèle d'EMBEDDING (index sémantique 15.2, ADR-0015) — réglage distinct du modèle
  // de chat ; persisté. '' = effacé (supprimé du disque) : l'UI repropose le défaut.
  embedModel: DEFAULT_EMBED_MODEL,
  // Ollama reste le fournisseur local par défaut ; OpenAI et MiniMax sont des options
  // cloud explicites (ADR-0014, ADR-0018).
  copilotProvider: 'ollama' as CopilotProvider,
  // Modèle MiniMax choisi (liste dynamique à la connexion) ; persisté. '' = défaut.
  minimaxModel: '',
  // Style des réponses du copilote (bref / équilibré / détaillé) — persisté.
  copilotVerbosity: 'balanced' as CopilotVerbosity,
  // Mémoire de travail automatisée : uniquement utilisée par les fournisseurs cloud.
  // Le réglage est global, mais les souvenirs restent compartimentés par dossier.
  cloudMemoryEnabled: true,
  // Panneau copilote droit (14.0) : ouvert/fermé, persisté (settings) comme sidebarOpen.
  copilotOpen: false,
  // Le composant du panneau est chargé/monté paresseusement (App.svelte) : son code +
  // CSS sortent du bundle de démarrage. Ce drapeau (runtime, non persisté) reste vrai
  // après la première ouverture — le panneau garde ensuite son DOM et son slide.
  copilotMounted: false,
  // Vue copilote pleine page : transitoire, revient en vue partagée à la fermeture du panneau.
  copilotExpanded: false,
  // Modale Paramètres (19.2) : transitoire — elle ne doit jamais se rouvrir au démarrage.
  settingsOpen: false,
  // Section à mettre en avant à l'ouverture ('about' quand on vient du logo).
  settingsFocus: null as 'about' | null,
  // Modale « Organiser les pages » (ADR-0022) : porte le chemin du PDF concerné, donc
  // null = fermée. Transitoire — elle ne doit jamais se rouvrir au démarrage.
  pdfPagesPath: null as string | null,
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
  // Tri de l'explorateur (persisté). Les dossiers restent toujours en tête.
  explorerSort: { ...DEFAULT_SORT } as ExplorerSort,
  // Compteur bumpé après une création : force l'effet de relecture du dossier à
  // rejouer (targetDir n'a pas changé, donc lui seul ne re-déclencherait rien).
  explorerNonce: 0,
  // Dossiers dépliés de l'arborescence (chemins absolus, persistés). Les chemins
  // d'autres racines restent stockés : redevenir visible re-déplie tel quel.
  explorerExpanded: [] as string[],
  // Notification flottante transitoire (ex. fichiers de session introuvables).
  banner: null as AppNotice | null,
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
  pendingReveal: null as { path: string; line: number; col: number; length: number; select?: boolean } | null,
  // Page à révéler dans le viewer PDF (citation ancrée sur un PDF). `text` = passage cité :
  // PdfView surligne ses rectangles dans la page (repli : halo de page si introuvable).
  // Consommée par PdfView une fois la page créée.
  pendingPdfReveal: null as { path: string; page: number; text?: string } | null,
})

export const workspace: WorkspaceState = $state(createWorkspaceState())
export const workspaceLayout = $state({ stacked: false })

function applyWorkspaceState(next: WorkspaceState) {
  workspace.split = next.split
  workspace.activePaneId = next.activePaneId
  workspace.primary.tabId = next.primary.tabId
  workspace.primary.sourceMode = next.primary.sourceMode
  workspace.secondary.tabId = next.secondary.tabId
  workspace.secondary.sourceMode = next.secondary.sourceMode
  workspace.ratio = next.ratio
  app.activeId = workspace[workspace.activePaneId].tabId ?? 0
  app.sourceMode = workspace[workspace.activePaneId].sourceMode
}

export function selectTab(id: number) {
  if (!app.tabs.some((tab) => tab.id === id)) return
  applyWorkspaceState(selectWorkspaceTab(workspace, id))
}

export function activatePane(paneId: PaneId) {
  applyWorkspaceState(activateWorkspacePane(workspace, paneId))
}

export function assignTabToPane(paneId: PaneId, tabId: number | null): boolean {
  const result = assignWorkspaceTab(workspace, paneId, tabId)
  if (!result.ok) return false
  applyWorkspaceState(result.state)
  return true
}

export function toggleWorkspaceSplit() {
  applyWorkspaceState(workspace.split ? reuniteWorkspace(workspace) : openWorkspaceSplit(workspace))
}

export function swapPanes() {
  applyWorkspaceState(swapWorkspacePanes(workspace))
}

export function resizeWorkspace(ratio: number) {
  applyWorkspaceState(setWorkspaceRatio(workspace, ratio))
}

export function toggleActiveSourceMode() {
  const pane = workspace[workspace.activePaneId]
  pane.sourceMode = !pane.sourceMode
  app.sourceMode = pane.sourceMode
}

export function activeEditorView() {
  return editorForPane(workspace.activePaneId)
}

export function activeEditorSelection() {
  return selectionForPane(workspace.activePaneId)
}

/** Documents réellement visibles dans le bureau, dans l'ordre gauche/haut puis droite/bas. */
export function visibleTabs(): DocTab[] {
  const ids = workspace.split
    ? [workspace.primary.tabId, workspace.secondary.tabId]
    : [workspace[workspace.activePaneId].tabId]
  return ids.flatMap((id) => {
    const tab = id == null ? undefined : app.tabs.find((item) => item.id === id)
    return tab ? [tab] : []
  })
}

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
      if (typeof s.embedModel === 'string') app.embedModel = s.embedModel
      if (s.copilotProvider === 'ollama' || s.copilotProvider === 'openai' || s.copilotProvider === 'minimax')
        app.copilotProvider = s.copilotProvider
      if (typeof s.minimaxModel === 'string') app.minimaxModel = s.minimaxModel
      if (s.copilotVerbosity === 'brief' || s.copilotVerbosity === 'balanced' || s.copilotVerbosity === 'detailed')
        app.copilotVerbosity = s.copilotVerbosity
      if (typeof s.cloudMemoryEnabled === 'boolean') app.cloudMemoryEnabled = s.cloudMemoryEnabled
      if (typeof s.copilotOpen === 'boolean') app.copilotOpen = s.copilotOpen
      // Réglage validé champ par champ : un settings corrompu ne doit pas faire
      // planter le tri (sortEntries recevrait une clé inconnue et ne trierait plus).
      const sort = s.explorerSort
      if (sort && (sort.key === 'name' || sort.key === 'modified' || sort.key === 'type')) {
        app.explorerSort = { key: sort.key, order: sort.order === 'desc' ? 'desc' : 'asc' }
      }
      app.explorerExpanded = validateExpandedPaths(s.explorerExpanded)
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
        embedModel: app.embedModel,
        copilotProvider: app.copilotProvider,
        minimaxModel: app.minimaxModel,
        copilotVerbosity: app.copilotVerbosity,
        cloudMemoryEnabled: app.cloudMemoryEnabled,
        copilotOpen: app.copilotOpen,
        explorerSort: app.explorerSort,
        explorerExpanded: app.explorerExpanded,
      }),
    )
  } catch {
    // stockage indisponible : on ignore
  }
}

export function applyColumnWidth() {
  document.documentElement.style.setProperty('--doc-width', COLUMN_PX[app.columnWidth])
}

const SESSION_KEY = 'doku-session'
// Empêche la sauvegarde de session d'écraser l'enregistrement pendant le chargement.
let sessionReady = false

// Persiste les onglets ouverts (chemins) + l'actif. Le contenu n'est PAS stocké :
// la source de vérité reste le fichier sur disque, relu à la restauration.
export function saveSession() {
  if (!sessionReady) return
  try {
    const session = buildSession(
      app.tabs.map((tab) => tab.path),
      workspace,
      (tabId) => app.tabs.find((tab) => tab.id === tabId)?.path ?? null,
    )
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  } catch {
    // stockage indisponible : on ignore
  }
}

// Restaure la session au démarrage (natif) : relit chaque fichier ; un fichier
// disparu est retiré et signalé via la bannière (FR-4).
export async function restoreSession() {
  let session = null as ReturnType<typeof parseSession>
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    session = parseSession(raw)
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
  const restored = restoreWorkspace(session, (path) => {
    const key = canonicalPathKey(path)
    return app.tabs.find((tab) => tab.path && canonicalPathKey(tab.path) === key)?.id ?? null
  })
  if (restored.primary.tabId == null && app.tabs.length) {
    restored.primary.tabId = app.tabs.find((tab) => tab.path === session?.activePath)?.id ?? app.tabs[0].id
  }
  applyWorkspaceState(restored)
  const unsavedNotRestored = Boolean(session?.workspace.primaryUnsaved || session?.workspace.secondaryUnsaved)
  if (missing.length || unsavedNotRestored) {
    app.banner = {
      tone: 'warning',
      title: 'Session ajustée',
      message: [
        missing.length ? `${missing.length} fichier(s) introuvable(s), retiré(s) de la session : ${missing.map(baseName).join(', ')}` : '',
        unsavedNotRestored ? 'Une note non enregistrée n’a pas été restaurée.' : '',
      ].filter(Boolean).join(' '),
    }
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
    const first = app.tabs[0]
    if (first) selectTab(first.id)
  }
  sessionReady = true
}

export function applyTheme() {
  document.documentElement.dataset.theme = app.theme
  // Mica est appliqué pendant que la fenêtre est encore cachée. main.ts attend cette
  // même promesse avant le premier show(), ce qui évite que le DWM fige le fond opaque.
  void syncSystemBackdrop(app.theme).catch((err) => console.error('Activation de Mica échouée', err))
}

export function toggleTheme() {
  setTheme(app.theme === 'dark' ? 'light' : 'dark')
}

// Réglage direct (modale Paramètres) : même chemin que la bascule de la barre de
// titre, pour qu'un seul endroit applique réellement le thème.
export function setTheme(theme: 'light' | 'dark') {
  app.theme = theme
  applyTheme()
}

export function setColumnWidth(width: ColumnWidth) {
  app.columnWidth = width
  applyColumnWidth()
}

// Épingle la fenêtre au-dessus des autres apps (FR-11). Logique partagée entre le
// bouton de la barre de titre et le raccourci Ctrl+Maj+T. L'état visuel (app.pinned)
// bascule de suite ; l'appel natif est asynchrone (no-op en navigateur).
export function togglePin() {
  app.pinned = !app.pinned
  setAlwaysOnTop(app.pinned).catch((err) => console.error('Épinglage échoué', err))
}

loadSettings()

// Ouvre le panneau copilote. Première ouverture : monte d'abord le composant fermé
// (chargement paresseux dans App.svelte), puis bascule `open` une fois le montage
// peint — le slide d'entrée joue. Ouvertures suivantes : simple bascule de classe.
export function openCopilot(view: CopilotView | null = null) {
  if (view) app.copilotView = view
  if (app.copilotMounted) {
    app.copilotOpen = true
    return
  }
  app.copilotMounted = true
  // Double rAF : la classe `open` bascule après la peinture du montage → le slide joue.
  // Fallback minuterie : fenêtre occluse/minimisée = rAF gelé — on ouvre quand même
  // (sans animation, personne ne la voit) plutôt que d'attendre un repaint lointain.
  let opened = false
  const open = () => {
    if (opened) return
    opened = true
    app.copilotOpen = true
  }
  requestAnimationFrame(() => requestAnimationFrame(open))
  setTimeout(open, 150)
}

export function activeTab(): DocTab | undefined {
  const id = workspace[workspace.activePaneId].tabId
  return app.tabs.find((t) => t.id === id)
}

// Mémo par onglet : isDirty est appelé sur plusieurs chemins de rendu chauds (onglets,
// explorateur, mode focus) à chaque frappe. La comparaison de chaînes multi-Mo n'est
// refaite que quand l'une des deux références a changé (===  sur la même référence est O(1)).
const dirtyMemo = new WeakMap<DocTab, { c: string; s: string; d: boolean }>()

export function isDirty(tab: DocTab): boolean {
  const m = dirtyMemo.get(tab)
  if (m && m.c === tab.content && m.s === tab.savedContent) return m.d
  const d = tab.content !== tab.savedContent
  dirtyMemo.set(tab, { c: tab.content, s: tab.savedContent, d })
  return d
}

export function kindFromName(name: string): DocKind {
  const ext = name.split('.').pop()?.toLowerCase()
  if (ext === 'html' || ext === 'htm') return 'html'
  if (ext === 'md' || ext === 'markdown') return 'md'
  if (ext === 'pdf') return 'pdf'
  if (ext === 'docx') return 'docx'
  return 'txt'
}

export function openTab(
  name: string,
  path: string | null,
  content: string,
  kind?: DocKind,
  targetPane: PaneId = workspace.activePaneId,
): DocTab {
  const pathKey = path ? canonicalPathKey(path) : null
  const existing = pathKey ? app.tabs.find((t) => t.path && canonicalPathKey(t.path) === pathKey) : undefined
  if (existing) {
    selectTab(existing.id)
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
  if (!assignTabToPane(targetPane, tab.id)) selectTab(tab.id)
  // Ouvrir un fichier resynchronise l'explorateur sur son dossier.
  app.explorerDir = null
  return tab
}

export function createWorkspaceNote(targetPane: PaneId): DocTab {
  if (targetPane === 'secondary' && !workspace.split) {
    applyWorkspaceState(openWorkspaceSplit(workspace))
  }

  const sourceTabId = workspace[otherPane(targetPane)].tabId ?? workspace[targetPane].tabId
  const source = app.tabs.find((tab) => tab.id === sourceTabId)
  const sourceBase = source?.name.replace(/\.[^.]+$/, '') || 'document'
  const root = `Notes — ${sourceBase}`
  let name = root
  let suffix = 2
  while (app.tabs.some((tab) => tab.path == null && tab.name === name)) {
    name = `${root} (${suffix++})`
  }
  return openTab(name, null, '', 'md', targetPane)
}

// Résout et ouvre un wikilink `[[note]]` (FR-7, FR-10) : d'abord un onglet déjà
// ouvert du même nom, sinon les fichiers du dossier du doc actif (+ sous-dossiers).
// 1 candidat → ouvre ; 2+ → menu de désambiguïsation ; 0 → proposition de création (4.5).
export async function openWikilink(target: string) {
  const t = normalizeTarget(target)
  const open = app.tabs.find((tab) => normalizeTarget(tab.name) === t)
  if (open) {
    selectTab(open.id)
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
    app.banner = {
      tone: 'error',
      title: 'Création impossible',
      message: `Impossible de créer « ${p.fileName} ».`,
    }
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
  const key = canonicalPathKey(path)
  const existing = app.tabs.find((t) => t.path && canonicalPathKey(t.path) === key)
  if (existing) {
    selectTab(existing.id)
    return
  }
  // PDF (11.1) : document binaire lecture seule. Ne PAS lire en texte (detectUnsupported
  // le rejetterait comme binaire) ; les octets sont chargés à l'affichage par PdfView.
  const binaryKind = kindFromName(baseName(path))
  if (isBinaryKind(binaryKind)) {
    openTab(baseName(path), path, '', binaryKind)
    return
  }
  let content: string | null
  try {
    content = await readTextFileAt(path)
  } catch {
    // Tauri readTextFile lève sur UTF-8 invalide → format/encodage non supporté.
    app.banner = {
      tone: 'error',
      title: 'Ouverture impossible',
      message: `Impossible d'ouvrir « ${baseName(path)} » : lecture ou encodage non pris en charge.`,
    }
    return
  }
  if (content == null) return
  const reason = detectUnsupported(content, baseName(path))
  if (reason) {
    app.banner = { tone: 'error', title: 'Fichier non pris en charge', message: reason }
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
    app.banner = {
      tone: 'error',
      title: 'Format non pris en charge',
      message: `« ${name} » ne peut pas être ouvert dans Doku.`,
    }
    return
  }
  await openPath(path)
}

export function closeTab(id: number) {
  const idx = app.tabs.findIndex((t) => t.id === id)
  if (idx === -1) return
  const nextWorkspace = closeWorkspaceTab(workspace, id)
  dropEditorRuntime(id)
  app.tabs.splice(idx, 1)
  if (nextWorkspace[nextWorkspace.activePaneId].tabId == null) {
    const next = app.tabs[Math.min(idx, app.tabs.length - 1)]
    const assigned = assignWorkspaceTab(nextWorkspace, nextWorkspace.activePaneId, next?.id ?? null)
    applyWorkspaceState(assigned.ok ? assigned.state : nextWorkspace)
  } else {
    applyWorkspaceState(nextWorkspace)
  }
}

export function cycleTab(dir: 1 | -1) {
  if (app.tabs.length < 2) return
  const idx = app.tabs.findIndex((t) => t.id === app.activeId)
  const next = app.tabs[(idx + dir + app.tabs.length) % app.tabs.length]
  selectTab(next.id)
}

export function toggleSidebarView(view: SidebarView) {
  if (app.sidebarView === view && app.sidebarOpen) {
    app.sidebarOpen = false
  } else {
    app.sidebarView = view
    app.sidebarOpen = true
  }
}

// Re-cliquer la clé active inverse l'ordre ; changer de clé repart en croissant
// (sinon on hérite d'un « décroissant » invisible venu d'un autre critère).
export function setExplorerSort(key: SortKey) {
  const cur = app.explorerSort
  // Pas de saveSettings() ici : l'$effect d'App.svelte persiste déjà chaque mutation
  // (un appel explicite doublerait le JSON.stringify + localStorage.setItem).
  app.explorerSort = key === cur.key ? { key, order: cur.order === 'asc' ? 'desc' : 'asc' } : { key, order: 'asc' }
}

// Force l'explorateur à relire le dossier courant (après une création, ou à la demande).
export function refreshExplorer() {
  app.explorerNonce++
}

// Déplie/replie un dossier de l'arborescence (persisté). Replier un dossier ne
// replie PAS ses descendants : re-déplier retrouve l'état antérieur tel quel.
export function toggleExplorerExpanded(path: string) {
  const idx = app.explorerExpanded.indexOf(path)
  if (idx >= 0) app.explorerExpanded.splice(idx, 1)
  else app.explorerExpanded.push(path)
}

// « Tout replier » (revenu avec l'arborescence — retiré en 19.1 quand la liste était
// plate) : ne vide que les chemins sous la racine affichée, les autres racines gardent
// leur état déplié.
export function collapseExplorer(prefix: string) {
  const sep = prefix.includes('\\') ? '\\' : '/'
  const root = prefix.endsWith(sep) ? prefix : prefix + sep
  app.explorerExpanded = app.explorerExpanded.filter((p) => !p.startsWith(root))
}

export function openSettings(focus: 'about' | null = null) {
  app.settingsFocus = focus
  app.settingsOpen = true
}

export function closeSettings() {
  app.settingsOpen = false
  app.settingsFocus = null
}

export function openPdfPages(path: string) {
  app.pdfPagesPath = path
}

export function closePdfPages() {
  app.pdfPagesPath = null
}

export interface Heading {
  level: number
  text: string
  line: number
}

// Mémo 1 entrée : le scroll-spy appelle docHeadings à chaque frame de scroll et le
// panneau Plan à chaque frappe, toujours sur le contenu de l'onglet actif. Tant que la
// référence de chaîne n'a pas changé, le split + regex du document entier est épargné.
let headingsMemoKey: string | null = null
let headingsMemoVal: Heading[] = []

export function docHeadings(content: string): Heading[] {
  if (content === headingsMemoKey) return headingsMemoVal
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
  headingsMemoKey = content
  headingsMemoVal = out
  return out
}

export function scrollToLine(line: number) {
  const view = activeEditorView()
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

function snapshotTextTab(tab: DocTab): TextSaveSnapshot | null {
  if (isBinaryKind(tab.kind)) return null
  return {
    tabId: tab.id,
    name: tab.name,
    kind: tab.kind,
    content: tab.content,
    savedContent: tab.savedContent,
  }
}

function reportSaveFailure(name: string, error?: unknown) {
  if (error) console.error('Sauvegarde échouée', error)
  app.banner = {
    tone: 'error',
    title: 'Enregistrement impossible',
    message: `« ${name} » n’a pas pu être enregistré. Le document reste ouvert avec ses modifications.`,
  }
}

function runPostSaveEffects(snapshot: TextSaveSnapshot, path: string, now: number, firstSave: boolean) {
  invalidateSearchDoc(path, baseName(path), snapshot.content)
  ragFileChanged(path)
  saveSession()
  if (snapshot.content === snapshot.savedContent && !firstSave) return
  void snapshotKey(path)
    .then((key) => recordSnapshot(key, snapshot.content, path, now))
    .then(() => {
      if (app.activeId === snapshot.tabId && app.sidebarView === 'history' && app.sidebarOpen) {
        return loadSnapshotsForActive()
      }
    })
    .catch((err) => console.error('Snapshot échoué', err))
}

// Primitive unique de sauvegarde texte : Ctrl+S, fermeture d'onglet et fermeture
// d'application passent ici. Le snapshot est pris avant le premier await ; aucune
// mutation de DocTab n'arrive avant que l'écriture atomique ait réussi.
export async function saveTabOrSaveAs(tab: DocTab): Promise<boolean> {
  // PDF : lecture seule, aucun contenu texte. Sans cette garde, Ctrl+S écrirait content=''
  // dans le .pdf et DÉTRUIRAIT le fichier (le save n'est PAS gaté sur `changed`).
  const snapshot = snapshotTextTab(tab)
  if (!snapshot) return false
  // Capturés AVANT tout await : on écrit et on archive exactement cette valeur,
  // même si l'utilisateur tape pendant l'écriture asynchrone. `now` capturé ici (et
  // non dans la chaîne async) pour que l'horodatage suive l'ordre d'émission des saves.
  const now = Date.now()
  if (!isTauri) {
    const current = app.tabs.find((item) => item.id === snapshot.tabId)
    if (!current) return false
    current.savedContent = snapshot.content
    return true
  }

  if (tab.path) {
    const path = tab.path
    try {
      await writeTextFileAtomic(path, snapshot.content)
    } catch (err) {
      reportSaveFailure(snapshot.name, err)
      return false
    }
    const current = app.tabs.find((item) => item.id === snapshot.tabId)
    if (!current) return true
    current.savedContent = snapshot.content
    runPostSaveEffects(snapshot, path, now, false)
    return true
  }

  const result = await runSaveAs(snapshot, {
    choosePath: saveTextDialog,
    pathExists: pathExistsAt,
    confirmReplace: confirmReplacePath,
    isPathOwnedByOtherTab: (path, tabId) => {
      const key = canonicalPathKey(path)
      return app.tabs.some((item) => item.id !== tabId && item.path && canonicalPathKey(item.path) === key)
    },
    isTabOpen: (tabId) => app.tabs.some((item) => item.id === tabId),
    write: writeTextFileAtomic,
    commit: (captured, path, name) => {
      const current = app.tabs.find((item) => item.id === captured.tabId)
      if (!current) return false
      current.path = path
      current.name = name
      current.savedContent = captured.content
      return true
    },
    afterCommit: (captured, path) => runPostSaveEffects(captured, path, now, true),
  })

  if (result.status === 'saved') {
    if (!result.attached) {
      app.banner = {
        tone: 'warning',
        title: 'Fichier enregistré',
        message: 'Le document a été fermé pendant l’écriture ; le fichier choisi a tout de même été créé.',
      }
    }
    return true
  }
  if (result.status === 'duplicate') {
    app.banner = {
      tone: 'warning',
      title: 'Fichier déjà ouvert',
      message: 'Ce chemin appartient déjà à un autre onglet. Choisissez un autre nom pour éviter deux versions concurrentes.',
    }
  } else if (result.status === 'error') {
    reportSaveFailure(snapshot.name, result.error)
  }
  return false
}

// Compatibilité transitoire des appels historiques ; les nouveaux chemins doivent
// nommer explicitement la primitive qui inclut Save As.
export async function saveTab(tab: DocTab): Promise<boolean> {
  return saveTabOrSaveAs(tab)
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
    app.banner = {
      tone: 'warning',
      title: 'Version introuvable',
      message: 'Cette version a peut-être été purgée de l’historique.',
    }
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
    app.banner = {
      tone: 'error',
      title: 'Restauration impossible',
      message: `Impossible de restaurer « ${tab.name} » à cause d’une erreur d’écriture.`,
    }
    return
  }
  applyDiskContent(tab, content)
  app.banner = {
    tone: 'success',
    title: 'Version restaurée',
    message: preserved
      ? 'Vos modifications non enregistrées ont été ajoutées à l’historique.'
      : 'Le document utilise maintenant cette version.',
  }
  await loadSnapshotsForActive()
}

// --- Rechargement sur modification externe (FR-3, 3.5) ---

// Adopte le contenu disque dans l'onglet : redevient propre et signale l'éditeur.
function applyDiskContent(tab: DocTab, disk: string) {
  tab.content = disk
  tab.savedContent = disk
  tab.eol = detectLineEnding(disk)
  tab.rev++
  if (tab.path) {
    invalidateSearchDoc(tab.path, tab.name, disk) // restauration / reload externe
    ragFileChanged(tab.path)
  }
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
    app.banner = {
      tone: 'error',
      title: 'Rechargement impossible',
      message: `« ${tab.name} » est illisible ou a été supprimé.`,
    }
    return
  }
  if (disk != null) applyDiskContent(tab, disk)
}

export function dismissReloadPrompt() {
  app.reloadPrompt = null
}

// --- Modal de confirmation (Enregistrer / Ne pas enregistrer / Annuler) ---

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
      'Enregistrer les modifications ?',
      `Voulez-vous enregistrer les modifications apportées à « ${tab.name} » avant de fermer ?`,
    )
    if (choice === 'cancel') return
    if (choice === 'save' && !(await saveTabOrSaveAs(tab))) return
  }
  closeTab(id)
}
