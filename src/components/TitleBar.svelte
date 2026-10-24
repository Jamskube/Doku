<script lang="ts">
  import { onMount, tick, untrack } from 'svelte'
  import { fade } from 'svelte/transition'
  import { quintOut } from 'svelte/easing'
  import { app, activeTab, assignTabToPane, closeOtherTabs, closeTabsToRight, docxActions, duplicateTab, canMoveTabToNewWindow, isBinaryKind, moveTabToNewWindow, newWindow, openPath, tearOffTab, openPdfPages, openPdfTextEdit, renameTab, requestCloseTab, isDirty, saveTabOrSaveAs, selectTab, setColumnWidth, swapPanes, toggleActiveSourceMode, togglePin, toggleWorkspaceSplit, workspace, workspaceLayout, type ColumnWidth, type DocKind, type DocTab } from '../lib/stores.svelte'
  import type { PaneId } from '../lib/workspace'
  import { tabDiscriminator, tabLabel } from '../lib/tabs'
  import { middleTruncate } from '../lib/middle-truncate'
  import { tooltip } from '../lib/tooltip'
  import { parentPath } from '../lib/explorer'
  import { closeWindow, currentWindowLabel, dragTabWindow, dropTabWindow, isTauri, minimizeWindow, onTabHover, signalTabHover, readFileBytes, readImageDataUrl, readPdfAnnotationManifest, saveDocxDialog, saveHtmlDialog, saveMarkdownDialog, savePdfDialog, toggleMaximizeWindow } from '../lib/tauri'
  import DokuMark from '../lib/DokuMark.svelte'
  import PaneTabSelector from './PaneTabSelector.svelte'

  let { onOpen }: { onOpen: (paneId?: PaneId) => void } = $props()

  // Les transitions Svelte passent par WAAPI et échappent à la règle reduced-motion d'app.css.
  // Lu à chaque transition : la préférence système peut changer pendant que l'app tourne.
  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

  // « + » détache le volet actif de son onglet plutôt que d'ouvrir directement le
  // sélecteur de fichiers : on retombe sur l'écran d'accueil du volet, qui laisse
  // le choix entre ouvrir un document et commencer une note. L'onglet courant
  // reste dans la barre, un clic dessus le ramène. Ctrl+O garde le raccourci
  // direct vers le dialogue.
  function newTab() {
    assignTabToPane(workspace.activePaneId, null)
  }

  // --- Menu contextuel d'un onglet (clic droit) : renommer, dupliquer, fermer… ---
  // Menu et champ de renommage sont des surfaces FLOTTANTES aux coordonnées du clic : la
  // barre repliée et les sélecteurs de volet (mode scindé) n'ont pas d'onglet où loger un
  // champ, et un <input> dans un <button> n'est pas du HTML valide.
  type TabAnchor = { id: number; x: number; y: number }
  let tabMenu = $state<TabAnchor | null>(null)
  let tabMenuEl = $state<HTMLElement | null>(null)
  let renaming = $state<TabAnchor | null>(null)
  let renameDraft = $state('')
  let renameInput = $state<HTMLInputElement | null>(null)

  function openTabMenu(e: MouseEvent, id: number) {
    e.preventDefault()
    closeMenus()
    closeTabsMenu()
    renaming = null
    tabMenu = { id, x: e.clientX, y: e.clientY }
    void tick().then(() => tabMenuEl?.querySelector<HTMLButtonElement>('.app-menu-item:not(:disabled)')?.focus())
  }
  function closeTabMenu() {
    tabMenu = null
  }
  function tabMenuAction(fn: (anchor: TabAnchor) => unknown) {
    const anchor = tabMenu
    closeTabMenu()
    if (anchor) void fn(anchor)
  }
  function handleTabMenuKeydown(event: KeyboardEvent) {
    const items = Array.from(tabMenuEl?.querySelectorAll<HTMLButtonElement>('.app-menu-item:not(:disabled)') ?? [])
    const idx = items.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      ;(items[idx + 1] ?? items[0])?.focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      ;(items[idx - 1] ?? items[items.length - 1])?.focus()
    } else if (event.key === 'Tab') {
      closeTabMenu()
    }
  }
  // Un onglet déjà affiché ne peut pas l'être deux fois (assignWorkspaceTab refuse) :
  // pour lui, « l'autre volet » = échanger les deux volets. Un onglet caché va dans le
  // volet opposé à l'actif.
  function showInOtherPane(id: number) {
    if (workspace.primary.tabId === id || workspace.secondary.tabId === id) swapPanes()
    else assignTabToPane(workspace.activePaneId === 'primary' ? 'secondary' : 'primary', id)
  }

  $effect(() => {
    if (!renaming || !renameInput) return
    renameInput.focus()
    renameInput.select()
  })
  // On renomme l'ONGLET, pas le fichier : le brouillon ne montre jamais l'extension.
  function startRename(anchor: TabAnchor) {
    const tab = app.tabs.find((t) => t.id === anchor.id)
    if (!tab) return
    renameDraft = tab.label ?? (tab.path ? tab.name.replace(/\.[^.]+$/, '') : tab.name)
    renaming = anchor
  }
  function commitRename() {
    const id = renaming?.id
    renaming = null
    if (id != null) renameTab(id, renameDraft)
  }
  function onRenameKey(e: KeyboardEvent) {
    e.stopPropagation()
    if (e.key === 'Enter') {
      e.preventDefault()
      void commitRename()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      renaming = null
    }
  }

  let railHover = $state(false)
  let menuOpen = $state(false)
  let submenu = $state<'export' | 'width' | null>(null)
  let menuKbd = $state(false)
  let submenuKbd = $state(false)
  let submenuFlip = $state(false)
  let menuRootEl: HTMLElement | undefined = $state()
  let menuTriggerEl: HTMLButtonElement | undefined = $state()
  let mainMenuEl: HTMLElement | undefined = $state()
  let exportMenuEl: HTMLElement | undefined = $state()
  let widthMenuEl: HTMLElement | undefined = $state()
  let exportTriggerEl: HTMLButtonElement | undefined = $state()
  let widthTriggerEl: HTMLButtonElement | undefined = $state()
  let burningPdf = $state(false)
  const showLogo = $derived(!app.sidebarOpen && !railHover)
  // Un onglet PDF n'exporte pas vers les autres formats, mais il exporte sa propre
  // copie annotée (ADR-0022) — le menu change donc de contenu au lieu d'être grisé.
  const activeIsPdf = $derived(activeTab()?.kind === 'pdf')
  const activeIsDocx = $derived(activeTab()?.kind === 'docx')
  const activeIsMarkdown = $derived(activeTab()?.kind === 'md')
  const canExport = $derived(!!activeTab())
  // Les deux actions PDF travaillent depuis le CHEMIN du fichier : sans chemin, elles
  // ne peuvent rien faire. On les désactive plutôt que de les laisser cliquables et
  // muettes (règle « branché ou retiré », Epic 19).
  const pdfPath = $derived(activeIsPdf ? (activeTab()?.path ?? null) : null)

  // --- Barre d'onglets : quand la place manque (chaque onglet < TAB_MIN), la rangée
  // entière se REPLIE en un seul bouton « onglet actif · n » qui ouvre un menu flottant
  // listant tous les onglets — des onglets écrasés à la seule croix ne se distinguent
  // plus (vécu en fenêtre étroite avec sidebar + copilote ouverts).
  // Même valeur que `.tab { min-width }` : sinon la bascule vers le menu diverge du rendu.
  const TAB_MIN = 120
  const TAB_GAP = 3
  const NEW_TAB_W = 32
  // Plafond d'un onglet (Kube : 90 à 240 px), = `.tab { max-width }`.
  const TAB_MAX = 240
  // Caractères que montre un nom dans `px` de large : le reste de l'onglet (marges, croix,
  // pastille) prend ~50 px, un caractère ~7 px en 13 px. La coupe se fait au MILIEU ;
  // l'ellipsis CSS reste le dernier recours si l'estimation déborde.
  const nameChars = (px: number) => Math.max(6, Math.floor((px - 50) / 7))
  let tabsBox = $state<HTMLElement | null>(null)

  // Glisser un onglet comme dans Chrome. Tenu, il se soulève et suit la souris ; tiré hors de
  // la barre, un aperçu de fenêtre naît de lui et suit le curseur le temps que la vraie fenêtre
  // (`tearOffTab`) se peigne dessous, puis s'efface. Le seul onglet d'une fenêtre secondaire
  // entraîne la fenêtre même. Au-dessus de la barre d'une autre fenêtre Doku, la fenêtre
  // s'efface et l'onglet s'y annonce ; lâché là, il la rejoint. La capture, posée sur la barre
  // une fois le geste lancé (avant, elle volerait le clic), suit la souris hors de la fenêtre.
  const TEAR_OFF_PX = 32
  // Point par lequel on tient une fenêtre arrachée : son premier onglet (px CSS depuis le coin).
  const TORN_GRAB: [number, number] = [120, 20]
  type TabDrag = {
    id: number
    name: string
    lines: string[]
    pointer: number
    startX: number
    startY: number
    x: number
    y: number
    moved: boolean
    out: boolean
    window: string | null
    grab: [number, number]
    tearing: boolean
    target: string | null
    shown: boolean
    frame: number
  }
  let tabDrag = $state<TabDrag | null>(null)
  let tabDragEnded = false
  let windowLabel = 'main'
  void currentWindowLabel().then((label) => (windowLabel = label))
  // Onglet d'une autre fenêtre en approche au-dessus de cette barre.
  let incomingTab = $state<string | null>(null)
  void onTabHover((name) => (incomingTab = name))

  // Premières lignes lisibles du document, pour l'aperçu de fenêtre (rien pour un PDF ou un Word).
  function previewLines(tab: DocTab): string[] {
    return tab.content
      .split('\n')
      .map((line) => line.replace(/^[#>*\-\s]+|<[^>]*>/g, '').trim())
      .filter(Boolean)
      .slice(0, 4)
  }

  function startTabDrag(e: PointerEvent, tab: DocTab) {
    if (e.button !== 0 || !isTauri || !tabsBox || !canMoveTabToNewWindow(tab) || (e.target as Element).closest('.close')) return
    window.addEventListener('pointermove', moveTabDrag)
    window.addEventListener('pointerup', endTabDrag)
    window.addEventListener('pointercancel', endTabDrag)
    tabDrag = {
      id: tab.id, name: tabLabel(tab), lines: previewLines(tab), pointer: e.pointerId,
      startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, moved: false, out: false,
      window: null, grab: [e.clientX, e.clientY], tearing: false, target: null, shown: false, frame: 0,
    }
  }

  function moveTabDrag(e: PointerEvent) {
    const drag = tabDrag
    if (!drag || e.pointerId !== drag.pointer) return
    drag.x = e.clientX
    drag.y = e.clientY
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) <= 6) return
      drag.moved = true
      tabsBox?.setPointerCapture(drag.pointer)
    }
    if (drag.tearing) return
    if (!drag.window) {
      if (windowLabel !== 'main' && app.tabs.length === 1) {
        drag.window = windowLabel
      } else {
        const strip = tabsBox!.getBoundingClientRect()
        drag.out = e.clientY < strip.top - TEAR_OFF_PX || e.clientY > strip.bottom + TEAR_OFF_PX
          || e.clientX < 0 || e.clientX > window.innerWidth
        if (!drag.out) return
        drag.tearing = true
        drag.grab = TORN_GRAB
        void tearOffTab(drag.id, TORN_GRAB).then((label) => {
          // Relâché avant que la fenêtre existe : on conclut le lâcher pour elle.
          if (tabDrag !== drag) {
            if (label) void dropTabWindow(label)
            return
          }
          if (!label) {
            tabDrag = null
            return
          }
          drag.window = label
          drag.tearing = false
          followCursor(drag)
        })
        return
      }
    }
    followCursor(drag)
  }

  function followCursor(drag: TabDrag) {
    if (drag.frame) return
    drag.frame = requestAnimationFrame(async () => {
      drag.frame = 0
      if (!drag.window) return
      const state = await dragTabWindow(drag.window, drag.grab).catch(() => null)
      if (tabDrag !== drag || !state) return
      drag.shown = state.shown
      if (state.target === drag.target) return
      if (drag.target) void signalTabHover(drag.target, null)
      if (state.target) void signalTabHover(state.target, drag.name)
      drag.target = state.target
    })
  }

  // Tenu dans la barre, l'onglet suit la souris ; l'écart vertical est freiné, comme un
  // onglet qui résiste avant de se décrocher.
  function tabDragTransform(tab: DocTab): string | undefined {
    const drag = tabDrag
    if (!drag?.moved || drag.id !== tab.id || drag.out) return undefined
    return `translate(${drag.x - drag.startX}px, ${(drag.y - drag.startY) * 0.35}px) scale(1.04)`
  }

  async function endTabDrag(e: PointerEvent) {
    const drag = tabDrag
    if (!drag || e.pointerId !== drag.pointer) return
    tabDrag = null
    window.removeEventListener('pointermove', moveTabDrag)
    window.removeEventListener('pointerup', endTabDrag)
    window.removeEventListener('pointercancel', endTabDrag)
    if (drag.frame) cancelAnimationFrame(drag.frame)
    if (!drag.moved) return
    // Le clic qui suit le relâchement ne doit pas réactiver l'onglet qu'on vient d'envoyer ailleurs.
    tabDragEnded = true
    setTimeout(() => (tabDragEnded = false))
    if (drag.target) void signalTabHover(drag.target, null)
    if (!drag.window) return
    await dragTabWindow(drag.window, drag.grab).catch(() => null)
    await dropTabWindow(drag.window)
  }

  let tabsBoxWidth = $state(Infinity)
  const tabsCollapsed = $derived(
    app.tabs.length > 0 &&
      tabsBoxWidth < app.tabs.length * (TAB_MIN + TAB_GAP) + NEW_TAB_W + 8,
  )
  const tabRowWidth = $derived(tabsBoxWidth - NEW_TAB_W - 8)
  const tabNameChars = $derived(nameChars(Math.min(TAB_MAX, tabRowWidth / Math.max(1, app.tabs.length) - TAB_GAP)))

  let tabsMenuOpen = $state(false)
  let tabsMenuRootEl: HTMLElement | undefined = $state()
  let tabsMenuTriggerEl: HTMLButtonElement | undefined = $state()
  let tabsMenuEl: HTMLElement | undefined = $state()
  // Menu ouvert au clavier (`detail === 0` = clic synthétisé par Entrée/Espace) : pas
  // d'animation d'entrée, un geste répété cent fois par jour doit être instantané.
  let tabsMenuKbd = $state(false)

  function toggleTabsMenu(event: MouseEvent) {
    tabsMenuKbd = event.detail === 0
    tabsMenuOpen = !tabsMenuOpen
  }
  function closeTabsMenu(restoreFocus = false) {
    tabsMenuOpen = false
    if (restoreFocus) void tick().then(() => tabsMenuTriggerEl?.focus())
  }
  function pickTab(id: number) {
    selectTab(id)
    closeTabsMenu(true)
  }
  function tabsMenuItems(): HTMLButtonElement[] {
    return Array.from(tabsMenuEl?.querySelectorAll<HTMLButtonElement>('.app-menu-item') ?? [])
  }
  function handleTabsMenuKeydown(event: KeyboardEvent) {
    const items = tabsMenuItems()
    const idx = items.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      ;(items[idx + 1] ?? items[0])?.focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      ;(items[idx - 1] ?? items[items.length - 1])?.focus()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeTabsMenu(true)
    } else if (event.key === 'Tab') {
      closeTabsMenu()
    }
  }
  async function openTabsMenuFromKeyboard(event: KeyboardEvent) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    tabsMenuKbd = true
    tabsMenuOpen = true
    await tick()
    tabsMenuItems()[0]?.focus()
  }

  type ExportTab = { kind: DocKind; name: string; content: string; path: string | null }

  function closeMenus(restoreFocus = false) {
    menuOpen = false
    submenu = null
    if (restoreFocus) void tick().then(() => menuTriggerEl?.focus())
  }

  function toggleMenu(event: MouseEvent) {
    menuKbd = event.detail === 0
    menuOpen = !menuOpen
    submenu = null
  }

  // Survol d'une entrée à sous-menu. Ne touche à rien si ce sous-menu est déjà ouvert :
  // retirer `.kbd` d'un menu affiché relancerait son animation d'entrée.
  function hoverSubmenu(name: 'export' | 'width') {
    if (submenu === name || (name === 'export' && !canExport)) return
    submenuKbd = false
    submenuFlip = flipFor(name === 'export' ? exportTriggerEl : widthTriggerEl)
    submenu = name
  }
  function clickSubmenu(event: MouseEvent, name: 'export' | 'width') {
    if (name === 'export' && !canExport) return
    if (submenu === name) {
      submenu = null
      return
    }
    submenuKbd = event.detail === 0
    submenuFlip = flipFor(event.currentTarget as HTMLElement)
    submenu = name
  }
  // Le sous-menu s'ouvre à gauche du menu ; trop près du bord gauche, il passe à droite.
  // Mesure à l'ouverture (pas d'anchor positioning : WebKitGTK ne le connaît pas).
  const FLYOUT_W = 236
  function flipFor(trigger: HTMLElement | undefined) {
    return !!trigger && trigger.getBoundingClientRect().left < FLYOUT_W + 8
  }

  function runMenuAction(action: () => void | Promise<void>) {
    closeMenus()
    void action()
  }

  async function saveActive() {
    const tab = activeTab()
    if (!tab) return
    // Un `.docx` s'enregistre par SuperDoc, pas par le chemin texte : ses actions sont
    // publiées dans `docxActions` par la vue montée.
    if (tab.kind === 'docx') {
      if (docxActions.tabId === tab.id) await docxActions.save?.()
      return
    }
    if (!isBinaryKind(tab.kind)) await saveTabOrSaveAs(tab)
  }

  async function exportDocxToPdf() {
    const tab = activeTab()
    if (!tab || tab.kind !== 'docx' || docxActions.tabId !== tab.id) return
    closeMenus()
    await docxActions.exportPdf?.()
  }

  // Exports HTML/print en import() dynamique (motif DOCX ci-dessous) : ils tirent
  // marked + le pipeline de rendu, inutiles au démarrage.
  function exportHtml(tab: ExportTab) {
    if (isBinaryKind(tab.kind)) return
    const kind = tab.kind // rétrécissement capturé (perdu sinon dans la closure du .then)
    import('../lib/export/standalone')
      .then((m) =>
        m.exportStandaloneHtml(
          { kind, name: tab.name, content: tab.content, dir: parentPath(tab.path ?? null) ?? '' },
          { readImageDataUrl, save: saveHtmlDialog },
        ),
      )
      .catch((err) => console.error('Export HTML échoué', err))
  }

  function exportPortableMarkdown(tab: ExportTab) {
    if (tab.kind !== 'md') return
    const kind = tab.kind
    import('../lib/export/portable-markdown')
      .then((m) =>
        m.exportPortableMarkdown(
          { kind, name: tab.name, content: tab.content, dir: parentPath(tab.path ?? null) ?? '' },
          { readImageDataUrl, save: saveMarkdownDialog },
        ),
      )
      .then((result) => {
        if (result.status !== 'saved') return
        app.banner = result.missing.length
          ? {
              tone: 'warning',
              title: 'Markdown exporté avec des images manquantes',
              message: `${result.missing.length} image(s) locale(s) sont restées liées à leur fichier d’origine.`,
            }
          : {
              tone: 'success',
              title: 'Markdown portable enregistré',
              message: `${result.inlined} image(s) intégrée(s) dans la copie.`,
            }
      })
      .catch((err) => {
        console.error('Export Markdown portable échoué', err)
        app.banner = {
          tone: 'error',
          title: 'Export impossible',
          message: 'Doku n’a pas pu créer la copie Markdown portable.',
        }
      })
  }

  function exportDocx(tab: ExportTab) {
    if (isBinaryKind(tab.kind)) return
    const doc = { kind: tab.kind, name: tab.name, content: tab.content }
    import('../lib/export/docx')
      .then((m) => m.exportDocx(doc, { save: saveDocxDialog }))
      .catch((err) => console.error('Export DOCX échoué', err))
  }

  function exportPrint(tab: ExportTab) {
    if (isBinaryKind(tab.kind)) return
    const kind = tab.kind // rétrécissement capturé (perdu sinon dans la closure du .then)
    import('../lib/export/print')
      .then((m) => m.exportViaPrint({ kind, name: tab.name, content: tab.content, dir: parentPath(tab.path ?? null) ?? '' }))
      .catch((err) => console.error('Export impression échoué', err))
  }

  function exportActive(format: 'docx' | 'html' | 'pdf') {
    const tab = activeTab()
    if (!tab || isBinaryKind(tab.kind)) return
    closeMenus()
    if (format === 'docx') exportDocx(tab)
    else if (format === 'html') exportHtml(tab)
    else exportPrint(tab)
  }

  function editTextActive() {
    const tab = activeTab()
    if (!tab || tab.kind !== 'pdf' || !tab.path) return
    closeMenus()
    openPdfTextEdit(tab.path)
  }

  function organizePagesActive() {
    const tab = activeTab()
    if (!tab || tab.kind !== 'pdf' || !tab.path) return
    closeMenus()
    openPdfPages(tab.path)
  }

  // Grave le carnet d'annotations dans une COPIE du PDF. Tout est relu du disque par le
  // chemin du fichier : l'export ne dépend pas du lecteur monté ni du volet actif.
  async function exportAnnotatedActive() {
    const tab = activeTab()
    if (!tab || tab.kind !== 'pdf' || !tab.path || burningPdf) return
    closeMenus()
    burningPdf = true
    try {
      const [{ exportAnnotatedPdf, annotatedPdfSummary }, { PdfBurnError }] = await Promise.all([
        import('../lib/export/pdf-annotated'),
        import('../lib/pdf-write'),
      ])
      try {
        const report = await exportAnnotatedPdf(tab.path, {
          readFileBytes,
          readManifest: readPdfAnnotationManifest,
          save: savePdfDialog,
        })
        if (!report.saved) return
        app.banner = {
          tone: 'success',
          title: 'PDF annoté enregistré',
          message: annotatedPdfSummary(report),
        }
      } catch (error) {
        app.banner = {
          tone: 'error',
          title: 'Gravure impossible',
          message: error instanceof PdfBurnError ? error.message : 'Doku n’a pas pu écrire ce PDF annoté.',
        }
      }
    } finally {
      burningPdf = false
    }
  }

  // Délègue au store : la modale Paramètres règle la même chose, un seul chemin
  // d'application (sinon les deux UI peuvent diverger).
  function pickColumnWidth(width: ColumnWidth) {
    setColumnWidth(width)
    closeMenus()
  }

  function directMenuItems(menu: HTMLElement) {
    return Array.from(menu.querySelectorAll<HTMLButtonElement>(
      ':scope > .app-menu-item:not(:disabled), :scope > .submenu-root > .app-menu-item:not(:disabled)',
    ))
  }

  function navigateMenu(event: KeyboardEvent) {
    const menu = event.currentTarget as HTMLElement
    const items = directMenuItems(menu)
    if (!items.length) return false

    const current = document.activeElement as HTMLButtonElement | null
    const index = items.indexOf(current!)
    let next = -1
    if (event.key === 'ArrowDown') next = index < 0 ? 0 : (index + 1) % items.length
    else if (event.key === 'ArrowUp') next = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    else return false

    event.preventDefault()
    event.stopPropagation()
    items[next]?.focus()
    return true
  }

  async function openSubmenu(name: 'export' | 'width', focusFirst = false) {
    if (name === 'export' && !canExport) return
    submenuKbd = focusFirst
    submenuFlip = flipFor(name === 'export' ? exportTriggerEl : widthTriggerEl)
    submenu = name
    if (!focusFirst) return
    await tick()
    const menu = name === 'export' ? exportMenuEl : widthMenuEl
    if (menu) directMenuItems(menu)[0]?.focus()
  }

  async function openMenuFromKeyboard(event: KeyboardEvent) {
    if (!['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) return
    event.preventDefault()
    menuKbd = true
    menuOpen = true
    submenu = null
    await tick()
    const items = mainMenuEl ? directMenuItems(mainMenuEl) : []
    const index = event.key === 'ArrowUp' ? items.length - 1 : 0
    items[index]?.focus()
  }

  function handleMainMenuKeydown(event: KeyboardEvent) {
    if (navigateMenu(event)) return
    if (event.key === 'Escape') {
      event.preventDefault()
      closeMenus(true)
      return
    }
    if (event.key !== 'ArrowRight') return
    const target = event.target as HTMLButtonElement
    const name = target.dataset.submenu as 'export' | 'width' | undefined
    if (!name) return
    event.preventDefault()
    void openSubmenu(name, true)
  }

  function handleSubmenuKeydown(event: KeyboardEvent, name: 'export' | 'width') {
    event.stopPropagation()
    if (navigateMenu(event)) return
    if (event.key === 'Escape') {
      event.preventDefault()
      closeMenus(true)
      return
    }
    if (event.key !== 'ArrowLeft') return
    event.preventDefault()
    submenu = null
    void tick().then(() => (name === 'export' ? exportTriggerEl : widthTriggerEl)?.focus())
  }

  onMount(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRootEl?.contains(event.target as Node | null)) closeMenus()
      if (!tabsMenuRootEl?.contains(event.target as Node | null)) closeTabsMenu()
      if (!tabMenuEl?.contains(event.target as Node | null)) closeTabMenu()
      if (renaming && !renameInput?.contains(event.target as Node | null)) commitRename()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (menuOpen) closeMenus()
      if (tabsMenuOpen) closeTabsMenu()
      if (tabMenu) closeTabMenu()
      if (renaming) renaming = null
    }
    const onWindowChange = () => {
      closeMenus()
      closeTabsMenu()
      closeTabMenu()
    }
    // La bascule onglets ↔ dropdown suit la largeur RÉELLE de la zone (fenêtre,
    // sidebar, copilote… tout ce qui la comprime), pas seulement la fenêtre.
    const ro = new ResizeObserver((entries) => {
      tabsBoxWidth = entries[0]?.contentRect.width ?? Infinity
    })
    if (tabsBox) ro.observe(tabsBox)
    window.addEventListener('blur', onWindowChange)
    window.addEventListener('resize', onWindowChange)
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      ro.disconnect()
      window.removeEventListener('blur', onWindowChange)
      window.removeEventListener('resize', onWindowChange)
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  })
</script>

