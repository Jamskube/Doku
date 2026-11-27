<script module lang="ts">
  // Raccourcis clavier (Ctrl+Maj+E/P/H/F) : la barre s'ouvre et se ferme sans rideau.
  // À appeler AVANT de basculer la barre : les deux changements partent dans le même
  // rendu, donc la largeur change sous `transition: none`. Deux images plus tard la
  // classe tombe ; le jeton empêche une touche précédente de la retirer sous une répétition.
  const keySnap = $state({ on: false })
  let keySnapToken = 0
  export function snapSidebarToggle() {
    keySnap.on = true
    const token = ++keySnapToken
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (token === keySnapToken) keySnap.on = false
    }))
  }
</script>

<script lang="ts">
  import { app, activeTab, closeTab, collapseExplorer, docHeadings, isDirty, loadBacklinksForActive, loadSnapshotsForActive, openCopilot, openPath, openSearchHit, openSettings, refreshExplorer, relocateOpenTabs, renameKindConflict, restoreSnapshot, runSearch, scrollToLine, setExplorerSort, tabsUnder, toggleExplorerExpanded, type SidebarView } from '../lib/stores.svelte'
  import { baseName, flattenTree, joinPath, nameExists, normalizeNewName, parentPath, pathCrumbs, reachableExpanded, type FsEntry, type SortKey, type TreeRow } from '../lib/explorer'
  import { confirmAction, createDirAt, createFileAt, isTauri, openFolderDialog, readDirectory, renamePathAt, trashPathAt } from '../lib/tauri'
  import { DEMO_DIR } from '../lib/demo'
  import { fileIcon } from '../lib/file-icon'
  import { middleTruncate } from '../lib/middle-truncate'
  import DokuMark from '../lib/DokuMark.svelte'
  import { tooltip } from '../lib/tooltip'
  import { liquidThumb } from '../lib/liquid'
  import CopilotConversationList from './CopilotConversationList.svelte'
  import { copilot } from '../lib/copilot.svelte'
  import { tabLabel } from '../lib/tabs'
  import { tick, untrack } from 'svelte'

  // Plan : titres du Markdown seulement (un .txt/.html n'en a pas), et pas pour un
  // gros fichier (docHeadings O(doc) + DOM de milliers de titres gèlerait — 1.6).
  // docHeadings est mémoïsé côté store : la frappe ne re-scanne pas le document.
  const headings = $derived(
    activeTab()?.kind === 'md' && !activeTab()!.heavy ? docHeadings(activeTab()!.content) : [],
  )
  // Profondeur relative au plus haut niveau présent : un document sans # commence à gauche.
  const minLevel = $derived(headings.reduce((min, h) => Math.min(min, h.level), 6))
  const planDepth = (level: number) => Math.min(level - minLevel, 4)

  // Sélecteur de vue (capsule) : l'ordre est celui des raccourcis du menu Affichage.
  const VIEWS: { id: SidebarView; label: string; tip: string; icon: string; kbd?: string }[] = [
    { id: 'files', label: 'Fichiers', tip: 'Fichiers', icon: 'folder-open', kbd: 'Ctrl+Maj+E' },
    { id: 'search', label: 'Rechercher', tip: 'Rechercher dans le dossier', icon: 'search', kbd: 'Ctrl+Maj+F' },
    { id: 'plan', label: 'Plan', tip: 'Plan du document', icon: 'list', kbd: 'Ctrl+Maj+P' },
    { id: 'history', label: 'Historique', tip: 'Historique des versions', icon: 'rotate-ccw-clock', kbd: 'Ctrl+Maj+H' },
    { id: 'discussions', label: 'Discussions Doku-San', tip: 'Discussions Doku-San', icon: 'message-circle' },
  ]
  const viewIndex = $derived(Math.max(0, VIEWS.findIndex((v) => v.id === app.sidebarView)))
  let switcherEl = $state<HTMLElement | null>(null)

  // Onglets ARIA : ←/→/Début/Fin changent de vue, le focus suit l'onglet choisi.
  function onSwitcherKey(e: KeyboardEvent) {
    const last = VIEWS.length - 1
    const next = e.key === 'ArrowRight' ? (viewIndex + 1) % VIEWS.length
      : e.key === 'ArrowLeft' ? (viewIndex + last) % VIEWS.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? last
      : -1
    if (next < 0) return
    e.preventDefault()
    app.sidebarView = VIEWS[next].id
    void tick().then(() => switcherEl?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus())
  }

  const docName = $derived(activeTab() ? tabLabel(activeTab()!) : null)

  // Pied de carte : moteur et modèle du copilote. Le point est vert seulement quand le
  // fournisseur répond (moteur local démarré, compte connecté) ; sinon il reste neutre.
  const modelStatus = $derived.by(() => {
    if (app.copilotProvider === 'openai') return { provider: 'OpenAI', name: app.openaiModel, on: copilot.openAiAuthenticated === true }
    if (app.copilotProvider === 'minimax') return { provider: 'MiniMax', name: app.minimaxModel, on: !!copilot.minimaxStatus?.connected }
    return { provider: 'Local', name: app.activeModel, on: copilot.ready }
  })

  // Chemin actif + onglets par chemin, dérivés UNE fois : le template de l'arbre les
  // consultait par rangée (deux app.tabs.find × N rangées à chaque rendu).
  const activePath = $derived(activeTab()?.path ?? null)
  const tabsByPath = $derived(new Map(app.tabs.filter((t) => t.path).map((t) => [t.path, t])))

  // Dossier explorateur : navigation explicite, sinon dossier du document actif.
  const targetDir = $derived(app.explorerDir ?? parentPath(activeTab()?.path ?? null))
  const activeDocumentDir = $derived(parentPath(activeTab()?.path ?? null))
  const breadcrumbs = $derived(targetDir ? pathCrumbs(targetDir) : [])
  let navigationHistory = $state<string[]>([])
  let navigationIndex = $state(-1)
  let breadcrumbBar = $state<HTMLDivElement | null>(null)

  // L'historique suit toutes les navigations, y compris celles provoquées par
  // l'ouverture d'un fichier. Revenir/avancer repositionne d'abord l'index pour que
  // l'effet reconnaisse la destination et ne la repousse pas dans la pile.
  $effect(() => {
    const dir = targetDir
    if (!dir || navigationHistory[navigationIndex] === dir) return
    navigationHistory = [...navigationHistory.slice(0, navigationIndex + 1), dir]
    navigationIndex = navigationHistory.length - 1
  })

  $effect(() => {
    void targetDir
    queueMicrotask(() => {
      if (breadcrumbBar) breadcrumbBar.scrollLeft = breadcrumbBar.scrollWidth
      updateCrumbFades()
    })
  })

  // --- Fil d'Ariane : défilement horizontal (molette + drag souris + tactile natif).
  // La scrollbar est masquée : sans ces gestes, un chemin profond devient inatteignable.
  let crumbFadeLeft = $state(false)
  let crumbFadeRight = $state(false)
  let crumbPointer: { id: number; startX: number; startLeft: number } | null = null
  let crumbDragged = false

  function updateCrumbFades() {
    const el = breadcrumbBar
    if (!el) {
      crumbFadeLeft = crumbFadeRight = false
      return
    }
    crumbFadeLeft = el.scrollLeft > 2
    crumbFadeRight = el.scrollLeft + el.clientWidth < el.scrollWidth - 2
  }

  function onCrumbWheel(e: WheelEvent) {
    const el = breadcrumbBar
    if (!el || el.scrollWidth <= el.clientWidth) return
    e.preventDefault()
    el.scrollLeft += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
  }

  function onCrumbPointerDown(e: PointerEvent) {
    // Souris uniquement : le tactile défile nativement (touch-action: pan-x).
    if (e.button !== 0 || e.pointerType !== 'mouse' || !breadcrumbBar) return
    crumbPointer = { id: e.pointerId, startX: e.clientX, startLeft: breadcrumbBar.scrollLeft }
    crumbDragged = false
  }

  function onCrumbPointerMove(e: PointerEvent) {
    if (!crumbPointer || e.pointerId !== crumbPointer.id || !breadcrumbBar) return
    const dx = e.clientX - crumbPointer.startX
    // Seuil : en deçà c'est un clic sur un segment, pas un drag.
    if (!crumbDragged && Math.abs(dx) < 4) return
    if (!crumbDragged) {
      crumbDragged = true
      breadcrumbBar.setPointerCapture(e.pointerId)
    }
    breadcrumbBar.scrollLeft = crumbPointer.startLeft - dx
  }

  function onCrumbPointerUp(e: PointerEvent) {
    if (crumbPointer && e.pointerId === crumbPointer.id && crumbDragged) {
      breadcrumbBar?.releasePointerCapture(e.pointerId)
      // Le click généré par ce relâchement est avalé (capture) ; si aucun click ne
      // suit (relâché hors bouton), le timer remet le flag pour le clic suivant.
      setTimeout(() => (crumbDragged = false), 0)
    }
    crumbPointer = null
  }

  function onCrumbClickCapture(e: MouseEvent) {
    if (crumbDragged) {
      e.preventDefault()
      e.stopPropagation()
      crumbDragged = false
    }
  }

  // Cache des enfants par dossier (racine + dossiers dépliés). Rempli paresseusement :
  // flattenTree ne descend que dans les dossiers présents ici, chaque dossier déplié
  // manquant déclenche UNE lecture (garde `loading`) puis re-rend. Invalidé en bloc
  // au changement de racine, de tri (le stat n'est payé que si tri par date) ou après
  // une création (nonce).
  let childrenByDir = $state(new Map<string, FsEntry[]>())
  const loading = new Set<string>()

  // Débounce de la recherche : chaque frappe balayait l'index entier (des Mo de texte).
  // 150 ms suffisent à coalescer une rafale de frappe ; vider le champ réagit immédiatement
  // (l'état « Tapez pour chercher » ne doit pas traîner).
  let searchTimer: ReturnType<typeof setTimeout> | undefined
  function onSearchInput(value: string) {
    clearTimeout(searchTimer)
    if (!value.trim()) {
      runSearch(value)
      return
    }
    searchTimer = setTimeout(() => runSearch(value), 150)
  }

  // Vide le champ lui-même : `app.searchQuery` retarde de 150 ms sur la frappe, donc
  // `value={app.searchQuery}` ne changerait pas si l'effacement suit de près la saisie.
  function clearSearch() {
    if (searchInput) searchInput.value = ''
    onSearchInput('')
    searchInput?.focus()
  }

  function onSearchKey(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !searchInput?.value) return
    e.preventDefault()
    e.stopPropagation()
    clearSearch()
  }

  const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`
  const searchStatus = $derived.by(() => {
    if (app.searchResults.length) {
      const hits = app.searchResults.reduce((sum, r) => sum + r.count, 0)
      return `${plural(app.searchResults.length, 'fichier')} · ${plural(hits, 'résultat')}`
    }
    return app.searching ? 'Recherche…' : 'Aucun résultat.'
  })

  const expandedSet = $derived(new Set(app.explorerExpanded))
  const treeRows = $derived(targetDir ? flattenTree(targetDir, childrenByDir, expandedSet, app.explorerSort) : [])
  const hasExpanded = $derived(targetDir ? reachableExpanded(targetDir, expandedSet).length > 0 : false)
  // Compat création en place : la liste de la racine sert aux contrôles de conflit.
  const entries = $derived(targetDir ? (childrenByDir.get(targetDir) ?? []) : [])

  async function loadChildren(dir: string) {
    if (loading.has(dir)) return
    loading.add(dir)
    try {
      const raw = isTauri ? await readDirectory(dir, app.explorerSort.key === 'modified') : DEMO_DIR
      // Map réassignée (pas mutée) : $state ne tracke pas Map.set en profondeur fiable
      // pour un $derived — la réassignation garantit le re-rendu.
      const next = new Map(childrenByDir)
      next.set(dir, raw)
      childrenByDir = next
    } catch {
      // Dossier illisible (droits, disparu) : entrée vide pour ne pas boucler.
      const next = new Map(childrenByDir)
      next.set(dir, [])
      childrenByDir = next
    } finally {
      loading.delete(dir)
    }
  }

  $effect(() => {
    const dir = targetDir
    void app.explorerSort
    void app.explorerNonce // dépendance explicite : rejoue après une création
    childrenByDir = new Map()
    loading.clear()
    // untrack : loadChildren lit childrenByDir AVANT tout await en mode navigateur
    // (DEMO_DIR synchrone) → sans lui, l'effet se re-déclenche en boucle (vécu).
    if (dir) untrack(() => void loadChildren(dir))
  })

  // Charge les enfants des dossiers dépliés visibles pas encore en cache.
  // `untrack` sur l'appel : loadChildren lit et écrit childrenByDir (self-retrigger sinon).
  $effect(() => {
    const dir = targetDir
    if (!dir) return
    const missing = reachableExpanded(dir, expandedSet).filter((p) => !childrenByDir.has(p))
    if (missing.length) untrack(() => missing.forEach((p) => void loadChildren(p)))
  })

  // --- Création d'une note / d'un dossier (saisie en place, 19.1) ---
  let creating = $state<'file' | 'dir' | null>(null)
  let draftName = $state('')
  let createError = $state<string | null>(null)
  let busy = $state(false)
  let nameInput = $state<HTMLInputElement | null>(null)

  // Le champ n'existe qu'en mode création : on le focus dès qu'il est monté.
  $effect(() => {
    if (creating) nameInput?.focus()
  })

  // La création exige un vrai dossier ET l'hôte natif : en mode navigateur (dev UI)
  // l'écriture est un no-op, mieux vaut désactiver que faire échouer silencieusement.
  const canCreate = $derived(!!targetDir && isTauri && !busy)
  const createHint = $derived(
    !isTauri ? 'Disponible dans l’application' : 'Ouvrez un fichier pour choisir un dossier',
  )

  function startCreate(kind: 'file' | 'dir') {
    if (!canCreate) return
    creating = kind
    draftName = ''
    createError = null
  }

  function cancelCreate() {
    creating = null
    draftName = ''
    createError = null
  }

  async function commitCreate() {
    if (!creating || !targetDir || busy) return
    const kind = creating
    const checked = normalizeNewName(draftName, kind)
    if (!checked.ok) {
      createError = checked.error
      return
    }
    // Conflit détecté sur la liste affichée ET re-vérifié sur disque par
    // createFileAt/createDirAt : la liste peut être périmée (création externe).
    if (nameExists(checked.name, entries)) {
      createError = 'Ce nom existe déjà dans ce dossier.'
      return
    }
    const full = joinPath(targetDir, checked.name)
    busy = true
    try {
      const created = kind === 'file' ? await createFileAt(full) : await createDirAt(full)
      if (!created) {
        createError = 'Ce nom existe déjà dans ce dossier.'
        return
      }
      cancelCreate()
      refreshExplorer()
      // Une note créée s'ouvre aussitôt (c'est le geste attendu) ; un dossier non,
      // on reste dans le dossier courant pour le voir apparaître dans la liste.
      if (kind === 'file') await openPath(full)
    } catch {
      createError = "Création impossible (droits ou disque). Rien n'a été écrit."
    } finally {
      busy = false
    }
  }

  function onNameKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      void commitCreate()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelCreate()
    }
  }

  // --- Actions sur une entrée : renommer, déplacer, supprimer (clic droit, F2, Suppr) ---
  let rowMenu = $state<{ row: TreeRow; x: number; y: number; kbd: boolean; trigger: HTMLElement } | null>(null)
  // Menu ouvert au clavier (touche Menu, Maj+F10) : pas d'animation d'entrée. Le keydown
  // précède le contextmenu qu'il déclenche ; ce dernier consomme le drapeau.
  let rowMenuFromKey = false
  let rowMenuEl = $state<HTMLElement | null>(null)
  let renaming = $state<string | null>(null)
  let renameDraft = $state('')
  let renameError = $state<string | null>(null)
  let renameInput = $state<HTMLInputElement | null>(null)

  // Le nom est sélectionné sans son extension : c'est lui qu'on retape, pas le `.md`.
  $effect(() => {
    if (!renaming || !renameInput) return
    renameInput.focus()
    const dot = renameDraft.lastIndexOf('.')
    renameInput.setSelectionRange(0, dot > 0 ? dot : renameDraft.length)
  })

  // Retrait plafonné à 8 niveaux : au-delà, le libellé tombait à 0 px et le chevron
  // sortait de la ligne.
  const indent = (depth: number) => Math.min(depth, 8) * 16
  // Caractères visibles d'un libellé de rangée (~6,5 px par caractère à 13 px, 16 px de
  // retrait par niveau). Sans mesure DOM : l'ellipse CSS de fin reste le dernier recours.
  const labelMax = (depth: number) => 28 - Math.round(Math.min(depth, 8) * 2.5)

  function openRowMenu(e: MouseEvent, row: TreeRow) {
    const kbd = rowMenuFromKey
    rowMenuFromKey = false
    if (!isTauri) return
    e.preventDefault()
    headerMenu = false
    rowMenu = { row, x: e.clientX, y: e.clientY, kbd, trigger: e.currentTarget as HTMLElement }
    if (kbd) void tick().then(() => focusMenuItem(rowMenuEl))
  }

  // Menu focalisé (clavier) qu'une action referme : le focus rejoint le déclencheur AVANT le
  // dialogue qui suit, sinon il tombe sur <body> et le dialogue le rend à <body>.
  const menuHasFocus = () => rowMenuEl?.contains(document.activeElement) ?? false

  function closeRowMenu(restoreFocus = false) {
    const trigger = rowMenu?.trigger
    rowMenu = null
    if (restoreFocus) trigger?.focus()
  }

  // Clavier des menus (motif de TitleBar) : ↑/↓/Début/Fin entre les entrées actives,
  // Échap referme et rend le focus au déclencheur.
  const menuItems = (menu: HTMLElement | null) =>
    Array.from(menu?.querySelectorAll<HTMLButtonElement>(':scope > button:not(:disabled)') ?? [])

  function focusMenuItem(menu: HTMLElement | null, last = false) {
    const items = menuItems(menu)
    items[last ? items.length - 1 : 0]?.focus()
  }

  function navigateMenu(e: KeyboardEvent) {
    const items = menuItems(e.currentTarget as HTMLElement)
    if (!items.length) return false
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    let next: number
    if (e.key === 'ArrowDown') next = index < 0 ? 0 : (index + 1) % items.length
    else if (e.key === 'ArrowUp') next = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = items.length - 1
    else return false
    e.preventDefault()
    e.stopPropagation()
    items[next].focus()
    return true
  }

  function onRowMenuKey(e: KeyboardEvent) {
    if (navigateMenu(e) || e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    closeRowMenu(true)
  }

  function startRename(row: TreeRow) {
    closeRowMenu()
    cancelCreate()
    renaming = row.path
    renameDraft = row.entry.name
    renameError = null
  }

  function cancelRename() {
    renaming = null
    renameDraft = ''
    renameError = null
  }

  async function commitRename() {
    if (!renaming || busy) return
    const oldPath = renaming
    const isDir = treeRows.find((r) => r.path === oldPath)?.entry.isDir ?? false
    if (renameDraft.trim() === baseName(oldPath)) {
      cancelRename()
      return
    }
    const checked = normalizeNewName(renameDraft, isDir ? 'dir' : 'file')
    if (!checked.ok) {
      renameError = checked.error
      return
    }
    const newPath = joinPath(parentPath(oldPath) ?? targetDir ?? '', checked.name)
    const conflict = renameKindConflict(oldPath, newPath)
    if (conflict) {
      renameError = conflict
      return
    }
    busy = true
    try {
      if (!(await renamePathAt(oldPath, newPath))) {
        renameError = 'Ce nom existe déjà dans ce dossier.'
        return
      }
      relocateOpenTabs(oldPath, newPath)
      cancelRename()
      refreshExplorer()
    } catch {
      renameError = 'Renommage impossible (droits, ou fichier ouvert dans une autre application).'
    } finally {
      busy = false
    }
  }

  function onRenameKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      void commitRename()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelRename()
    }
  }

  async function moveRow(row: TreeRow) {
    closeRowMenu(menuHasFocus())
    const dest = await openFolderDialog(parentPath(row.path))
    if (!dest) return
    const newPath = joinPath(dest, row.entry.name)
    if (newPath === row.path) return
    if (row.entry.isDir && (dest === row.path || dest.startsWith(row.path + '\\') || dest.startsWith(row.path + '/'))) {
      app.banner = { tone: 'error', title: 'Déplacement impossible', message: 'Un dossier ne peut pas être déplacé dans lui-même.' }
      return
    }
    busy = true
    try {
      if (!(await renamePathAt(row.path, newPath))) {
        app.banner = { tone: 'error', title: 'Déplacement impossible', message: `« ${row.entry.name} » existe déjà dans le dossier choisi. Rien n’a été déplacé.` }
        return
      }
      relocateOpenTabs(row.path, newPath)
      refreshExplorer()
    } catch {
      app.banner = { tone: 'error', title: 'Déplacement impossible', message: 'Le déplacement a échoué (autre disque, droits, ou fichier ouvert ailleurs). Rien n’a été déplacé.' }
    } finally {
      busy = false
    }
  }

  async function deleteRow(row: TreeRow) {
    closeRowMenu(menuHasFocus())
    const open = tabsUnder(row.path)
    if (open.some(isDirty)) {
      app.banner = { tone: 'warning', title: 'Modifications non enregistrées', message: `« ${row.entry.name} » est ouvert avec des modifications. Enregistrez-le ou fermez-le d’abord.` }
      return
    }
    const ok = await confirmAction(
      row.entry.isDir ? 'Supprimer le dossier ?' : 'Supprimer le fichier ?',
      `« ${row.entry.name} » sera envoyé à la corbeille du système.`,
    )
    if (!ok) return
    busy = true
    try {
      await trashPathAt(row.path)
      for (const tab of open) closeTab(tab.id)
      refreshExplorer()
    } catch {
      app.banner = { tone: 'error', title: 'Suppression impossible', message: `« ${row.entry.name} » n’a pas pu être envoyé à la corbeille. Rien n’a été supprimé.` }
    } finally {
      busy = false
    }
  }

  // --- Arbre au clavier (motif treeview + nav-list Kube) : un seul arrêt Tab ---
  // L'arrêt suit la dernière rangée focalisée tant que le document actif n'a pas changé ;
  // ensuite il revient sur la rangée du document actif, sinon sur la première.
  let treeEl = $state<HTMLElement | null>(null)
  let lastFocus = $state<{ path: string; active: string | null } | null>(null)
  const tabStop = $derived.by(() => {
    const has = (p: string | null | undefined) => !!p && treeRows.some((r) => r.path === p)
    if (lastFocus && lastFocus.active === activePath && has(lastFocus.path)) return lastFocus.path
    return has(activePath) ? activePath : (treeRows[0]?.path ?? null)
  })
  // Chevrons déjà basculés au clavier : sans rotation animée (règle `.kbd`, jamais retirée).
  let kbdToggled = $state(new Set<string>())

  function focusRow(path: string | undefined) {
    if (!path) return
    treeEl?.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`)?.focus()
  }

  function toggleFromKey(row: TreeRow) {
    if (!kbdToggled.has(row.path)) kbdToggled = new Set(kbdToggled).add(row.path)
    toggleExplorerExpanded(row.path)
  }

  function onRowKey(e: KeyboardEvent, row: TreeRow) {
    const i = treeRows.findIndex((r) => r.path === row.path)
    const expanded = row.entry.isDir && expandedSet.has(row.path)
    let handled = true
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      rowMenuFromKey = true
      handled = false
    } else if (e.key === 'F2') startRename(row)
    else if (e.key === 'Delete') void deleteRow(row)
    else if (e.altKey || e.ctrlKey || e.metaKey) handled = false
    else if (e.key === 'ArrowDown') focusRow(treeRows[i + 1]?.path)
    else if (e.key === 'ArrowUp') focusRow(treeRows[i - 1]?.path)
    else if (e.key === 'Home') focusRow(treeRows[0]?.path)
    else if (e.key === 'End') focusRow(treeRows.at(-1)?.path)
    else if (e.key === 'ArrowRight') {
      if (row.entry.isDir && !expanded) toggleFromKey(row)
      else if (expanded && treeRows[i + 1]?.depth === row.depth + 1) focusRow(treeRows[i + 1].path)
    } else if (e.key === 'ArrowLeft') {
      if (expanded) toggleFromKey(row)
      else focusRow(treeRows.slice(0, i).findLast((r) => r.depth === row.depth - 1)?.path)
    } else if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
      if (row.entry.isDir) toggleFromKey(row)
      else void openPath(row.path)
    } else handled = false
    if (handled) e.preventDefault()
  }

  // --- Menu d'en-tête (actions rares + tri) ---
  let headerMenu = $state(false)
  // `detail === 0` = clic synthétisé par Entrée/Espace : ouvert au clavier, pas d'animation.
  let headerMenuKbd = $state(false)
  let headerMenuTrigger = $state<HTMLButtonElement | null>(null)
  let headerMenuEl = $state<HTMLElement | null>(null)

  async function onHeaderTriggerKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && headerMenu) {
      e.preventDefault()
      headerMenu = false
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) return
    // Ouvert au clavier : le focus entre dans le menu (sans animation d'entrée).
    e.preventDefault()
    headerMenuKbd = true
    headerMenu = true
    await tick()
    focusMenuItem(headerMenuEl, e.key === 'ArrowUp')
  }

  function onHeaderMenuKey(e: KeyboardEvent) {
    if (navigateMenu(e) || e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    headerMenu = false
    headerMenuTrigger?.focus()
  }
  const SORT_LABELS: Record<SortKey, string> = { name: 'Nom', modified: 'Modifié le', type: 'Type' }
  const SORT_KEYS: SortKey[] = ['name', 'modified', 'type']

  // Le menu reste ouvert : re-cliquer la clé active inverse le sens, et l'utilisateur
  // voit la flèche basculer — le fermer forcerait deux ouvertures pour un aller-retour.
  function chooseSort(key: SortKey) {
    setExplorerSort(key)
  }

  // Clic dossier = déplier/replier EN PLACE (l'arborescence est la navigation) ;
  // double-clic dossier = en faire la racine affichée (le clic simple aura toggle
  // deux fois → état net inchangé, puis on descend). Clic fichier = ouvrir.
  function onRowClick(row: TreeRow) {
    if (row.entry.isDir) toggleExplorerExpanded(row.path)
    else void openPath(row.path)
  }

  function onRowDblClick(row: TreeRow) {
    if (row.entry.isDir) navigateTo(row.path)
  }

  function navigateTo(dir: string | null) {
    if (!dir || dir === targetDir) return
    cancelCreate()
    app.explorerDir = dir
  }

  function navigateBack() {
    if (navigationIndex <= 0) return
    navigationIndex -= 1
    cancelCreate()
    app.explorerDir = navigationHistory[navigationIndex]
  }

  function navigateForward() {
    if (navigationIndex >= navigationHistory.length - 1) return
    navigationIndex += 1
    cancelCreate()
    app.explorerDir = navigationHistory[navigationIndex]
  }

  function followActiveDocument() {
    if (!activeDocumentDir || activeDocumentDir === targetDir) return
    cancelCreate()
    app.explorerDir = null
  }

  async function chooseFolder() {
    const selected = await openFolderDialog(targetDir)
    if (selected) navigateTo(selected)
  }

  // Liens entrants : chargés à l'ouverture du plan et à chaque changement d'onglet. Une
  // sauvegarde met l'index à jour (invalidateSearchDoc) ; la liste suit au prochain passage.
  $effect(() => {
    if (app.sidebarView === 'plan' && app.sidebarOpen) {
      void activeTab()?.id
      void loadBacklinksForActive()
    }
  })

  // Charge l'historique du fichier actif quand le panneau est ouvert ; recharge au
  // changement d'onglet (dépendance activeTab().id). Les saves rafraîchissent via saveTab.
  $effect(() => {
    if (app.sidebarView === 'history' && app.sidebarOpen) {
      void activeTab()?.id
      void loadSnapshotsForActive()
    }
  })

  // Historique en rail chronologique : Aujourd'hui / Hier / Plus tôt.
  type Snapshot = (typeof app.snapshots)[number]
  const snapshotGroups = $derived.by(() => {
    const now = new Date()
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const groups: { key: string; label: string; older: boolean; items: Snapshot[] }[] = [
      { key: 'today', label: 'Aujourd’hui', older: false, items: [] },
      { key: 'yesterday', label: 'Hier', older: false, items: [] },
      { key: 'older', label: 'Plus tôt', older: true, items: [] },
    ]
    for (const snap of app.snapshots) {
      groups[snap.time >= startToday ? 0 : snap.time >= startToday - 86_400_000 ? 1 : 2].items.push(snap)
    }
    return groups.filter((g) => g.items.length)
  })
  const formatSnapshotTime = (time: number) => new Date(time).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

  function formatSnapshotDate(time: number): string {
    return new Date(time).toLocaleString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  // Focus automatique du champ quand le panneau de recherche s'ouvre (Ctrl+Maj+F).
  // Ne dépend que de la vue/état sidebar → non re-déclenché à chaque frappe.
  let searchInput = $state<HTMLInputElement | null>(null)
  $effect(() => {
    if (app.sidebarView === 'search' && app.sidebarOpen) searchInput?.focus()
  })

  // Repliée, la barre (largeur 0) devient `inert`. Le focus qui y était rejoint le bouton
  // « déplier » de la barre de titre, qui n'est plus inerte qu'APRÈS la mise à jour du DOM.
  let asideEl = $state<HTMLElement | null>(null)
  $effect.pre(() => {
    if (!app.sidebarOpen && asideEl?.contains(document.activeElement)) {
      void tick().then(() => document.querySelector<HTMLElement>('.titlebar .rail-btn')?.focus())
    }
  })

</script>

<aside
  class="sidebar"
  class:open={app.sidebarOpen}
  class:covered={app.copilotExpanded}
  class:snap={keySnap.on}
  aria-hidden={app.copilotExpanded || !app.sidebarOpen}
  inert={app.copilotExpanded || !app.sidebarOpen}
  bind:this={asideEl}
>
  <div class="inner">
    <div class="card">
      <header class="brand" data-tauri-drag-region>
        <button class="brand-mark" use:tooltip={'À propos de Doku'} aria-label="À propos de Doku" onclick={() => openSettings('about')}>
          <DokuMark size={18} />
          <span class="brand-name">Doku</span>
        </button>
        <button
          class="icon-btn"
          use:tooltip={'Replier la barre latérale'}
          aria-label="Replier la barre latérale"
          onclick={() => (app.sidebarOpen = false)}
        >
          <svg width="18" height="18" viewBox="-0.5 -0.5 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5.625 2.1875v10.625M1.875 5.875c0 -1.4 0 -2.1 0.2725 -2.635a2.5 2.5 0 0 1 1.0925 -1.0925C3.775 1.875 4.475 1.875 5.875 1.875h3.25c1.4 0 2.1 0 2.635 0.2725a2.5 2.5 0 0 1 1.0925 1.0925C13.125 3.775 13.125 4.475 13.125 5.875v3.25c0 1.4 0 2.1 -0.2725 2.635a2.5 2.5 0 0 1 -1.0925 1.0925C11.225 13.125 10.525 13.125 9.125 13.125H5.875c-1.4 0 -2.1 0 -2.635 -0.2725a2.5 2.5 0 0 1 -1.0925 -1.0925C1.875 11.225 1.875 10.525 1.875 9.125z" /></svg>
        </button>
      </header>

      <!-- Sélecteur de vue : capsule à pastille glissante (onglets ARIA, un seul arrêt Tab). -->
      <div class="switcher" role="tablist" aria-label="Vues de la barre latérale" bind:this={switcherEl} use:liquidThumb>
        <!-- Enveloppe : liquidThumb observe la taille des enfants directs, et la pastille qui
             s'étire relançait une pose sèche qui coupait son propre trajet. -->
        <span class="switcher-track" aria-hidden="true"><span class="switcher-pill" data-liquid-thumb></span></span>
        {#each VIEWS as view, i (view.id)}
          <button
            role="tab"
            id={`sidebar-tab-${view.id}`}
            aria-selected={i === viewIndex}
            aria-controls="sidebar-view"
            tabindex={i === viewIndex ? 0 : -1}
            aria-label={view.label}
            use:tooltip={view.kbd ? { label: view.tip, kbd: view.kbd } : view.tip}
            onclick={() => (app.sidebarView = view.id)}
            onkeydown={onSwitcherKey}
          >
            <svg class="icon" aria-hidden="true"><use href="#i-{view.icon}" /></svg>
          </button>
        {/each}
      </div>

      <div class="panel" id="sidebar-view" role="tabpanel" aria-labelledby={`sidebar-tab-${VIEWS[viewIndex].id}`}>
        {#if app.sidebarView === 'discussions'}
          <CopilotConversationList />
        {:else}
          {@const subtitle = app.sidebarView === 'search' ? (targetDir ? `Dans ${baseName(targetDir)}` : null) : app.sidebarView === 'files' ? null : docName}
          <div class="panel-head">
            <div class="head-text">
              <h2 class="panel-title">{VIEWS[viewIndex].label}</h2>
              {#if subtitle}<p class="panel-sub" title={subtitle}>{subtitle}</p>{/if}
            </div>
            {#if app.sidebarView === 'files'}
          <div class="actions">
            <button
              use:tooltip={canCreate ? 'Nouvelle note' : ''}
              title={canCreate ? undefined : createHint}
              aria-label="Nouvelle note"
              disabled={!canCreate}
              onclick={() => startCreate('file')}
            ><svg class="icon" aria-hidden="true"><use href="#i-square-pen" /></svg></button>
            <button
              use:tooltip={canCreate ? 'Nouveau dossier' : ''}
              title={canCreate ? undefined : createHint}
              aria-label="Nouveau dossier"
              disabled={!canCreate}
              onclick={() => startCreate('dir')}
            ><svg class="icon" aria-hidden="true"><use href="#i-folder-plus" /></svg></button>
            <div
              class="sort-wrap"
              onfocusout={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) headerMenu = false
              }}
            >
              <button
                class:active={headerMenu}
                use:tooltip={'Plus d’options'}
                aria-label="Plus d’options"
                aria-haspopup="menu"
                aria-expanded={headerMenu}
                bind:this={headerMenuTrigger}
                onkeydown={onHeaderTriggerKey}
                onclick={(e) => {
                  if (!headerMenu) headerMenuKbd = e.detail === 0
                  headerMenu = !headerMenu
                }}
              ><svg class="icon" aria-hidden="true"><use href="#i-ellipsis" /></svg></button>
              {#if headerMenu}
                <div class="sort-menu" class:kbd={headerMenuKbd} role="menu" tabindex="-1" aria-label="Plus d’options" bind:this={headerMenuEl} onkeydown={onHeaderMenuKey}>
                  <button role="menuitem" disabled={!isTauri} onclick={() => { headerMenu = false; void chooseFolder() }}>
                    <svg class="icon tick" aria-hidden="true"><use href="#i-folder-open" /></svg>
                    <span class="grow">Ouvrir un dossier…</span>
                  </button>
                  <button
                    role="menuitem"
                    disabled={!activeDocumentDir || activeDocumentDir === targetDir}
                    onclick={() => { headerMenu = false; followActiveDocument() }}
                  >
                    <svg class="icon tick" aria-hidden="true"><use href="#i-locate-fixed" /></svg>
                    <span class="grow">Aller au document actif</span>
                  </button>
                  <button
                    role="menuitem"
                    disabled={!hasExpanded}
                    onclick={() => { headerMenu = false; if (targetDir) collapseExplorer(targetDir) }}
                  >
                    <svg class="icon tick" aria-hidden="true"><use href="#i-chevrons-down-up" /></svg>
                    <span class="grow">Tout replier</span>
                  </button>
                  <div class="menu-sep" role="separator"></div>
                  <span class="menu-head">Trier par</span>
                  {#each SORT_KEYS as key (key)}
                    <button role="menuitem" class:on={app.explorerSort.key === key} onclick={() => chooseSort(key)}>
                      <svg class="icon tick" aria-hidden="true"><use href="#i-{app.explorerSort.key === key ? 'check' : ''}" /></svg>
                      <span class="grow">{SORT_LABELS[key]}</span>
                      {#if app.explorerSort.key === key}
                        <svg class="icon arrow" aria-hidden="true"><use href="#i-{app.explorerSort.order === 'asc' ? 'arrow-up' : 'arrow-down'}" /></svg>
                      {/if}
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          </div>
            {/if}
          </div>

      {#if app.sidebarView === 'files' && targetDir}
        <div class="explorer-nav">
          <div class="nav-controls">
            <button class="nav-btn" use:tooltip={'Dossier précédent'} aria-label="Dossier précédent" disabled={navigationIndex <= 0} onclick={navigateBack}>
              <svg class="icon" aria-hidden="true"><use href="#i-arrow-left" /></svg>
            </button>
            <button class="nav-btn" use:tooltip={'Dossier suivant'} aria-label="Dossier suivant" disabled={navigationIndex >= navigationHistory.length - 1} onclick={navigateForward}>
              <svg class="icon" aria-hidden="true"><use href="#i-arrow-right" /></svg>
            </button>
          </div>

          <!-- svelte-ignore a11y_no_static_element_interactions (couche de défilement : les vraies cibles sont les boutons enfants, accessibles au clavier) -->
          <div
            class="breadcrumbs"
            class:fade-left={crumbFadeLeft}
            class:fade-right={crumbFadeRight}
            bind:this={breadcrumbBar}
            aria-label="Chemin du dossier"
            onwheel={onCrumbWheel}
            onpointerdown={onCrumbPointerDown}
            onpointermove={onCrumbPointerMove}
            onpointerup={onCrumbPointerUp}
            onpointercancel={onCrumbPointerUp}
            onclickcapture={onCrumbClickCapture}
            onscroll={updateCrumbFades}
          >
            {#each breadcrumbs as crumb, index (crumb.path)}
              {#if index > 0}<svg class="icon crumb-separator" aria-hidden="true"><use href="#i-chevron-right" /></svg>{/if}
              <button
                class:current={index === breadcrumbs.length - 1}
                title={crumb.path}
                aria-label={`Ouvrir ${crumb.path}`}
                disabled={index === breadcrumbs.length - 1}
                onclick={() => navigateTo(crumb.path)}
              >{crumb.label}</button>
            {/each}
          </div>
        </div>
      {/if}

      <div class="panel-body">
        {#if app.sidebarView === 'files'}
          {#if targetDir}
            {#if creating}
              <div class="newrow">
                <svg class="icon fold" aria-hidden="true"><use href="#i-{creating === 'dir' ? 'folder-plus' : 'file-text'}" /></svg>
                <!-- svelte-ignore a11y_autofocus -->
                <input
                  bind:this={nameInput}
                  bind:value={draftName}
                  class="newname"
                  placeholder={creating === 'dir' ? 'Nom du dossier' : 'Nom de la note'}
                  aria-label={creating === 'dir' ? 'Nom du nouveau dossier' : 'Nom de la nouvelle note'}
                  disabled={busy}
                  onkeydown={onNameKey}
                  onblur={() => { if (!busy) cancelCreate() }}
                />
              </div>
              {#if createError}<p class="newerr" role="alert">{createError}</p>{/if}
            {/if}
            {#if treeRows.length}
            <div class="tree" role="tree" aria-label="Fichiers du dossier" bind:this={treeEl}>
            {#each treeRows as row (row.path)}
              {@const open = tabsByPath.get(row.path)}
              {@const expanded = row.entry.isDir && expandedSet.has(row.path)}
              {@const dirty = !!open && isDirty(open)}
              {#if renaming === row.path}
                <!-- Enfant direct du tree = treeitem : la saisie et son alerte vivent dedans, l'alerte
                     reste sous le champ. Nom fixé : sinon il agrégerait la saisie et l'erreur. -->
                <div role="treeitem" aria-level={row.depth + 1} aria-selected="false" aria-label={`Renommer ${row.entry.name}`}>
                <div class="newrow" style={`padding-left: ${26 + indent(row.depth)}px`}>
                  <svg class="icon fold" aria-hidden="true"><use href="#i-{fileIcon(row.entry.name, row.entry.isDir)}" /></svg>
                  <input
                    bind:this={renameInput}
                    bind:value={renameDraft}
                    class="newname"
                    aria-label={`Nouveau nom de ${row.entry.name}`}
                    disabled={busy}
                    onkeydown={onRenameKey}
                    onblur={() => { if (!busy) cancelRename() }}
                  />
                </div>
                {#if renameError}<p class="newerr" role="alert">{renameError}</p>{/if}
                </div>
              {:else}
              <!-- Le nom complet est le nom accessible : le libellé visible peut être tronqué. -->
              <div
                class="row"
                class:current={!row.entry.isDir && activePath === row.path}
                role="treeitem"
                tabindex={row.path === tabStop ? 0 : -1}
                data-path={row.path}
                title={row.path}
                aria-label={dirty ? `${row.entry.name}, non enregistré` : row.entry.name}
                aria-level={row.depth + 1}
                aria-expanded={row.entry.isDir ? expanded : undefined}
                aria-selected={!row.entry.isDir && activePath === row.path}
                style={`padding-left: ${8 + indent(row.depth)}px`}
                onclick={() => onRowClick(row)}
                ondblclick={() => onRowDblClick(row)}
                oncontextmenu={(e) => openRowMenu(e, row)}
                onkeydown={(e) => onRowKey(e, row)}
                onfocus={() => (lastFocus = { path: row.path, active: activePath })}
              >
                {#if row.entry.isDir}
                  <svg class="icon twist" class:open={expanded} class:kbd={kbdToggled.has(row.path)} aria-hidden="true"><use href="#i-chevron-right" /></svg>
                {:else}
                  <span class="twist-spacer" aria-hidden="true"></span>
                {/if}
                <svg class="icon fold" aria-hidden="true"><use href="#i-{fileIcon(row.entry.name, row.entry.isDir, expanded)}" /></svg>
                <span class="label grow" aria-hidden="true">{middleTruncate(row.entry.name, labelMax(row.depth))}</span>
                {#if dirty}<span class="filedot" aria-hidden="true"></span>{/if}
              </div>
              {/if}
            {/each}
            </div>
            {:else}
              <p class="empty">Dossier vide</p>
            {/if}
          {:else}
            <div class="folder-empty">
              <svg class="icon" aria-hidden="true"><use href="#i-folder-open" /></svg>
              <strong>Choisissez un dossier</strong>
              <p>Accédez directement à l’emplacement que vous souhaitez parcourir.</p>
              <button disabled={!isTauri} onclick={() => void chooseFolder()}>Ouvrir un dossier</button>
            </div>
          {/if}
        {:else if app.sidebarView === 'plan'}
          <div class="plan">
            <!-- Non keyé volontairement : les rangées sont homogènes, Svelte les met à
                 jour en place. Keyer sur h.line détruisait/recréait tout le plan à chaque
                 retour chariot (toutes les lignes suivantes changent de numéro). -->
            {#each headings as h}
              {@const depth = planDepth(h.level)}
              {@const current = h.line === app.activeHeadingLine}
              <button
                class="plan-row"
                class:top={depth === 0}
                class:active={current}
                style:--depth={depth}
                aria-current={current ? 'location' : undefined}
                title={h.text}
                dir="auto"
                onclick={() => scrollToLine(h.line)}
              >
                {#if depth}<span class="plan-guides" aria-hidden="true"></span>{/if}
                <span class="plan-text">{h.text}</span>
              </button>
            {:else}
              <p class="empty">Pas de titres dans ce document</p>
            {/each}
            {#if activeTab()?.kind === 'md' && activeTab()?.path}
              <h3 class="section-head">Liens entrants{#if app.backlinksFor === activeTab()?.id && app.backlinks.length}<span class="section-count">{app.backlinks.length}</span>{/if}</h3>
              {#if app.backlinksFor !== activeTab()?.id}
                <p class="empty">Recherche…</p>
              {:else}
                {#each app.backlinks as link (link.path + ':' + link.line + ':' + link.col)}
                  <button class="backlink" title={link.path} onclick={() => void openSearchHit(link.path, link.line, link.col, link.length)}>
                    <span class="backlink-name">{link.name.replace(/\.(md|markdown)$/i, '')}</span>
                    <span class="backlink-ctx">{link.context}</span>
                  </button>
                {:else}
                  <p class="empty">Aucune note ne cite ce document par un [[lien]]</p>
                {/each}
              {/if}
            {/if}
          </div>
        {:else if app.sidebarView === 'search'}
          <div class="search">
            <div class="search-field" role="search">
              <svg class="icon" aria-hidden="true"><use href="#i-search" /></svg>
              <input
                class="search-input"
                type="search"
                placeholder="Rechercher dans le dossier…"
                aria-label="Rechercher dans le dossier"
                value={app.searchQuery}
                bind:this={searchInput}
                oninput={(e) => onSearchInput(e.currentTarget.value)}
                onkeydown={onSearchKey}
              />
              <!-- Masqué par CSS tant que le champ est vide (:placeholder-shown) : pas d'état à suivre. -->
              <button class="search-clear" type="button" use:tooltip={'Effacer la recherche'} aria-label="Effacer la recherche" onclick={clearSearch}>
                <svg class="icon" aria-hidden="true"><use href="#i-x" /></svg>
              </button>
            </div>
            {#if !app.searchQuery.trim()}
              <p class="empty">Tapez pour chercher dans le dossier et ses sous-dossiers.</p>
            {:else}
              <p class="search-status" role="status">{searchStatus}</p>
              {#each app.searchResults as result (result.path)}
                <div class="result">
                  <button
                    class="result-file"
                    title={result.path}
                    aria-label={`${result.name}, ${plural(result.count, 'résultat')}`}
                    onclick={() => (result.hits[0] ? openSearchHit(result.path, result.hits[0].line, result.hits[0].col, result.hits[0].length) : openPath(result.path))}
                  >
                    <svg class="icon fold" aria-hidden="true"><use href="#i-{fileIcon(result.name)}" /></svg>
                    <span class="label grow">{middleTruncate(result.name, 24)}</span>
                    <span class="count">{result.count}</span>
                  </button>
                  {#each result.hits as hit (hit.line)}
                    <button class="hit" onclick={() => openSearchHit(result.path, hit.line, hit.col, hit.length)}>
                      <span class="hit-line">{hit.line}</span>
                      <span class="hit-text">{hit.snippet.slice(0, hit.start)}<mark class="hl">{hit.snippet.slice(hit.start, hit.end)}</mark>{hit.snippet.slice(hit.end)}</span>
                    </button>
                  {/each}
                </div>
              {/each}
            {/if}
          </div>
        {:else}
          <div class="history">
            {#if !activeTab()?.path}
              <p class="empty">Enregistrez le document pour créer un historique.</p>
            {:else if app.snapshotsFor !== activeTab()?.id}
              <p class="empty" role="status">Chargement…</p>
            {:else if app.snapshots.length === 0}
              <p class="empty">Aucune version enregistrée pour l'instant.</p>
            {:else}
              {#each snapshotGroups as group, g (group.key)}
                <h3 class="section-head">{group.label}<span class="section-count">{group.items.length}</span></h3>
                <ol class="timeline">
                  {#each group.items as snap, i (snap.name)}
                    <li class:latest={g === 0 && i === 0}>
                      <button class="snap" title="Restaurer cette version" onclick={() => restoreSnapshot(snap.name)}>
                        <span class="snap-date">{group.older ? formatSnapshotDate(snap.time) : formatSnapshotTime(snap.time)}</span>
                        {#if snap.preview}<span class="snap-preview">{snap.preview}</span>{/if}
                      </button>
                    </li>
                  {/each}
                </ol>
              {/each}
            {/if}
          </div>
        {/if}
      </div>
        {/if}
      </div>

      <footer class="foot">
        <button class="foot-row" class:active={app.settingsOpen} onclick={() => openSettings()}>
          <svg class="icon" aria-hidden="true"><use href="#i-settings" /></svg>
          <span class="label grow">Paramètres</span>
        </button>
        <button
          class="model"
          use:tooltip={'Modèles du copilote'}
          aria-label={`Copilote : ${modelStatus.provider}${modelStatus.name ? ` ${modelStatus.name}` : ''}, ${modelStatus.on ? 'prêt' : 'en veille'} — ouvrir les modèles`}
          onclick={() => openCopilot('models')}
        >
          <span class="model-dot" class:on={modelStatus.on} aria-hidden="true"></span>
          <span class="model-provider">{modelStatus.provider}</span>
          {#if modelStatus.name}<span class="model-name">{modelStatus.name}</span>{/if}
        </button>
      </footer>
    </div>
  </div>
</aside>

<!-- Menu contextuel d'une entrée : hors de l'aside (`contain: paint` du panneau clipperait
     même un élément fixe). Fermé au clic extérieur et par Échap. -->
{#if rowMenu}
  {@const row = rowMenu.row}
  {@const left = Math.min(rowMenu.x, window.innerWidth - 210)}
  {@const top = Math.min(rowMenu.y, window.innerHeight - 150)}
  <!-- Origine au pointeur, même quand le bord a repoussé le menu. -->
  <div
    class="row-menu"
    class:kbd={rowMenu.kbd}
    role="menu"
    tabindex="-1"
    aria-label={`Actions sur ${row.entry.name}`}
    style={`left: ${left}px; top: ${top}px; transform-origin: ${rowMenu.x - left}px ${rowMenu.y - top}px`}
    bind:this={rowMenuEl}
    onkeydown={onRowMenuKey}
    onfocusout={(e) => { if (!rowMenuEl?.contains(e.relatedTarget as Node | null)) closeRowMenu() }}
  >
    <button role="menuitem" onclick={() => startRename(row)}><svg class="icon" aria-hidden="true"><use href="#i-pencil-line" /></svg>Renommer<kbd>F2</kbd></button>
    <button role="menuitem" onclick={() => void moveRow(row)}><svg class="icon" aria-hidden="true"><use href="#i-folder-input" /></svg>Déplacer vers…</button>
    <div class="menu-sep" role="separator"></div>
    <button role="menuitem" class="danger" onclick={() => void deleteRow(row)}><svg class="icon" aria-hidden="true"><use href="#i-trash" /></svg>Supprimer<kbd>Suppr</kbd></button>
  </div>
{/if}
<svelte:window
  onpointerdown={rowMenu ? (e) => { if (!rowMenuEl?.contains(e.target as Node)) closeRowMenu() } : undefined}
  onkeydown={rowMenu ? (e) => { if (e.key === 'Escape') closeRowMenu(true) } : undefined}
/>

<style>
  /* Fondus de bord (motif ScrollFade de Kube) : propriétés enregistrées pour être
     interpolées, par le défilement (panneau) ou par transition (fil d'Ariane). */
  @property --edge-top { syntax: '<length>'; inherits: false; initial-value: 0px; }
  @property --edge-bottom { syntax: '<length>'; inherits: false; initial-value: 0px; }
  @property --edge-start { syntax: '<length>'; inherits: false; initial-value: 0px; }
  @property --edge-end { syntax: '<length>'; inherits: false; initial-value: 0px; }

  /* Menus (en-tête « Plus d'options » et clic droit) : matériau élevé commun.
     Le menu d'en-tête partage ce matériau avec .app-menu (TitleBar) : si l'un change,
     changer l'autre. */
  .sort-menu,
  .row-menu {
    padding: 4px;
    border-radius: var(--radius-xl);
    background: var(--glass-bg);
    -webkit-backdrop-filter: var(--glass-filter);
    backdrop-filter: var(--glass-filter);
    box-shadow: var(--glass-shadow);
    animation: doku-pop-in var(--duration-basic) var(--ease-enter-snappy);
  }
  .sort-menu.kbd,
  .row-menu.kbd { animation: none; }
  .row-menu { position: fixed; z-index: var(--z-context); min-width: 200px; }
  /* Ancré sous le bouton, aligné à droite pour ne pas déborder du panneau. */
  .sort-wrap { position: relative; display: inline-flex; }
  .sort-menu { position: absolute; top: calc(100% + 4px); right: 0; z-index: var(--z-popover); min-width: 224px; transform-origin: top right; }
  :is(.sort-menu, .row-menu) button {
    width: 100%;
    height: var(--control-md);
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--ink-2);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: var(--weight-control);
    text-align: left;
    cursor: pointer;
  }
  /* Doigt : changement VISIBLE → dernier pointeur utilisé (main.ts), pas `any-pointer`,
     toujours vrai sur Surface même à la souris. */
  :global(:root[data-input='touch']) :is(.sort-menu, .row-menu) button { min-height: 40px; }
  /* Surbrillance instantanée : elle suit les flèches du clavier, une transition y traînerait.
     L'anneau double la teinte, trop pâle seule pour signaler le focus (WCAG 2.4.11). */
  :is(.sort-menu, .row-menu) button:is(:hover, :focus-visible):not(:disabled) { background: var(--menu-row-hover); color: var(--ink); }
  :is(.sort-menu, .row-menu) button:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
  .row-menu button.danger:not(:disabled) { color: var(--danger-action-text); }
  :is(.sort-menu, .row-menu) button:disabled { opacity: var(--opacity-disabled); cursor: default; }
  :is(.sort-menu, .row-menu) .icon { font-size: 15px; opacity: 0.75; }
  :is(.sort-menu, .row-menu) button:is(:hover, :focus-visible) .icon { opacity: 1; }
  .sort-menu button.on { color: var(--ink); }
  .sort-menu .grow { flex: 1; min-width: 0; white-space: nowrap; }
  .row-menu kbd { margin-left: auto; font: var(--weight-regular) var(--text-xs) var(--font-sans); color: var(--ink-4); }
  .menu-sep { height: 1px; margin: 4px 8px; background: var(--line-1); }
  /* Intitulé de section du menu — libellé, pas action : non focusable. */
  .menu-head { display: block; padding: 6px 8px 4px; font-size: var(--text-xs); font-weight: var(--weight-control); color: var(--ink-3); }

  /* Rideau : la largeur seule anime (0 ↔ 296 = SIDEBAR_OPEN_WIDTH), même tempo que le
     copilote. La carte flotte à --canvas-gap du haut, du bas et du bord gauche ; l'écart
     avec la feuille est celui de `.main`. `clip` + marge : l'ombre et l'anneau de la carte
     ne sont pas tranchés à son bord droit. */
  .sidebar {
    flex: 0 0 auto;
    width: 0;
    position: relative;
    overflow: clip;
    overflow-clip-margin: var(--canvas-gap);
    transition: width var(--duration-curtain) var(--ease-curtain);
  }
  .sidebar.open:not(.covered) { width: 296px; }
  .sidebar.snap { transition: none; }
  /* contain : le contenu (largeur figée) est isolé des invalidations externes — la
     transition de width de .sidebar ne re-layoute plus l'arbre entier à chaque frame.
     Masquée en fin de fermeture : sans cela, la marge de rognage laisserait voir le bord
     de la carte (ombre, anneau) contre la fenêtre. */
  .inner {
    width: 296px;
    height: 100%;
    display: flex;
    padding: var(--canvas-gap) 0 var(--canvas-gap) var(--canvas-gap);
    contain: layout style;
    visibility: hidden;
    transition: visibility 0s linear var(--duration-curtain);
  }
  .sidebar.open:not(.covered) .inner { visibility: visible; transition-delay: 0s; }
  .sidebar.snap .inner { transition: none; }

  /* Carte flottante (Apple 27) : matériau translucide + flou léger, sur un pseudo-élément —
     posé sur la carte même, son backdrop-filter en ferait la racine de fond de ses menus en
     verre, qui ne flouteraient plus rien. 16 px : un flou plus large se recalcule à chaque
     image pendant que le rideau anime. */
  .card {
    position: relative;
    isolation: isolate;
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    border-radius: var(--sheet-radius);
    box-shadow: var(--panel-shadow);
  }
  .card::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1;
    border-radius: inherit;
    background: var(--panel-bg);
    pointer-events: none;
    -webkit-backdrop-filter: blur(16px) saturate(140%);
    backdrop-filter: blur(16px) saturate(140%);
  }
  /* Mica floute déjà le bureau : un second flou n'y verrait que du transparent. */
  :global(:root[data-window-backdrop='mica']) .card::before {
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }

  /* En-tête de carte : marque + nom (ouvre « À propos »), bouton replier. Centré sur la
     rangée d'onglets de la barre de titre (y = 24). */
  .brand {
    height: 32px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 0 4px 0 6px;
  }
  .brand-mark {
    height: var(--control-sm);
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 0 8px 0 6px;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--ink);
    cursor: pointer;
    transition: background-color var(--duration-basic) ease;
  }
  .brand-mark:hover { background: var(--fill-hover); }
  .brand-name { font-size: var(--text-sm); font-weight: var(--weight-strong); letter-spacing: var(--tracking-snug); }
  .icon-btn,
  .actions button:not([role='menuitem']) {
    width: var(--control-sm);
    height: var(--control-sm);
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--ink-4);
    cursor: pointer;
    transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease, transform var(--duration-basic) var(--ease-enter-snappy);
  }
  .actions button:not([role='menuitem']) .icon { font-size: 16px; }
  :is(.icon-btn, .actions button:not([role='menuitem'])):is(:hover, .active):not(:disabled) { background: var(--fill-hover); color: var(--ink); }
  :is(.icon-btn, .actions button:not([role='menuitem'])):active:not(:disabled) { transform: scale(0.97); }
  .actions button:not([role='menuitem']):disabled { opacity: var(--opacity-disabled); cursor: default; }
  .brand-mark:focus-visible,
  .icon-btn:focus-visible { outline-offset: -2px; }

  /* Sélecteur de vue : piste en capsule, pastille liquide (src/lib/liquid.ts pose translate/width). */
  .switcher {
    position: relative;
    flex-shrink: 0;
    display: flex;
    height: var(--control-md);
    margin: 6px 8px 2px;
    padding: 2px;
    border-radius: var(--radius-full);
    background: rgba(var(--ink-rgb), 0.055);
  }
  .switcher-track { position: absolute; inset: 0; pointer-events: none; }
  .switcher-pill {
    position: absolute;
    top: 2px;
    bottom: 2px;
    left: 0;
    border-radius: var(--radius-full);
    background: var(--track-thumb);
    box-shadow: 0 0 0 0.5px var(--elevation-ring), 0 1px 3px rgba(var(--shadow-rgb), 0.08);
  }
  /* Sombre : --track-thumb (surface-2) se confondait avec la carte ; pastille nettement plus claire. */
  :global(:root[data-theme='dark']) .switcher-pill {
    background: rgb(255 255 255 / 0.14);
    box-shadow: inset 0 0.5px 0 rgb(255 255 255 / 0.1), 0 1px 3px rgb(0 0 0 / 0.4);
  }
  .switcher button {
    position: relative;
    flex: 1;
    min-width: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--ink-4);
    cursor: pointer;
    transition: color var(--duration-basic) ease;
  }
  .switcher button .icon { font-size: 16px; }
  .switcher button:hover { color: var(--ink-2); }
  .switcher button[aria-selected='true'] { color: var(--ink); }
  .switcher button:focus-visible { outline-offset: -2px; }

  .panel { flex: 1; min-height: 0; min-width: 0; display: flex; flex-direction: column; timeline-scope: --panel-scroll; }
  /* En-tête de vue : titre 13/600 aligné sur les icônes des rangées (8 + 8), sous-titre
     (document, dossier) en encre 4, actions de la vue à droite. */
  .panel-head {
    min-height: 44px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 8px 4px 16px;
  }
  .head-text { min-width: 0; display: grid; gap: 1px; }
  .panel-title { min-width: 0; font-size: var(--text-sm); font-weight: var(--weight-strong); color: var(--ink); letter-spacing: var(--tracking-snug); }
  .panel-sub { min-width: 0; overflow: hidden; font-size: var(--text-xs); color: var(--ink-4); text-overflow: ellipsis; white-space: nowrap; }
  .actions { display: flex; align-items: center; gap: 2px; }

  .explorer-nav {
    height: 36px;
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 8px 4px;
  }
  /* Précédent/suivant et chemin : deux pistes de même hauteur, boutons internes au
     rayon concentrique (rayon extérieur − marge interne). */
  .nav-controls {
    flex: 0 0 auto;
    height: var(--control-sm);
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    border-radius: var(--radius-full);
    background: rgba(var(--ink-rgb), 0.045);
  }
  .nav-btn {
    width: var(--control-2xs);
    height: var(--control-2xs);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--ink-3);
    cursor: pointer;
    transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease;
  }
  .nav-btn .icon { font-size: 14px; }
  .nav-btn:hover:not(:disabled) { background: var(--fill-hover); color: var(--ink); }
  .nav-btn:disabled { opacity: var(--opacity-disabled); cursor: default; }
  /* Au doigt, les cibles de 24-28 px montent à 40 px de haut sans changer le dessin ; en
     largeur, 1 px seulement (moitié de l'écart de 2 px) pour ne pas chevaucher le voisin.
     any-pointer : sur Surface, la souris du Type Cover ne doit pas l'empêcher. */
  @media (any-pointer: coarse) {
    .actions button:not([role='menuitem']), .nav-btn, .icon-btn { position: relative; }
    :is(.actions button:not([role='menuitem']), .icon-btn)::after { content: ''; position: absolute; inset: -6px -1px; }
    .nav-btn::after { content: ''; position: absolute; inset: -8px -1px; }
  }
  .breadcrumbs {
    min-width: 0;
    flex: 1;
    height: var(--control-sm);
    display: flex;
    align-items: center;
    padding: 2px 4px;
    overflow-x: auto;
    border-radius: var(--radius-full);
    background: rgba(var(--ink-rgb), 0.045);
    scrollbar-width: none;
    overscroll-behavior-x: contain;
    /* Tactile : défilement horizontal natif ; le drag souris est géré en JS. */
    touch-action: pan-x;
    /* Fondus aux bords : signalent le chemin masqué (la scrollbar est cachée). */
    -webkit-mask-image: linear-gradient(90deg, transparent, #000 var(--edge-start), #000 calc(100% - var(--edge-end)), transparent);
    mask-image: linear-gradient(90deg, transparent, #000 var(--edge-start), #000 calc(100% - var(--edge-end)), transparent);
    transition: --edge-start var(--duration-basic) ease, --edge-end var(--duration-basic) ease;
  }
  .breadcrumbs::-webkit-scrollbar { display: none; }
  .breadcrumbs.fade-left { --edge-start: 24px; }
  .breadcrumbs.fade-right { --edge-end: 24px; }
  .breadcrumbs button {
    max-width: 86px;
    height: var(--control-2xs);
    flex: 0 0 auto;
    padding: 0 6px;
    overflow: hidden;
    border: 0;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--ink-3);
    font: inherit;
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
    transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease;
  }
  .breadcrumbs button:hover:not(:disabled) { background: var(--fill-hover); color: var(--ink); }
  .breadcrumbs button.current { max-width: 120px; color: var(--ink); font-weight: 510; cursor: default; }
  .crumb-separator { flex: none; font-size: 12px; color: var(--ink-5); }
  /* Le fil d'Ariane rogne ses enfants (défilement) et chaque bouton rogne son texte :
     pas de pseudo-élément possible. Au doigt, le bouton prend toute la hauteur de la
     piste (28 px, son plafond) ; la bordure transparente garde le fond dessiné à 24 px. */
  @media (any-pointer: coarse) {
    .breadcrumbs { padding-block: 0; }
    .breadcrumbs button { height: 100%; border-block: 2px solid transparent; background-clip: padding-box; }
  }

  /* Saisie du nom en place : mêmes métriques qu'une .row pour ne pas faire sauter la
     liste ; la marge gauche (26px) saute la place du chevron pour aligner l'icône. */
  .newrow { display: flex; align-items: center; gap: 8px; height: 30px; padding: 0 8px 0 26px; }
  .newname {
    flex: 1;
    min-width: 0;
    height: var(--control-2xs);
    padding: 0 6px;
    border: 1px solid var(--line-1);
    border-radius: var(--radius-sm);
    background: var(--cream-content);
    color: var(--ink);
    font: inherit;
    font-size: 13px;
    transition: border-color var(--duration-basic) ease;
  }
  .newname:hover { border-color: var(--line-3); }
  .newname:focus { border-color: var(--line-3); outline: 2px solid var(--focus-ring); outline-offset: -1px; }
  .newerr { margin: 2px 8px 4px 50px; font-size: var(--text-xs); line-height: 1.35; color: var(--err-text); }

  .panel-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 2px 8px 12px;
    contain: layout paint;
  }
  /* Les bords fondent sur les 20px (haut) / 40px (bas) de défilement restant. Sans
     animation-timeline (WebKitGTK), ni fondu ni masque : un masque inerte coûterait
     une passe de composition pour rien. */
  @supports (animation-timeline: scroll()) {
    .panel-body {
      -webkit-mask-image: linear-gradient(to bottom, transparent, #000 var(--edge-top), #000 calc(100% - var(--edge-bottom)), transparent);
      mask-image: linear-gradient(to bottom, transparent, #000 var(--edge-top), #000 calc(100% - var(--edge-bottom)), transparent);
      animation: edge-top linear both, edge-bottom linear both;
      animation-duration: auto;
      animation-timeline: scroll(self block), scroll(self block);
      animation-range: 0 20px, calc(100% - 40px) 100%;
    }
  }
  /* Filet sous l'en-tête, seulement une fois la liste défilée (Apple scroll-edge « hard ») :
     la timeline du corps est partagée avec son frère par timeline-scope sur .panel. */
  @supports (animation-timeline: scroll()) {
    .panel-body { scroll-timeline: --panel-scroll block; }
    .explorer-nav,
    .panel-head:not(:has(+ .explorer-nav)) {
      animation: head-filet linear both;
      animation-timeline: --panel-scroll;
      animation-range: 0 12px;
    }
  }
  @keyframes head-filet { from { box-shadow: 0 1px 0 transparent; } to { box-shadow: 0 1px 0 var(--chrome-material-divider); } }
  @keyframes edge-top { to { --edge-top: 20px; } }
  @keyframes edge-bottom { from { --edge-bottom: 40px; } to { --edge-bottom: 0px; } }

  /* Rangées : 30 px (40 au doigt), rayon 8 ; sélection = voile d'encre + libellé 510 +
     icône en encre pleine. */
  .row,
  .foot-row {
    width: 100%;
    height: 30px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--ink-2);
    font: inherit;
    text-align: left;
    cursor: pointer;
    user-select: none;
    transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease;
  }
  .row.current,
  .foot-row.active { background: var(--row-selected); color: var(--ink); }
  :is(.row.current, .foot-row.active) .label { font-weight: 510; }
  :is(.row.current, .foot-row.active) :is(.fold, .icon) { color: var(--ink); }
  .fold { flex-shrink: 0; font-size: 16px; color: var(--ink-4); }
  .label { min-width: 0; overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
  .label.grow { flex: 1; min-width: 4ch; }
  /* Pastille « non enregistré » : dessinée en CSS (le glyphe ● variait d'une police à l'autre). */
  .filedot { flex-shrink: 0; width: 6px; height: 6px; margin-right: 2px; border-radius: 50%; background: var(--ink); }
  /* Chevron de dépliage : pivote à 90° quand le dossier est ouvert. La marge négative
     le colle à 4px de l'icône, l'icône restant à 8px du libellé. */
  .twist {
    flex-shrink: 0;
    margin-right: -4px;
    font-size: 14px;
    color: var(--ink-5);
    transition: transform var(--duration-basic) var(--ease-enter-snappy);
  }
  .twist.open { transform: rotate(90deg); }
  .twist.kbd { transition: none; }
  /* Aligne les fichiers sur les libellés des dossiers (largeur du chevron). */
  .twist-spacer { flex: 0 0 14px; margin-right: -4px; }

  .folder-empty {
    min-height: 220px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 24px 16px;
    text-align: center;
  }
  .folder-empty > .icon { margin-bottom: 12px; font-size: 24px; color: var(--ink-4); }
  .folder-empty strong { font-size: var(--text-md); font-weight: var(--weight-strong); color: var(--ink-2); text-wrap: balance; }
  .folder-empty p { max-width: 24ch; margin: 4px 0 16px; font-size: var(--text-xs); line-height: var(--leading-snug); color: var(--ink-3); text-wrap: pretty; }
  .folder-empty button {
    height: var(--control-md);
    padding: 0 14px;
    border: 0;
    border-radius: var(--radius-full);
    background: var(--ink);
    color: var(--cream-content);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: var(--weight-control);
    cursor: pointer;
    transition: background-color var(--duration-basic) ease, transform var(--duration-basic) var(--ease-enter-snappy);
  }
  .folder-empty button:hover:not(:disabled) { background: var(--ink-2); }
  .folder-empty button:not(:disabled):active { transform: scale(0.97); }
  .folder-empty button:disabled { opacity: var(--opacity-disabled); cursor: default; }

  /* Rangées dans une zone défilante masquée : l'anneau de focus se dessine dedans. */
  :is(.row, .plan-row, .backlink, .snap, .result-file, .hit, .breadcrumbs button, .foot-row, .model, .switcher button):focus-visible { outline-offset: -2px; }

  /* En-têtes de section : 11/600, 16 px au-dessus, compte aligné à droite. */
  .section-head {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 16px 0 4px;
    padding: 0 8px;
    font-size: var(--text-2xs);
    font-weight: var(--weight-strong);
    line-height: 16px;
    color: var(--section-label);
  }
  .history > .section-head:first-child { margin-top: 4px; }
  .section-count { margin-left: auto; font-weight: var(--weight-control); font-variant-numeric: tabular-nums; }

  /* Plan : un filet de guidage par niveau franchi ; le titre courant porte une barre
     d'encre de 2 px à la place du filet de son propre niveau. */
  .plan-row {
    position: relative;
    width: 100%;
    display: block;
    min-height: 30px;
    padding: 6px 8px 6px calc(8px + var(--depth) * 14px);
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--ink-3);
    font: inherit;
    font-size: 13px;
    line-height: 18px;
    text-align: start;
    cursor: pointer;
    transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease;
  }
  .plan-row.top { color: var(--ink-2); font-weight: 510; }
  .plan-row.active { color: var(--ink); }
  .plan-guides {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 11px;
    width: calc(var(--depth) * 14px);
    background: repeating-linear-gradient(to right, var(--line-2) 0 1px, transparent 1px 14px);
    pointer-events: none;
  }
  .plan-row.active::before {
    content: '';
    position: absolute;
    top: 7px;
    bottom: 7px;
    left: max(1px, calc(var(--depth) * 14px - 3px));
    width: 2px;
    border-radius: 1px;
    background: var(--ink);
  }
  .plan-row:not(.top) + .plan-row.top { margin-top: 4px; }
  /* Un titre sans espace (URL, identifiant) débordait en défilement horizontal. */
  .plan-text {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .backlink {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 8px;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--ink-2);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease;
  }
  .backlink-name { overflow: hidden; font-size: 13px; font-weight: 510; text-overflow: ellipsis; white-space: nowrap; }
  .backlink-ctx { overflow: hidden; font-size: 12px; color: var(--ink-3); text-overflow: ellipsis; white-space: nowrap; }
  .empty { padding: 8px; font-size: var(--text-xs); color: var(--ink-3); text-wrap: pretty; }

  /* Historique : rail chronologique, un point par version, le plus récent en encre. */
  .timeline { margin: 0; padding: 0; list-style: none; }
  .timeline li { position: relative; padding-left: 20px; }
  .timeline li::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 11px;
    width: 1px;
    background: var(--line-2);
  }
  .timeline li:first-child::before { top: 15px; }
  .timeline li:last-child::before { bottom: calc(100% - 15px); }
  .timeline li::after {
    content: '';
    position: absolute;
    top: 12px;
    left: 8px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--ink-5);
    pointer-events: none;
  }
  .timeline li.latest::after { background: var(--ink); box-shadow: 0 0 0 3px var(--accent-soft); }
  .snap {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 8px;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background-color var(--duration-basic) ease;
  }
  .snap-date { font-size: 13px; font-weight: 510; color: var(--ink-2); font-variant-numeric: tabular-nums; }
  .snap-preview { overflow: hidden; font-size: 12px; color: var(--ink-3); text-overflow: ellipsis; white-space: nowrap; }

  .search-field {
    height: var(--control-md);
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 2px 0 8px;
    padding: 0 10px;
    border-radius: var(--radius-full);
    background: rgba(var(--ink-rgb), 0.055);
    color: var(--ink-4);
    transition: background-color var(--duration-basic) ease, box-shadow var(--duration-basic) ease;
  }
  .search-field:focus-within { background: var(--cream-content); box-shadow: 0 0 0 0.5px var(--line-2); outline: 2px solid var(--focus-ring); outline-offset: -1px; }
  .search-field > .icon { font-size: 15px; }
  .search-input {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--ink);
    font: inherit;
    font-size: 13px;
  }
  .search-input::placeholder { color: var(--ink-4); }
  /* Croix native de WebKit remplacée par .search-clear (dessin et Échap identiques partout). */
  .search-input { appearance: none; }
  .search-input::-webkit-search-cancel-button,
  .search-input::-webkit-search-decoration { appearance: none; }
  .search-clear {
    position: relative;
    width: var(--control-2xs);
    height: var(--control-2xs);
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-right: -6px;
    border: 0;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--ink-3);
    opacity: 0.75;
    cursor: pointer;
    transition: opacity var(--duration-basic) ease, background-color var(--duration-basic) ease;
  }
  .search-clear .icon { font-size: 14px; }
  .search-clear:focus-visible { opacity: 1; }
  .search-input:placeholder-shown + .search-clear { visibility: hidden; }
  @media (hover: hover) and (pointer: fine) {
    .search-field:hover .search-clear { opacity: 1; }
    .search-clear:hover { background: var(--fill-hover); color: var(--ink); }
  }
  /* 40 px de haut au doigt, dans la marge sous le champ ; rien à droite à chevaucher. */
  @media (any-pointer: coarse) {
    .search-clear::after { content: ''; position: absolute; inset: -8px -4px -8px 0; }
  }
  .search-status { margin: -2px 0 4px; padding: 0 8px; font-size: var(--text-2xs); font-weight: var(--weight-strong); color: var(--section-label); font-variant-numeric: tabular-nums; }
  .result { margin-bottom: 4px; }
  .result-file,
  .hit {
    width: 100%;
    display: flex;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease;
  }
  .result-file { height: 30px; align-items: center; gap: 8px; padding: 0 8px; color: var(--ink-2); }
  .result-file .label { font-weight: 510; }
  /* Extraits alignés sous le nom du fichier (marge + icône + écart). */
  .hit { gap: 8px; padding: 4px 8px 4px 32px; color: var(--ink-3); }
  .count { flex-shrink: 0; font-size: 12px; color: var(--ink-4); font-variant-numeric: tabular-nums; }
  .hit-line { flex-shrink: 0; min-width: 20px; font-size: 12px; color: var(--ink-4); font-variant-numeric: tabular-nums; }
  .hit-text { min-width: 0; overflow: hidden; font-size: var(--text-xs); text-overflow: ellipsis; white-space: nowrap; }
  .hl { padding: 0 2px; border-radius: var(--radius-xs); background: var(--accent-soft); color: var(--ink); }

  /* Pied de carte : Paramètres + état du modèle du copilote. */
  .foot {
    flex-shrink: 0;
    display: grid;
    gap: 2px;
    padding: 8px;
    border-top: 1px solid var(--chrome-material-divider);
  }
  .foot-row .icon { flex: none; font-size: 16px; color: var(--ink-4); }
  .model {
    min-width: 0;
    height: 26px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 8px 0 12px;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--ink-3);
    font: inherit;
    font-size: var(--text-xs);
    text-align: left;
    cursor: pointer;
    transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease;
  }
  .model-dot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--ink-5); transition: background-color var(--duration-moderate) ease, box-shadow var(--duration-moderate) ease; }
  .model-dot.on { background: var(--ok); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 22%, transparent); }
  .model-provider { flex: none; font-weight: 510; }
  .model-name { min-width: 0; margin-left: auto; overflow: hidden; color: var(--ink-4); text-overflow: ellipsis; white-space: nowrap; font-variant-numeric: tabular-nums; }

  /* Doigt : rangées de 40 px (grammaire commune), saisie en place comprise pour ne pas sauter.
     Placée après `.row`, `.newrow` et `.result-file` : même spécificité, l'ordre tranche. */
  :global(:where(:root[data-input='touch'])) :is(.row, .newrow, .result-file, .foot-row, .model) { height: 40px; }
  :global(:where(:root[data-input='touch'])) :is(.plan-row, .snap, .backlink) { min-height: 40px; }
  :global(:where(:root[data-input='touch'])) .switcher { height: 44px; }
  :global(:where(:root[data-input='touch'])) :is(.icon-btn, .brand-mark) { width: 36px; height: 36px; }
  :global(:where(:root[data-input='touch'])) .brand-mark { width: auto; }

  /* Survols de rangée réservés à la souris : au doigt, la rangée touchée resterait
     allumée à côté de la rangée courante. */
  @media (hover: hover) and (pointer: fine) {
    :is(.row, .foot-row):not(.current, .active):hover,
    .plan-row:hover,
    .backlink:hover,
    .model:hover,
    :is(.result-file, .hit):hover { background: var(--surface-hover); color: var(--ink); }
    .snap:hover { background: var(--surface-hover); }
  }
</style>