<div class="titlebar" class:split={workspace.split} class:copilot-open={app.copilotOpen}>
  <div class="rail-zone">
    <button
      class="rail-btn"
      class:lit={app.sidebarOpen || railHover}
      use:tooltip={app.sidebarOpen ? 'Replier la barre latérale' : 'Déplier la barre latérale'}
      aria-label={app.sidebarOpen ? 'Replier la barre latérale' : 'Déplier la barre latérale'}
      aria-pressed={app.sidebarOpen}
      onpointerenter={(e) => { if (e.pointerType === 'mouse') railHover = true }}
      onpointerleave={() => (railHover = false)}
      onclick={() => (app.sidebarOpen = !app.sidebarOpen)}
    >
      <span class="layer" class:shown={showLogo}>
        <DokuMark size={22} />
      </span>
      <span class="layer" class:shown={!showLogo}>
        <svg width="18" height="18" viewBox="-0.5 -0.5 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5.625 2.1875v10.625M1.875 5.875c0 -1.4 0 -2.1 0.2725 -2.635a2.5 2.5 0 0 1 1.0925 -1.0925C3.775 1.875 4.475 1.875 5.875 1.875h3.25c1.4 0 2.1 0 2.635 0.2725a2.5 2.5 0 0 1 1.0925 1.0925C13.125 3.775 13.125 4.475 13.125 5.875v3.25c0 1.4 0 2.1 -0.2725 2.635a2.5 2.5 0 0 1 -1.0925 1.0925C11.225 13.125 10.525 13.125 9.125 13.125H5.875c-1.4 0 -2.1 0 -2.635 -0.2725a2.5 2.5 0 0 1 -1.0925 -1.0925C1.875 11.225 1.875 10.525 1.875 9.125z" />
        </svg>
      </span>
    </button>
  </div>

  <!-- Onglets = boutons (pas de tablist : ni flèches, ni tabpanel, et le « + » y vit aussi) ;
       l'actif porte aria-current. Groupe nommé seulement quand la rangée porte de vrais onglets. -->
  <div
    class="tabs"
    class:split={workspace.split}
    class:stacked={workspaceLayout.stacked}
    role={!workspace.split && !tabsCollapsed ? 'group' : undefined}
    aria-label={!workspace.split && !tabsCollapsed ? 'Onglets ouverts' : undefined}
    data-tauri-drag-region
    bind:this={tabsBox}
    style={`--workspace-ratio:${workspace.ratio}%`}
  >
    {#if workspace.split}
      <div class="split-slot primary" data-tauri-drag-region>
        <PaneTabSelector paneId="primary" onOpen={() => onOpen('primary')} onTabMenu={openTabMenu} />
      </div>
      {#if !workspaceLayout.stacked}
        <div class="split-slot secondary" data-tauri-drag-region>
          <PaneTabSelector paneId="secondary" onOpen={() => onOpen('secondary')} onTabMenu={openTabMenu} />
        </div>
      {/if}
    {:else if tabsCollapsed}
      {@const active = activeTab()}
      <div class="tabs-overflow-root" bind:this={tabsMenuRootEl}>
        <button
          class="tabs-overflow-trigger"
          class:open={tabsMenuOpen}
          bind:this={tabsMenuTriggerEl}
          use:tooltip={(active?.path ?? active?.name ?? '') + (active && isDirty(active) ? ' — non enregistré' : '')}
          aria-haspopup="menu"
          aria-expanded={tabsMenuOpen}
          aria-label={`Onglets ouverts (${app.tabs.length}) — actif : ${active?.name ?? 'aucun'}${active && isDirty(active) ? ', non enregistré' : ''}`}
          onclick={toggleTabsMenu}
          onkeydown={openTabsMenuFromKeyboard}
        >
          {#if active && isDirty(active)}<span class="dot" aria-hidden="true"></span>{/if}
          <span class="name">{active ? middleTruncate(tabLabel(active), nameChars(tabRowWidth - 70)) : ''}</span>
          {#if app.tabs.length > 1}<span class="tabs-overflow-count">+{app.tabs.length - 1}</span>{/if}
          <svg class="icon tabs-overflow-chev" aria-hidden="true"><use href="#i-chevron-down" /></svg>
        </button>
        {#if tabsMenuOpen}
          <div class="app-menu tabs-menu" class:kbd={tabsMenuKbd} role="menu" tabindex="-1" aria-label="Onglets ouverts" bind:this={tabsMenuEl} onkeydown={handleTabsMenuKeydown}>
            {#each app.tabs as tab (tab.id)}
              {@const parent = tabDiscriminator(tab, app.tabs)}
              <div class="tabs-menu-row" role="none">
                <button
                  class="app-menu-item"
                  role="menuitemradio"
                  aria-checked={tab.id === app.activeId}
                  title={(tab.path ?? tab.name) + (isDirty(tab) ? ' — non enregistré' : '')}
                  onclick={() => pickTab(tab.id)}
                  oncontextmenu={(e) => openTabMenu(e, tab.id)}
                >
                  <span class="tabs-menu-dot" class:dirty={isDirty(tab)} class:current={tab.id === app.activeId}></span>
                  <span class="menu-label">{middleTruncate(tabLabel(tab))}</span>
                  {#if isDirty(tab)}<span class="sr-only">non enregistré</span>{/if}
                  {#if parent}<span class="tabs-menu-parent">{parent}</span>{/if}
                </button>
                <button
                  class="tabs-menu-close"
                  use:tooltip={{ label: "Fermer l'onglet", kbd: tab.id === app.activeId ? 'Ctrl+W' : undefined }}
                  aria-label={'Fermer ' + tab.name}
                  onclick={() => requestCloseTab(tab.id)}
                >
                  <svg class="icon" aria-hidden="true"><use href="#i-x" /></svg>
                </button>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {:else}
      {#each app.tabs as tab (tab.id)}
        {@const parent = tabDiscriminator(tab, app.tabs)}
        {@const label = tabLabel(tab)}
        {@const shown = middleTruncate(label, tabNameChars)}
        <button
          class="tab"
          class:active={tab.id === app.activeId}
          class:dragging={tabDrag?.moved && tabDrag.id === tab.id}
          class:torn={tabDrag?.out && tabDrag.id === tab.id}
          style:transform={tabDragTransform(tab)}
          aria-current={tab.id === app.activeId ? 'page' : undefined}
          use:tooltip={(tab.path ?? tab.name) + (isDirty(tab) ? ' — non enregistré' : '')}
          onpointerdown={(e) => startTabDrag(e, tab)}
          onclick={() => { if (!tabDragEnded) selectTab(tab.id) }}
          onauxclick={(e) => { if (e.button === 1) requestCloseTab(tab.id) }}
          oncontextmenu={(e) => openTabMenu(e, tab.id)}
        >
          {#if isDirty(tab)}<span class="dot" aria-hidden="true"></span>{/if}
          {#if shown === label}
            <span class="name">{label}</span>
          {:else}
            <!-- Nom coupé au milieu à l'écran ; entier pour les technologies d'assistance. -->
            <span class="name" aria-hidden="true">{shown}</span><span class="sr-only">{label}</span>
          {/if}
          {#if isDirty(tab)}<span class="sr-only">non enregistré</span>{/if}
          {#if parent}<span class="parent">{parent}</span>{/if}
          <!-- Croix masquée aux technologies d'assistance : un bouton dans un onglet n'est pas
               valide, et Ctrl+W ferme l'onglet au clavier. Souris et doigt gardent le clic. -->
          <span
            class="close"
            use:tooltip={{ label: "Fermer l'onglet", kbd: tab.id === app.activeId ? 'Ctrl+W' : undefined }}
            role="button"
            tabindex="-1"
            aria-hidden="true"
            onclick={(e) => {
              e.stopPropagation()
              // Au doigt, la croix invisible d'un onglet inactif reste touchable : toucher la
              // droite de l'onglet le fermerait. Ce toucher-là l'active, comme ailleurs sur l'onglet.
              if (e instanceof PointerEvent && e.pointerType === 'touch' && tab.id !== app.activeId) selectTab(tab.id)
              else requestCloseTab(tab.id)
            }}
            onkeydown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); requestCloseTab(tab.id) } }}
          >
            <svg class="icon" aria-hidden="true"><use href="#i-x" /></svg>
          </span>
        </button>
      {/each}
      {#if incomingTab}
        <div class="tab active incoming" aria-hidden="true"><span class="name">{incomingTab}</span></div>
      {/if}
    {/if}
    {#if !workspace.split}
      <button class="new-tab" use:tooltip={'Nouvel onglet'} aria-label="Nouvel onglet" onclick={newTab}>
        <svg class="icon" aria-hidden="true"><use href="#i-plus" /></svg>
      </button>
    {/if}
  </div>

  {#if tabDrag?.out && !tabDrag.shown && !tabDrag.target}
    <!-- Aperçu de la fenêtre arrachée, tenu par son onglet au même point que la vraie fenêtre. -->
    <div class="tear-preview" style={`left:${tabDrag.x}px;top:${tabDrag.y}px`} aria-hidden="true" out:fade={{ duration: reducedMotion() ? 0 : 150, easing: quintOut }}>
      <div class="tear-preview-bar"><span class="tear-preview-tab">{tabDrag.name}</span></div>
      <div class="tear-preview-page">
        {#each tabDrag.lines as line, i (i)}
          <span class:title={i === 0}>{line}</span>
        {/each}
        <!-- Document court (ou PDF, Word) : des lignes neutres gardent l'allure d'une page. -->
        {#each { length: Math.max(0, 5 - tabDrag.lines.length) }, i (i)}
          <span class="skeleton" class:short={i % 2 === 1}></span>
        {/each}
      </div>
    </div>
  {/if}

  {#if renaming}
    <!-- Bornée au bord, la surface s'écarte du clic : l'origine du zoom d'entrée reste sur lui. -->
    {@const left = Math.min(renaming.x, window.innerWidth - 240)}
    {@const top = Math.min(renaming.y, window.innerHeight - 60)}
    <div class="tab-rename-pop" style={`left: ${left}px; top: ${top}px; transform-origin: ${renaming.x - left}px ${renaming.y - top}px`}>
      <input
        class="tab-rename"
        type="text"
        aria-label="Nouveau nom de l'onglet"
        bind:this={renameInput}
        bind:value={renameDraft}
        onkeydown={onRenameKey}
        onblur={commitRename}
      />
    </div>
  {/if}

  {#if tabMenu}
    {@const tab = app.tabs.find((t) => t.id === tabMenu?.id)}
    {#if tab}
      {@const left = Math.min(tabMenu.x, window.innerWidth - 250)}
      {@const top = Math.min(tabMenu.y, window.innerHeight - 300)}
      <div
        class="app-menu tab-menu"
        role="menu"
        tabindex="-1"
        aria-label={`Actions sur ${tabLabel(tab)}`}
        style={`left: ${left}px; top: ${top}px; transform-origin: ${tabMenu.x - left}px ${tabMenu.y - top}px`}
        bind:this={tabMenuEl}
        onkeydown={handleTabMenuKeydown}
      >
        <button class="app-menu-item" role="menuitem" onclick={() => tabMenuAction(startRename)}>
          <svg class="icon" aria-hidden="true"><use href="#i-pencil-line" /></svg><span class="menu-label">Renommer l'onglet</span>
        </button>
        <button class="app-menu-item" role="menuitem" disabled={isBinaryKind(tab.kind)} onclick={() => tabMenuAction((a) => duplicateTab(a.id))}>
          <svg class="icon" aria-hidden="true"><use href="#i-copy" /></svg><span class="menu-label">Dupliquer l'onglet</span>
        </button>
        {#if workspace.split}
          <button class="app-menu-item" role="menuitem" onclick={() => tabMenuAction((a) => showInOtherPane(a.id))}>
            <svg class="icon" aria-hidden="true"><use href="#i-arrow-left-right" /></svg><span class="menu-label">Afficher dans l'autre volet</span>
          </button>
        {/if}
        {#if isTauri}
          <button class="app-menu-item" role="menuitem" disabled={!canMoveTabToNewWindow(tab)} onclick={() => tabMenuAction((a) => moveTabToNewWindow(a.id))}>
            <svg class="icon" aria-hidden="true"><use href="#i-external-link" /></svg><span class="menu-label">Détacher l'onglet</span>
          </button>
        {/if}
        <div class="app-menu-sep" role="separator"></div>
        <button class="app-menu-item" role="menuitem" disabled={app.tabs.length < 2} onclick={() => tabMenuAction((a) => closeOtherTabs(a.id))}>
          <svg class="icon" aria-hidden="true"><use href="#i-square-x" /></svg><span class="menu-label">Fermer les autres onglets</span>
        </button>
        <button class="app-menu-item" role="menuitem" disabled={app.tabs.at(-1)?.id === tab.id} onclick={() => tabMenuAction((a) => closeTabsToRight(a.id))}>
          <svg class="icon" aria-hidden="true"><use href="#i-arrow-right-to-line" /></svg><span class="menu-label">Fermer les onglets à droite</span>
        </button>
        <button class="app-menu-item" role="menuitem" onclick={() => tabMenuAction((a) => requestCloseTab(a.id))}>
          <svg class="icon" aria-hidden="true"><use href="#i-x" /></svg><span class="menu-label">Fermer l'onglet</span>
        </button>
      </div>
    {/if}
  {/if}

  <div class="document-menu-root" bind:this={menuRootEl}>
    <button
      class="document-menu-trigger"
      class:open={menuOpen}
      bind:this={menuTriggerEl}
      use:tooltip={'Options du document'}
      aria-label="Options du document"
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      onclick={toggleMenu}
      onkeydown={openMenuFromKeyboard}
    >
      <svg class="icon" aria-hidden="true"><use href="#i-ellipsis" /></svg>
    </button>

    {#if menuOpen}
      <div class="app-menu document-menu" class:kbd={menuKbd} role="menu" tabindex="-1" aria-label="Options du document" bind:this={mainMenuEl} onkeydown={handleMainMenuKeydown}>
        <button
          class="app-menu-item"
          role="menuitem"
          disabled={!activeTab()
            || (activeIsDocx ? (!docxActions.dirty || docxActions.busy !== '') : (isBinaryKind(activeTab()!.kind) || !isDirty(activeTab()!)))}
          onmouseenter={() => (submenu = null)}
          onclick={() => runMenuAction(saveActive)}
        >
          <svg class="icon" aria-hidden="true"><use href="#i-save" /></svg>
          <span class="menu-label">{activeIsDocx && docxActions.busy === 'save' ? 'Enregistrement…' : 'Enregistrer'}</span>
          <kbd>Ctrl+S</kbd>
        </button>

        <div class="submenu-root" role="none" onmouseenter={() => hoverSubmenu('export')}>
          <button
            class="app-menu-item"
            class:open={submenu === 'export'}
            bind:this={exportTriggerEl}
            data-submenu="export"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={submenu === 'export'}
            disabled={!canExport}
            onclick={(e) => clickSubmenu(e, 'export')}
          >
            <svg class="icon" aria-hidden="true"><use href="#i-share" /></svg><span class="menu-label">Exporter</span><svg class="icon menu-chevron" aria-hidden="true"><use href="#i-chevron-left" /></svg>
          </button>
          {#if submenu === 'export' && canExport}
            <div class="app-menu flyout-menu" class:kbd={submenuKbd} class:flip={submenuFlip} role="menu" tabindex="-1" aria-label="Exporter" bind:this={exportMenuEl} onkeydown={(event) => handleSubmenuKeydown(event, 'export')}>
              {#if activeIsPdf}
                <button class="app-menu-item" role="menuitem" disabled={burningPdf || !pdfPath} onclick={() => void exportAnnotatedActive()}>
                  <svg class="icon" aria-hidden="true"><use href="#i-pen-line" /></svg><span class="menu-label">{burningPdf ? 'Gravure en cours…' : 'PDF avec les annotations'}</span><span class="menu-format">.pdf</span>
                </button>
                <button class="app-menu-item" role="menuitem" disabled={!pdfPath} onclick={editTextActive}>
                  <svg class="icon" aria-hidden="true"><use href="#i-file-pen-line" /></svg><span class="menu-label">Modifier le texte…</span>
                </button>
                <button class="app-menu-item" role="menuitem" disabled={!pdfPath} onclick={organizePagesActive}>
                  <svg class="icon" aria-hidden="true"><use href="#i-book-open" /></svg><span class="menu-label">Organiser les pages…</span>
                </button>
              {:else if activeIsDocx}
                <!-- Un document Word s'exporte en PDF par le même menu que les autres
                     formats, plutôt que par des boutons collés au-dessus du document. -->
                <button
                  class="app-menu-item"
                  role="menuitem"
                  disabled={docxActions.busy !== '' || !docxActions.exportPdf}
                  onclick={() => void exportDocxToPdf()}
                >
                  <svg class="icon" aria-hidden="true"><use href="#i-file-text" /></svg>
                  <span class="menu-label">{docxActions.busy === 'pdf' ? 'Export en cours…' : 'Document PDF'}</span>
                  <span class="menu-format">.pdf</span>
                </button>
              {:else}
                {#if activeIsMarkdown}
                  <button class="app-menu-item" role="menuitem" onclick={() => {
                    const tab = activeTab()
                    if (tab) { closeMenus(); exportPortableMarkdown(tab) }
                  }}>
                    <svg class="icon" aria-hidden="true"><use href="#i-download" /></svg><span class="menu-label">Markdown portable</span><span class="menu-format">.md</span>
                  </button>
                {/if}
                <button class="app-menu-item" role="menuitem" onclick={() => exportActive('docx')}>
                  <svg class="icon" aria-hidden="true"><use href="#i-file-text" /></svg><span class="menu-label">Document Word</span><span class="menu-format">.docx</span>
                </button>
                <button class="app-menu-item" role="menuitem" onclick={() => exportActive('html')}>
                  <svg class="icon" aria-hidden="true"><use href="#i-file-code" /></svg><span class="menu-label">Page web autonome</span><span class="menu-format">.html</span>
                </button>
                <button class="app-menu-item" role="menuitem" onclick={() => exportActive('pdf')}>
                  <svg class="icon" aria-hidden="true"><use href="#i-file-text" /></svg><span class="menu-label">Document PDF</span><span class="menu-format">.pdf</span>
                </button>
              {/if}
            </div>
          {/if}
        </div>

        <div class="app-menu-sep"></div>

        <button
          class="app-menu-item"
          role="menuitemcheckbox"
          aria-checked={app.sourceMode}
          disabled={!activeTab() || isBinaryKind(activeTab()!.kind)}
          onmouseenter={() => (submenu = null)}
          onclick={() => runMenuAction(toggleActiveSourceMode)}
        >
          <span class="menu-check">{app.sourceMode ? '✓' : ''}</span><span class="menu-label">Mode source</span><kbd>Ctrl+/</kbd>
        </button>
        <button
          class="app-menu-item"
          role="menuitemcheckbox"
          aria-checked={app.focus}
          onmouseenter={() => (submenu = null)}
          onclick={() => runMenuAction(() => { app.focus = !app.focus })}
        >
          <span class="menu-check">{app.focus ? '✓' : ''}</span><span class="menu-label">Mode focus</span><kbd>F9</kbd>
        </button>

        <div class="submenu-root" role="none" onmouseenter={() => hoverSubmenu('width')}>
          <button
            class="app-menu-item"
            class:open={submenu === 'width'}
            bind:this={widthTriggerEl}
            data-submenu="width"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={submenu === 'width'}
            onclick={(e) => clickSubmenu(e, 'width')}
          >
            <svg class="icon" aria-hidden="true"><use href="#i-columns-2" /></svg><span class="menu-label">Largeur du document</span><svg class="icon menu-chevron" aria-hidden="true"><use href="#i-chevron-left" /></svg>
          </button>
          {#if submenu === 'width'}
            <div class="app-menu flyout-menu width-menu" class:kbd={submenuKbd} class:flip={submenuFlip} role="menu" tabindex="-1" aria-label="Largeur du document" bind:this={widthMenuEl} onkeydown={(event) => handleSubmenuKeydown(event, 'width')}>
              <button class="app-menu-item" role="menuitemradio" aria-checked={app.columnWidth === 'narrow'} onclick={() => pickColumnWidth('narrow')}>
                <span class="menu-check">{app.columnWidth === 'narrow' ? '✓' : ''}</span><svg class="icon" aria-hidden="true"><use href="#i-fold-horizontal" /></svg><span class="menu-label">Étroit</span>
              </button>
              <button class="app-menu-item" role="menuitemradio" aria-checked={app.columnWidth === 'wide'} onclick={() => pickColumnWidth('wide')}>
                <span class="menu-check">{app.columnWidth === 'wide' ? '✓' : ''}</span><svg class="icon" aria-hidden="true"><use href="#i-unfold-horizontal" /></svg><span class="menu-label">Confortable</span>
              </button>
              <button class="app-menu-item" role="menuitemradio" aria-checked={app.columnWidth === 'full'} onclick={() => pickColumnWidth('full')}>
                <span class="menu-check">{app.columnWidth === 'full' ? '✓' : ''}</span><svg class="icon" aria-hidden="true"><use href="#i-move-horizontal" /></svg><span class="menu-label">Pleine largeur</span>
              </button>
            </div>
          {/if}
        </div>

        {#if isTauri}
          <div class="app-menu-sep"></div>
          <button class="app-menu-item" role="menuitem" onmouseenter={() => (submenu = null)} onclick={() => runMenuAction(newWindow)}>
            <svg class="icon" aria-hidden="true"><use href="#i-external-link" /></svg><span class="menu-label">Nouvelle fenêtre</span><kbd>Ctrl+Maj+N</kbd>
          </button>
        {/if}
      </div>
    {/if}
  </div>

  <div class="win-controls">
    <button
      class="ctrl"
      use:tooltip={workspace.split ? 'Réunir les volets' : 'Scinder la vue'}
      aria-label={workspace.split ? 'Réunir les volets' : 'Scinder la vue'}
      aria-pressed={workspace.split}
      onclick={toggleWorkspaceSplit}
    >
      <svg class="icon" aria-hidden="true"><use href="#i-columns-2" /></svg>
    </button>
    <button class="ctrl" use:tooltip={{ label: 'Toujours au-dessus', kbd: 'Ctrl+Maj+T' }} aria-label="Toujours au-dessus" aria-pressed={app.pinned} onclick={togglePin}>
      <svg class="icon" aria-hidden="true"><use href="#i-pin" /></svg>
    </button>
    {#if !app.copilotOpen}
      <!-- Panneau copilote ouvert → ces contrôles migrent dans son en-tête (maquette w2). -->
      <div class="sep"></div>
      <button class="ctrl wide" use:tooltip={'Réduire'} aria-label="Réduire" onclick={minimizeWindow}>
        <svg class="icon" aria-hidden="true"><use href="#i-minus" /></svg>
      </button>
      <button class="ctrl wide" use:tooltip={'Agrandir'} aria-label="Agrandir" onclick={toggleMaximizeWindow}>
        <!-- Le carré Lucide paraît plus massif que les autres glyphes de légende. -->
        <svg class="icon" style="font-size:14px" aria-hidden="true"><use href="#i-square" /></svg>
      </button>
      <button class="ctrl wide close-win" use:tooltip={'Fermer'} aria-label="Fermer" onclick={closeWindow}>
        <svg class="icon" aria-hidden="true"><use href="#i-x" /></svg>
      </button>
    {/if}
  </div>
</div>

<style>
  .titlebar {
    --titlebar-control-height: var(--control-md);
    --titlebar-right-safe: 292px;
    position: relative;
    z-index: var(--z-chrome);
    display: flex;
    align-items: stretch;
    padding-left: 4px;
    height: var(--chrome-titlebar-height);
    flex-shrink: 0;
    background: transparent;
    -webkit-backdrop-filter: blur(24px) saturate(145%);
    backdrop-filter: blur(24px) saturate(145%);
    box-shadow: inset 0 1px 0 var(--chrome-material-filet);
    font-size: var(--text-sm);
    user-select: none;
  }
  .titlebar.copilot-open { --titlebar-right-safe: 156px; }
  .titlebar.split .document-menu-root { margin-left: auto; }
  .titlebar > .rail-zone,
  .titlebar > .document-menu-root,
  .titlebar > .win-controls { position: relative; z-index: 3; }

  .rail-zone { display: flex; align-items: center; flex-shrink: 0; }
  .rail-btn {
    position: relative;
    width: 40px;
    height: var(--titlebar-control-height);
    border: 0;
    border-radius: var(--radius-lg);
    background: transparent;
    color: var(--ink-3);
    cursor: pointer;
    transition: color var(--duration-basic) ease, background-color var(--duration-basic) ease, transform var(--duration-basic) var(--ease-enter-snappy);
  }
  .rail-btn:active { transform: scale(0.97); }
  .rail-btn.lit { background: var(--fill-hover); color: var(--ink); }
  .rail-btn:focus-visible { outline-offset: -2px; }
  /* Échange logo ↔ icône en place : simple fondu bref. Il joue au survol et aux raccourcis
     Ctrl+Maj+E/P/H/F (gestes fréquents) : ni zoom ni flou, qui en feraient un spectacle. */
  .rail-btn .layer {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity var(--duration-basic) ease;
    pointer-events: none;
  }
  .rail-btn .layer.shown { opacity: 1; }

  .document-menu-root {
    position: relative;
    display: flex;
    align-items: center;
    flex: 0 0 40px;
  }
  .document-menu-trigger {
    width: 40px;
    height: var(--titlebar-control-height);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: var(--radius-lg);
    background: transparent;
    color: var(--ink-3);
    cursor: pointer;
    transition:
      background-color var(--duration-basic) ease,
      color var(--duration-basic) ease,
      transform var(--duration-basic) var(--ease-enter-snappy);
  }
  .document-menu-trigger > .icon { font-size: 16px; }
  .document-menu-trigger:hover,
  .document-menu-trigger.open { background: var(--fill-hover); color: var(--ink); }
  .document-menu-trigger:active { transform: scale(0.97); }
  .document-menu-trigger:focus-visible { outline-offset: -2px; }

  /* Menus flottants (menu document, liste repliée des onglets, menu contextuel d'onglet) :
     surface élevée, ouverture depuis le déclencheur à l'échelle .95 + fondu. Ouverts au
     clavier (.kbd) : aucune animation. */
  .app-menu {
    position: absolute;
    top: 38px;
    z-index: var(--z-popover);
    width: 244px;
    padding: 4px;
    border-radius: var(--radius-xl);
    background: var(--composer-bg);
    box-shadow: var(--shadow-xl);
    animation: doku-pop-in var(--duration-basic) var(--ease-enter-snappy);
  }
  .app-menu.kbd { animation: none; }
  .document-menu { right: 0; transform-origin: top right; }
  /* transform-origin posé en ligne : le point cliqué, même quand le menu est borné au bord.
     Bornage vertical (innerHeight − 300) : 7 rangées de 40 px au doigt + séparateur + padding. */
  .tab-menu { position: fixed; top: auto; z-index: var(--z-context); }
  .tab-rename-pop {
    position: fixed;
    z-index: var(--z-context);
    padding: 4px;
    border-radius: var(--radius-xl);
    background: var(--composer-bg);
    box-shadow: var(--shadow-xl);
    animation: doku-pop-in var(--duration-basic) var(--ease-enter-snappy);
  }
  .tab-rename {
    min-width: 0;
    width: 220px;
    height: var(--control-sm);
    padding: 0 8px;
    border: 0;
    border-radius: var(--radius-md);
    background: var(--cream-content);
    color: var(--ink);
    font: inherit;
    font-size: var(--text-sm);
    outline: 2px solid var(--focus-ring);
    outline-offset: -1px;
  }
  .submenu-root { position: relative; }
  /* Le sous-menu s'ouvre à 4 px du bord du menu parent ; `top` compense la gouttière
     pour que sa première ligne s'aligne sur la ligne déclencheuse. */
  .flyout-menu {
    top: -4px;
    right: calc(100% + 8px);
    width: 236px;
    transform-origin: top right;
  }
  .width-menu { width: 220px; }
  /* Sous 600 px le sous-menu recouvre déjà le menu (règle suivante) : pas de retournement. */
  @media not all and (max-width: 600px) {
    .flyout-menu.flip {
      right: auto;
      left: calc(100% + 8px);
      transform-origin: top left;
    }
  }
  @media (max-width: 600px) {
    .document-menu {
      right: auto;
      left: 0;
      transform-origin: top left;
    }
    .flyout-menu {
      right: auto;
      left: 0;
      transform-origin: top left;
    }
  }
  /* Fond de survol = couche ::before, le libellé ne bouge pas. Instantanée : les flèches du
     clavier la déplacent en rafale, un fondu y laisserait deux surbrillances à la fois. */
  .app-menu-item {
    position: relative;
    isolation: isolate;
    width: 100%;
    height: var(--control-md);
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--ink);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: var(--weight-control);
    text-align: left;
    cursor: pointer;
  }
  /* Rangées hautes seulement quand le dernier geste était au doigt (data-input posé par main.ts) :
     sur Surface, `any-pointer: coarse` reste vrai à la souris. */
  :global(:root[data-input='touch']) .app-menu-item { min-height: 40px; }
  .app-menu-item::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1;
    border-radius: inherit;
    background: var(--accent-soft);
    opacity: 0;
  }
  .app-menu-item:not(:disabled):is(:hover, :focus-visible, .open)::before { opacity: 1; }
  .app-menu-item:focus-visible { outline-offset: -2px; }
  .app-menu-item:disabled { opacity: var(--opacity-disabled); cursor: default; }
  .app-menu-item > .icon { font-size: 15px; color: var(--ink-3); }
  .app-menu-item > .menu-chevron { font-size: 14px; color: var(--ink-4); }
  .app-menu-item:not(:disabled):is(:hover, :focus-visible, .open) > .icon { color: var(--ink); }
  .menu-label { flex: 1; min-width: 0; white-space: nowrap; }
  .app-menu-item kbd,
  .menu-format {
    margin-left: auto;
    padding-left: 8px;
    color: var(--ink-4);
    font: var(--weight-regular) var(--text-xs) var(--font-sans);
    white-space: nowrap;
  }
  /* Même largeur que les icônes (15 px) : les libellés cochables restent alignés. */
  .menu-check {
    width: 15px;
    flex: 0 0 auto;
    color: var(--ink);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    text-align: center;
  }
  .app-menu-sep { height: 1px; margin: 4px 8px; background: var(--line-1); }

  .tabs {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 0 4px;
    min-width: 0;
  }
  .tabs.split {
    position: absolute;
    z-index: 1;
    inset: 0;
    display: grid;
    grid-template-columns: var(--workspace-ratio) minmax(0, 1fr);
    gap: 0;
    padding: 0;
    pointer-events: auto;
  }
  .split-slot {
    position: relative;
    min-width: 0;
    display: flex;
    align-items: center;
    padding: 0 8px;
  }
  .split-slot.primary { padding-left: 48px; }
  .split-slot.secondary {
    padding-left: 0;
    padding-right: max(8px, min(var(--titlebar-right-safe), calc(100% - 112px)));
  }
  .tabs.split.stacked {
    position: relative;
    z-index: auto;
    inset: auto;
    flex: 1;
    display: flex;
    padding: 0 4px;
  }
  .tabs.split.stacked .split-slot.primary {
    flex: 1;
    padding: 0;
  }

  /* Mode replié : la rangée entière devient « onglet actif · n ▾ » + menu flottant
     (matériau .app-menu partagé avec le menu document). */
  .tabs-overflow-root { position: relative; display: flex; align-items: center; min-width: 0; }
  .tabs-overflow-trigger {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: var(--titlebar-control-height);
    min-width: 0;
    max-width: 100%;
    padding: 0 8px 0 12px;
    border: 1px solid transparent;
    border-bottom-width: 0;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    background: var(--cream-content);
    box-shadow: 0 4px 0 var(--cream-content);
    color: var(--ink);
    font-size: var(--text-sm);
    font-weight: var(--weight-control);
    cursor: pointer;
  }
  .tabs-overflow-trigger:focus-visible { outline-offset: -2px; }
  /* « +n » nu (n = autres onglets) : info secondaire, pas de pilule qui crie. */
  .tabs-overflow-count {
    flex: 0 0 auto;
    font-size: var(--text-2xs);
    font-weight: var(--weight-strong);
    font-variant-numeric: tabular-nums;
    color: var(--ink-4);
  }
  .tabs-overflow-chev {
    flex: 0 0 auto;
    font-size: 14px;
    color: var(--ink-4);
    transition: transform var(--duration-moderate) var(--ease-enter-snappy);
  }
  .tabs-overflow-trigger.open .tabs-overflow-chev { transform: rotate(180deg); }
  .tabs-menu {
    left: 0;
    transform-origin: top left;
    width: 264px;
    max-height: min(52vh, 420px);
    overflow-y: auto;
    overflow-x: hidden;
  }
  /* Nom long → « … », jamais de scrollbar horizontale (même règle que .name des onglets). */
  .tabs-menu .menu-label { overflow: hidden; text-overflow: ellipsis; }
  .tabs-menu-row { display: flex; align-items: center; gap: 2px; }
  .tabs-menu-row .app-menu-item { flex: 1; min-width: 0; }
  .tabs-menu-row .app-menu-item[aria-checked='true'] { background: var(--accent-soft); }
  /* Colonne fixe : pastille pleine = non enregistré (même 6 px que sur l'onglet), anneau =
     onglet courant, vide sinon — l'alignement des noms reste stable. */
  .tabs-menu-dot { width: 6px; height: 6px; flex: 0 0 auto; border-radius: 50%; }
  .tabs-menu-dot.current { border: 1.5px solid var(--line-3); }
  .tabs-menu-dot.dirty { border: 0; background: var(--ink); }
  .tabs-menu-parent {
    flex-shrink: 3;
    min-width: 0;
    max-width: 90px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-xs);
    font-weight: var(--weight-regular);
    color: var(--ink-4);
  }
  .tabs-menu-parent::before { content: '·'; margin-right: 4px; opacity: 0.55; }
  .tabs-menu-close {
    position: relative;
    width: var(--control-2xs);
    height: var(--control-2xs);
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--ink-4);
    cursor: pointer;
    transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease;
  }
  .tabs-menu-close > .icon { font-size: 14px; }
  /* Fermer un onglet n'est pas destructif : survol neutre, pas la couleur d'erreur. */
  .tabs-menu-close:hover { background: var(--fill-hover); color: var(--ink); }
  .tabs-menu-close:focus-visible { outline-offset: -2px; }
  /* Zone invisible portée à la hauteur de la rangée (32 px à la souris, 40 px au doigt), sans
     mordre sur l'entrée voisine (1 px du trou de 2 px) ; à droite, jusqu'au bord du menu. */
  @media (any-pointer: coarse) {
    .tabs-menu-close::after { content: ''; position: absolute; inset: -4px -4px -4px -1px; }
    :global(:root[data-input='touch']) .tabs-menu-close::after { inset: -8px -4px -8px -1px; }
  }

  .tab {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 6px 0 12px;
    height: var(--titlebar-control-height);
    /* Un onglet ne s'écrase plus au point de ne laisser que la croix : en deçà,
       le strip défile. */
    min-width: 120px; /* = TAB_MIN du script */
    max-width: 240px; /* = TAB_MAX du script */
    flex: 0 1 auto;
    border: 1px solid transparent;
    border-bottom-width: 0;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    background: transparent;
    color: var(--ink-3);
    font-size: var(--text-sm);
    /* Même graisse actif ou non : la largeur des onglets ne bouge pas quand on en change. */
    font-weight: var(--weight-control);
    cursor: pointer;
    /* Pas de fondu : Ctrl+Tab change d'onglet en rafale. Le survol des inactifs garde le
       sien par ::before. */
    transition: none;
  }
  .tab:focus-visible { outline-offset: -2px; }
  .tab.dragging {
    z-index: 5;
    cursor: grabbing;
    background: var(--cream-content);
    color: var(--ink);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-xl);
    transition: box-shadow var(--duration-basic) ease, opacity var(--duration-basic) ease;
  }
  .tab.torn { opacity: 0; }
  /* Mini fenêtre qui suit le curseur ; son onglet (à 60 px du bord) est sous le pointeur. */
  .tear-preview {
    position: fixed;
    z-index: var(--z-drag);
    width: 300px;
    height: 190px;
    margin: -14px 0 0 -60px;
    border-radius: var(--radius-xl);
    overflow: hidden;
    background: var(--cream-content);
    box-shadow: var(--shadow-2xl);
    pointer-events: none;
    transform-origin: 60px 14px;
    animation: tear-preview-in var(--duration-moderate) var(--ease-enter);
  }
  @keyframes tear-preview-in {
    from { opacity: 0; transform: scale(0.35); }
  }
  .tear-preview-bar {
    height: 28px;
    padding: 5px 0 0 12px;
    background: var(--chrome-material-base);
  }
  .tear-preview-tab {
    display: inline-block;
    max-width: 150px;
    height: 23px;
    padding: 4px 12px 0;
    border-radius: var(--radius-md) var(--radius-md) 0 0;
    background: var(--cream-content);
    color: var(--ink);
    font-size: 11px;
    font-weight: 510;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tear-preview-page {
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: 16px 26px;
    color: var(--ink-3);
    font-size: 10px;
    line-height: 1.35;
  }
  .tear-preview-page span {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tear-preview-page .title {
    color: var(--ink);
    font-family: var(--font-serif);
    font-size: 15px;
    font-weight: 600;
  }
  .tear-preview-page .skeleton {
    flex: none;
    height: 7px;
    border-radius: var(--radius-xs);
    background: var(--accent-soft);
  }
  .tear-preview-page .skeleton.short { width: 60%; }
  /* Onglet d'une autre fenêtre tenu au-dessus de cette barre : place qu'il prendra si on le lâche. */
  .tab.incoming {
    pointer-events: none;
    animation: tab-incoming var(--duration-basic) var(--ease-enter);
  }
  @keyframes tab-incoming {
    from { opacity: 0; transform: translateY(6px); }
  }
  .tab:not(.active)::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: var(--radius-md);
    background: var(--fill-hover);
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--duration-basic) ease;
  }
  .tab:not(.active):hover { color: var(--ink-2); }
  .tab:not(.active):hover::before { opacity: 1; }
  .tab:not(.active) > :global(:not(.sr-only)) { position: relative; z-index: 1; }
  .tab.active {
    background: var(--cream-content);
    box-shadow: 0 4px 0 var(--cream-content);
    color: var(--ink);
    z-index: 2;
  }
  /* Congés inversés au pied de l'onglet actif : rayon = --radius-lg (10 px) + 0,5 px d'anticrénelage. */
  .tab.active::before,
  .tab.active::after {
    content: '';
    position: absolute;
    bottom: -4px;
    width: 11px;
    height: 11px;
    pointer-events: none;
  }
  .tab.active::before {
    left: -11px;
    background: radial-gradient(circle at top left, transparent 10.5px, var(--cream-content) 10.5px);
  }
  .tab.active::after {
    right: -11px;
    background: radial-gradient(circle at top right, transparent 10.5px, var(--cream-content) 10.5px);
  }

  /* « Non enregistré » : pastille CSS (pas le glyphe ●, dont la taille suit la police) ;
     le libellé lisible vit dans un .sr-only ou dans l'aria-label du bouton. */
  .dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--ink); }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }
  .name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .parent {
    flex-shrink: 3;
    min-width: 0;
    max-width: 90px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-xs);
    font-weight: var(--weight-regular);
    color: var(--ink-4);
  }
  .parent::before { content: '·'; margin-right: 4px; opacity: 0.55; }
  /* Croix révélée au survol, au focus et sur l'onglet actif ; sa place reste réservée. */
  .close {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 20px;
    height: 20px;
    /* Concentrique : onglet 10 − retrait 6 = 4. */
    border-radius: var(--radius-xs);
    color: var(--ink-3);
    opacity: 0;
    transition:
      opacity var(--duration-basic) ease,
      background-color var(--duration-basic) ease,
      color var(--duration-basic) ease;
  }
  .close > .icon { font-size: 14px; }
  .tab:is(:hover, :focus-visible, .active) .close { opacity: 1; }
  .close:hover { background: var(--accent-soft); color: var(--ink); }
  /* 20 px au doigt : zone portée à la hauteur de l'onglet, rendu inchangé. Sur un onglet
     inactif, ce toucher active l'onglet au lieu de le fermer (voir le onclick). */
  @media (any-pointer: coarse) {
    .close::after { content: ''; position: absolute; inset: -6px; }
  }

  .new-tab {
    position: relative;
    width: var(--control-md);
    flex: 0 0 auto;
    height: var(--titlebar-control-height);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 0;
    border-radius: var(--radius-lg);
    color: var(--ink-3);
    cursor: pointer;
    transition: color var(--duration-basic) ease, transform var(--duration-basic) var(--ease-enter-snappy);
  }
  .new-tab::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: var(--fill-hover);
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--duration-basic) ease;
  }
  .new-tab:hover { color: var(--ink); }
  .new-tab:active { transform: scale(0.97); }
  .new-tab:hover::before { opacity: 1; }
  .new-tab:focus-visible { outline-offset: -2px; }
  .new-tab .icon { position: relative; z-index: 1; font-size: 16px; }

  .win-controls { display: flex; align-items: center; gap: 2px; padding-right: 2px; flex-shrink: 0; }
  .ctrl {
    width: 36px;
    height: var(--titlebar-control-height);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 0;
    border-radius: var(--radius-lg);
    color: var(--ink-3);
    cursor: pointer;
    transition: color var(--duration-basic) ease, background-color var(--duration-basic) ease, transform var(--duration-basic) var(--ease-enter-snappy);
  }
  .ctrl > .icon { font-size: 16px; }
  .ctrl:hover { background: var(--fill-hover); color: var(--ink); }
  .ctrl:active,
  .ctrl[aria-pressed='true'] { background: var(--accent-soft); color: var(--ink); }
  .ctrl:focus-visible { outline-offset: -2px; }
  /* Pression sur les actions de Doku ; la légende Windows (.wide) garde le comportement système. */
  .ctrl:not(.wide):active { transform: scale(0.97); }
  /* Légende Windows (réduire, agrandir, fermer) : rayon de rangée, plus proche du système. */
  .ctrl.wide { width: 40px; border-radius: var(--radius-md); }
  .close-win:hover { background: var(--window-close); color: #fff; }
  .close-win:active { background: var(--window-close-active); color: #fff; }
  .sep { width: 1px; height: 16px; background: var(--line-1); margin: 0 6px; }
</style>
