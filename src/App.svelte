<script lang="ts">
  import { onMount, untrack, type Component } from 'svelte'
  import Sidebar, { snapSidebarToggle } from './components/Sidebar.svelte'
  import TitleBar from './components/TitleBar.svelte'
  import TitleIsland from './components/TitleIsland.svelte'
  import WorkspaceView from './components/WorkspaceView.svelte'
  import ConfirmDialog from './components/ConfirmDialog.svelte'
  import WikilinkPrompt from './components/WikilinkPrompt.svelte'
  import { openSearchPanel } from './lib/editor/editor'
  import { NOTE_MAX_CHARS } from './lib/session'
  import { closeQuickAsk, openQuickAsk, quickAsk } from './lib/quick-ask.svelte'
  import { activatePane, activeEditorView, app, activeTab, askSave, checkExternalChanges, cycleTab, dialog, initApp, isDirty, newWindow, openDropped, openPath, openTab, openWikilink, requestCloseTab, saveSession, saveSettings, setBackgroundModeSetting, saveTabOrSaveAs, toggleActiveSourceMode, togglePin, toggleSidebarView, workspace, zoomDocText } from './lib/stores.svelte'
  import { backgroundModeActive, closeWindow, hideWindow, isMainWindow, isTauri, onFileDrop, onOpenFile, onQuitRequested, onWindowCloseRequested, onWindowFocus, openFileDialog, showWindow } from './lib/tauri'
  import { detectUnsupported } from './lib/encoding'
  import { isBinaryDocumentName } from './lib/doc-kind'
  import { otherPane, type PaneId } from './lib/workspace'
  import { COPILOT_MIN_DOCUMENT_WIDTH, SIDEBAR_OPEN_WIDTH, copilotMaxWidthCss, copilotWidthCss } from './lib/copilot-width'

  // Persiste les préférences (thème, état sidebar) à chaque changement — les lectures
  // de app.* dans saveSettings sont suivies par l'effet.
  $effect(() => {
    saveSettings()
  })

  // Panneau copilote chargé paresseusement : son code + CSS (~90 Ko) sortent du chemin
  // de démarrage. Préchargé à l'idle pour que la première ouverture soit instantanée ;
  // l'effet couvre aussi le boot avec panneau restauré ouvert (settings).
  let CopilotPanelComp: Component | null = $state(null)
  const loadCopilotPanel = () =>
    import('./components/CopilotPanel.svelte').then((m) => {
      CopilotPanelComp = m.default as unknown as Component
    })
  $effect(() => {
    if ((app.copilotOpen || app.copilotMounted) && !CopilotPanelComp) void loadCopilotPanel()
    // Panneau restauré ouvert au boot (settings) : marquer monté pour que la fermeture
    // garde le DOM (slide de sortie) au lieu de démonter brutalement.
    if (app.copilotOpen && !app.copilotMounted) app.copilotMounted = true
  })

  // Plein écran du copilote : `.main` anime flex-grow 0↔1 et CodeMirror remesurait sa
  // largeur à chaque image (4 images perdues au retour, 50 ms au pire à CPU×4). La scène
  // garde sa largeur de vue partagée pendant le rideau ; `.main` (overflow: hidden) ne
  // fait que la découvrir ou la recouvrir.
  let mainEl: HTMLElement | undefined = $state()
  let stageEl: HTMLElement | undefined = $state()
  let sharedWidth = 0
  let sharedWidthAt = 0
  let releaseStage: (() => void) | null = null
  let lastExpanded = false
  // `.pre` : la mesure doit précéder la bascule de classe, sinon `.main` est déjà à 0.
  $effect.pre(() => {
    const expanded = app.copilotExpanded
    untrack(() => {
      if (expanded === lastExpanded) return
      lastExpanded = expanded
      freezeStage(expanded)
    })
  })
  function freezeStage(expanded: boolean) {
    const main = mainEl
    const stage = stageEl
    if (!main || !stage) return
    // Rideau interrompu : la largeur déjà figée est la bonne, pas celle de mi-course.
    // La scène, pas `.main` : celui-ci porte les écarts du bureau (--canvas-gap) en padding.
    if (expanded && !releaseStage) {
      sharedWidth = stage.getBoundingClientRect().width
      sharedWidthAt = innerWidth
    }
    // ponytail: seule la largeur de fenêtre est rattrapée ; une barre latérale basculée
    // pendant le plein écran (Ctrl+Maj+E) coûte un remesurage en fin de course.
    const width = sharedWidth + (expanded ? 0 : innerWidth - sharedWidthAt)
    releaseStage?.()
    if (width <= 0) return
    stage.style.minWidth = `${width}px`
    const onEnd = (event: TransitionEvent) => {
      if (event.target === main && event.propertyName === 'flex-grow') releaseStage?.()
    }
    // Filet : en mouvement réduit, flex-grow ne transitionne pas et rien ne finit.
    // Pas de `transitioncancel` : à l'inversion du rideau, celui de l'ANCIENNE transition
    // arrive après la pose de ces écouteurs et libérerait la scène en pleine course ; une
    // annulation sans relance est couverte par ce minuteur.
    const timer = setTimeout(() => releaseStage?.(), 400)
    main.addEventListener('transitionend', onEnd)
    releaseStage = () => {
      clearTimeout(timer)
      main.removeEventListener('transitionend', onEnd)
      stage.style.minWidth = ''
      releaseStage = null
    }
  }

  // Copilote ouvert sur une fenêtre trop étroite pour barre latérale + document + copilote :
  // la barre latérale se replie, sans toucher la préférence enregistrée (saveSettings relit
  // `sidebarAutoCollapsed`). Elle revient quand la place le permet, ou quand on la rouvre.
  function fitSidebar(opening: boolean, booting = false) {
    const fits = !app.copilotOpen || innerWidth >= SIDEBAR_OPEN_WIDTH + COPILOT_MIN_DOCUMENT_WIDTH + app.copilotWidth
    if (fits) {
      if (!app.sidebarAutoCollapsed) return
      app.sidebarAutoCollapsed = false
      app.sidebarOpen = true
    } else if (opening && app.sidebarOpen) {
      // Au démarrage, la barre naît repliée : pas de rideau qui se ferme sous les yeux.
      if (booting) snapSidebarToggle()
      app.sidebarOpen = false
      app.sidebarAutoCollapsed = true
    }
  }
  let sidebarFitBooted = false
  $effect(() => {
    const open = app.copilotOpen
    untrack(() => fitSidebar(open, !sidebarFitBooted))
    sidebarFitBooted = true
  })
  $effect(() => {
    if (app.sidebarOpen) untrack(() => (app.sidebarAutoCollapsed = false))
  })

  // Même schéma pour la modale Paramètres : chargée au premier besoin, démontée à la
  // fermeture (elle ré-initialise son état à chaque ouverture de toute façon).
  let SettingsDialogComp: Component | null = $state(null)
  $effect(() => {
    if (app.settingsOpen && !SettingsDialogComp) {
      void import('./components/SettingsDialog.svelte').then((m) => {
        SettingsDialogComp = m.default as unknown as Component
      })
    }
  })

  // Palette de commandes : même schéma, chargée au premier Ctrl+Maj+A.
  let CommandPaletteComp: Component<{ onOpen: () => void }> | null = $state(null)
  $effect(() => {
    if (app.paletteOpen && !CommandPaletteComp) {
      void import('./components/CommandPalette.svelte').then((m) => {
        CommandPaletteComp = m.default
      })
    }
  })

  // Idem pour « Organiser les pages » : elle tire pdf.js ET la bibliothèque d'écriture,
  // qui n'ont rien à faire dans le bundle de démarrage.
  let PdfTextEditDialogComp: Component | null = $state(null)
  $effect(() => {
    if (app.pdfTextEditPath && !PdfTextEditDialogComp) {
      void import('./components/PdfTextEditDialog.svelte').then((m) => {
        PdfTextEditDialogComp = m.default as unknown as Component
      })
    }
  })

  let PdfPagesDialogComp: Component | null = $state(null)
  $effect(() => {
    if (app.pdfPagesPath && !PdfPagesDialogComp) {
      void import('./components/PdfPagesDialog.svelte').then((m) => {
        PdfPagesDialogComp = m.default as unknown as Component
      })
    }
  })

  // Persiste la session (onglets ouverts + actif), débouncée à 500 ms.
  let sessionTimer: ReturnType<typeof setTimeout> | undefined
  $effect(() => {
    void [
      app.tabs.map((t) => t.path ?? t.content),
      workspace.split,
      workspace.activePaneId,
      workspace.primary.tabId,
      workspace.secondary.tabId,
      workspace.ratio,
    ]
    clearTimeout(sessionTimer)
    sessionTimer = setTimeout(saveSession, 500)
  })

  async function saveActive() {
    const tab = activeTab()
    if (tab) await saveTabOrSaveAs(tab)
  }

  async function openFromDialog(targetPane: PaneId = workspace.activePaneId) {
    try {
      const file = await openFileDialog()
      if (!file) return
      // Un document binaire n'a pas de contenu texte à examiner : le passer à
      // `detectUnsupported` reviendrait à lui demander si une archive ZIP est du texte
      // lisible — la réponse est non, et le fichier était rejeté à tort.
      const reason = isBinaryDocumentName(file.name) ? null : detectUnsupported(file.content, file.name)
      if (reason) {
        app.banner = { tone: 'error', title: 'Fichier non pris en charge', message: reason }
        return
      }
      openTab(file.name, file.path, file.content, undefined, targetPane)
    } catch (err) {
      console.error('Ouverture du fichier échouée', err)
      app.banner = {
        tone: 'error',
        title: 'Ouverture impossible',
        message: "Le fichier n’a pas pu être lu ou son encodage n’est pas pris en charge.",
      }
    }
  }

  onMount(() => {
    const appReady = initApp()
    void appReady.then(() => import('./lib/copilot-conversations.svelte'))
      .then(({ initConversations }) => initConversations())
      .catch((error) => console.error('Chargement des discussions échoué', error))

    // Précharge le module du copilote à l'idle : au premier clic, le composant est déjà
    // en cache et l'ouverture (montage fermé → slide) est instantanée.
    if ('requestIdleCallback' in window) requestIdleCallback(() => void loadCopilotPanel(), { timeout: 3000 })
    else setTimeout(() => void loadCopilotPanel(), 1000)

    // Mode veille : la fenêtre principale se contente de se masquer, sauf quand « Quitter Doku »
    // (icône de la zone de notification) demande une vraie fermeture de chaque fenêtre.
    let quitting = false
    void isMainWindow().then((main) => {
      if (main && app.backgroundMode) void setBackgroundModeSetting(true)
    })
    let unlistenQuit: (() => void) | null = null
    onQuitRequested(() => {
      quitting = true
      void closeWindow()
    })
      .then((u) => (unlistenQuit = u))
      .catch((err) => console.error('Écoute de « Quitter Doku » échouée', err))

    const closeGuard = async (): Promise<boolean> => {
      if (!quitting && (await isMainWindow()) && (await backgroundModeActive())) {
        saveSession()
        await hideWindow()
        return false
      }
      try {
        const [{ flushActiveConversation }, { flushConversationWrites }] = await Promise.all([
          import('./lib/copilot.svelte'),
          import('./lib/copilot-conversations.svelte'),
        ])
        await flushActiveConversation()
        await flushConversationWrites()
      } catch (error) {
        if (quitting) await showWindow()
        app.banner = {
          tone: 'error',
          title: 'Discussion non enregistrée',
          message: error instanceof Error ? error.message : 'Doku n’a pas pu enregistrer la discussion avant de fermer.',
        }
        return false
      }
      // Flush au quit (au-delà du débounce). Une note sans chemin voyage dans la session
      // (comme le Bloc-notes) : pas d'invite pour elle — SI l'écriture a réellement eu lieu.
      const persisted = saveSession()
      const dirty = app.tabs.filter((t) => isDirty(t) && !(persisted && t.path == null && t.content.length <= NOTE_MAX_CHARS))
      if (dirty.length === 0) return true
      // Fermeture demandée depuis l'icône : la fenêtre peut être masquée, l'invite doit se voir.
      if (quitting) await showWindow()
      const choice = await askSave(
        'Enregistrer les modifications ?',
        dirty.length === 1
          ? `Voulez-vous enregistrer les modifications apportées à « ${dirty[0].name} » avant de quitter ?`
          : `Voulez-vous enregistrer les modifications de ${dirty.length} documents avant de quitter ?`,
      )
      if (choice === 'cancel') return false
      if (choice === 'save') {
        for (const t of dirty) if (!(await saveTabOrSaveAs(t))) return false
        saveSession() // les notes enregistrées ici ont maintenant un chemin
      }
      return true
    }
    let unlistenClose: (() => void) | null = null
    onWindowCloseRequested(async () => {
      const allowed = await closeGuard()
      // Invite annulée : un prochain × doit retrouver le comportement normal (veille comprise).
      if (!allowed) quitting = false
      return allowed
    })
      .then((u) => (unlistenClose = u))
      .catch((err) => console.error('Enregistrement du garde de fermeture échoué', err))

    // Ouverture de fichier venue de l'hôte (double-clic, association, 2e instance).
    let unlistenOpen: (() => void) | null = null
    onOpenFile((path) => openPath(path))
      .then((u) => (unlistenOpen = u))
      .catch((err) => console.error("Écoute d'ouverture de fichier échouée", err))

    // Modifications externes : au retour du focus, relire les fichiers ouverts (FR-3).
    let unlistenFocus: (() => void) | null = null
    onWindowFocus(() => void checkExternalChanges())
      .then((u) => (unlistenFocus = u))
      .catch((err) => console.error("Écoute du focus fenêtre échouée", err))

    // Glisser-déposer de fichiers sur la fenêtre (FR-4, 2.4).
    let unlistenDrop: (() => void) | null = null
    onFileDrop(
      (paths) => { for (const p of paths) void openDropped(p) },
      (active) => { app.dragging = active },
    )
      .then((u) => (unlistenDrop = u))
      .catch((err) => console.error('Écoute du glisser-déposer échouée', err))

    const onKey = async (e: KeyboardEvent) => {
      if (dialog.open || app.wikiPrompt) return
      if (e.key === 'F9') {
        e.preventDefault()
        app.focus = !app.focus
        return
      }
      if (e.key === 'Escape' && app.copilotExpanded) {
        e.preventDefault()
        app.copilotExpanded = false
        return
      }
      if (e.key === 'Escape' && app.focus) {
        e.preventDefault()
        app.focus = false
        return
      }
      if (e.key === 'F6' && workspace.split) {
        e.preventDefault()
        activatePane(otherPane(workspace.activePaneId))
        requestAnimationFrame(() => activeEditorView()?.focus())
        return
      }
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const k = e.key.toLowerCase()
      // Zoom du texte (Ctrl+0 / Ctrl+= / Ctrl+-) sur un document texte ; le PDF garde le sien.
      // `code` pour le 0 : sur un clavier AZERTY, la touche 0 sans Maj donne « à ».
      const zoomStep = e.key === '+' || e.key === '=' ? 1 : e.key === '-' ? -1 : e.code === 'Digit0' || e.code === 'Numpad0' ? 0 : null
      const zoomTab = activeTab()
      if (zoomStep !== null && !e.altKey && zoomTab && (zoomTab.kind === 'md' || zoomTab.kind === 'txt' || (zoomTab.kind === 'html' && app.sourceMode))) {
        e.preventDefault()
        zoomDocText(zoomStep)
        return
      }
      if (k === 's') {
        e.preventDefault()
        await saveActive()
      } else if (k === 'w') {
        e.preventDefault()
        if (app.activeId) requestCloseTab(app.activeId)
      } else if (k === 'tab') {
        e.preventDefault()
        cycleTab(e.shiftKey ? -1 : 1)
      } else if (e.key === '/') {
        e.preventDefault()
        toggleActiveSourceMode()
      } else if (k === 'p' && !e.shiftKey) {
        // Toujours bloqué : l'impression native de la webview imprimerait l'interface.
        e.preventDefault()
        const tab = activeTab()
        if (tab) void import('./lib/export/print').then((m) => m.printDocument(tab))
      } else if (k === 'o' && !e.shiftKey) {
        e.preventDefault()
        await openFromDialog()
      } else if (k === 'e' && e.shiftKey) {
        e.preventDefault()
        snapSidebarToggle()
        toggleSidebarView('files')
      } else if (k === 'p' && e.shiftKey) {
        e.preventDefault()
        snapSidebarToggle()
        toggleSidebarView('plan')
      } else if (k === 'h' && e.shiftKey) {
        e.preventDefault()
        snapSidebarToggle()
        toggleSidebarView('history')
      } else if (k === 'f' && e.shiftKey) {
        e.preventDefault()
        snapSidebarToggle()
        toggleSidebarView('search')
      } else if (k === 'f') {
        // Ctrl+F depuis n'importe où (aperçu, barre, panneau) : le panneau de recherche
        // de l'éditeur actif. Dans l'éditeur, son propre keymap l'a déjà pris.
        const view = activeEditorView()
        if (view) {
          e.preventDefault()
          view.focus()
          openSearchPanel(view)
        }
      } else if (k === 'a' && e.shiftKey) {
        // Pas Ctrl+Maj+P (Plan) ni Ctrl+K (lien) : Ctrl+Maj+A, la « recherche d'action » des IDE JetBrains.
        e.preventDefault()
        app.paletteOpen = !app.paletteOpen
      } else if (k === 't' && e.shiftKey) {
        e.preventDefault()
        togglePin()
      } else if (k === 'n' && e.shiftKey && isTauri) {
        e.preventDefault()
        newWindow()
      } else if (e.code === 'Space' && !e.shiftKey && !e.altKey) {
        // Ctrl+Espace : question rapide à Doku-San dans l'îlot (libre dans CodeMirror ; Alt+Espace = menu système).
        e.preventDefault()
        if (quickAsk.open) closeQuickAsk()
        else openQuickAsk()
      }
    }

    const onWikilink = (e: Event) => {
      openWikilink((e as CustomEvent<string>).detail)
    }

    const onResize = () => fitSidebar(false)

    window.addEventListener('keydown', onKey)
    window.addEventListener('doku:wikilink', onWikilink)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      unlistenClose?.()
      unlistenQuit?.()
      unlistenOpen?.()
      unlistenFocus?.()
      unlistenDrop?.()
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('doku:wikilink', onWikilink)
    }
  })
</script>

<div class="app" class:focus={app.focus}>
  {#if !app.focus}<Sidebar />{/if}
  <div class="main" class:copilot-expanded={app.copilotExpanded} bind:this={mainEl}>
    {#if !app.focus}<TitleBar onOpen={openFromDialog} />{/if}
    <div class="stage" bind:this={stageEl}>
      <div class="page">
        <!-- Notifications, activités et question rapide : l'îlot est accroché en haut de la
             feuille, centré sur elle, et s'ouvre par-dessus le document. -->
        <TitleIsland />
        <WorkspaceView onOpen={openFromDialog} />
      </div>
    </div>
  </div>
  {#if !app.focus && (app.copilotMounted || app.copilotOpen) && CopilotPanelComp}<CopilotPanelComp />
  {:else if !app.focus && app.copilotOpen}
    <!-- Panneau restauré ouvert, module pas encore chargé : sa place est réservée à la même
         largeur effective, sinon la colonne de texte saute de côté à son arrivée. -->
    <div class="cop-placeholder" style:flex-basis={copilotWidthCss(app.copilotWidth)} style:max-width={copilotMaxWidthCss(app.sidebarOpen)}></div>
  {/if}
  {#if app.dragging}
    <div class="drop-overlay" role="presentation">
      <div class="drop-hint">
        <svg class="icon" aria-hidden="true"><use href="#i-file-down" /></svg>
        Déposez le fichier pour l'ouvrir
      </div>
    </div>
  {/if}
</div>

<ConfirmDialog />
<WikilinkPrompt />
{#if app.settingsOpen && SettingsDialogComp}<SettingsDialogComp />{/if}
{#if app.paletteOpen && CommandPaletteComp}<CommandPaletteComp onOpen={openFromDialog} />{/if}
{#if app.pdfPagesPath && PdfPagesDialogComp}<PdfPagesDialogComp />{/if}
{#if app.pdfTextEditPath && PdfTextEditDialogComp}<PdfTextEditDialogComp />{/if}

<style>
  /* Bureau : matériau du chrome (ou Mica, transparent). Les surfaces — barre latérale,
     feuilles du document, copilote — y sont posées en cartes (refonte v2, §1). */
  .app {
    position: relative;
    height: 100%;
    display: flex;
    background: var(--chrome-material);
    background-color: var(--chrome-material-base);
    box-shadow: inset 0 1px 0 var(--chrome-material-filet);
  }
  /* En sombre, le bureau descend vers --desk (#101010) : sans cela, feuille (#181818) et
     matériau (#16171A) se confondent et les cartes ne se détachent plus. */
  :global(:root[data-theme='dark']) .app {
    background: linear-gradient(rgb(0 0 0 / 0.5) 0 0), var(--chrome-material);
  }
  :global(:root[data-window-backdrop='mica']) .app {
    background: transparent;
    background-color: transparent;
  }
  /* Les écarts du bureau à gauche, à droite et en bas de la feuille vivent ici : la barre
     de titre couvre ainsi exactement la largeur des feuilles (onglets alignés sur elles).
     `clip` + marge : l'ombre de la feuille déborde dans l'écart au lieu d'y être tranchée. */
  .main {
    position: relative;
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    padding: 0 var(--canvas-gap) var(--canvas-gap);
    overflow: clip;
    overflow-clip-margin: var(--canvas-gap);
    opacity: 1;
    transition:
      flex-grow var(--duration-relaxed) var(--ease-curtain),
      padding-right var(--duration-relaxed) var(--ease-curtain),
      opacity 100ms var(--ease-enter-snappy);
  }
  /* Copilote agrandi : il garde l'écart gauche du bureau, rien d'autre. */
  .main.copilot-expanded { flex-grow: 0; padding-right: 0; opacity: 0; pointer-events: none; }
  /* Mode focus : plus de bureau, la feuille seule bord à bord. */
  .app.focus .main { padding: 0; }
  .cop-placeholder { flex: 0 0 auto; min-width: 0; }
  .drop-overlay {
    position: absolute;
    inset: 8px;
    z-index: var(--z-overlay);
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--sheet-radius);
    border: 2px dashed var(--line-3);
    background: rgba(var(--ink-rgb), 0.06);
    backdrop-filter: blur(1px);
    pointer-events: none;
    /* Entrée seulement : au lâcher, le fichier s'ouvre, le voile part sec. */
    animation: doku-fade-in var(--duration-basic) var(--ease-enter-snappy);
  }
  .drop-hint {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 20px 28px;
    border-radius: var(--radius-xl);
    background: var(--surface);
    box-shadow: var(--shadow-xl);
    color: var(--ink);
    font-size: var(--text-md);
    animation: doku-pop-in var(--duration-moderate) var(--ease-enter-snappy);
  }
  .drop-hint > .icon { color: var(--ink-3); font-size: 28px; stroke-width: 1.5; }
  .stage { flex: 1; min-height: 0; display: flex; background: transparent; }
  /* Conteneur des feuilles : la carte (fond, rayon, ombre) est portée par chaque volet
     (WorkspaceView), pour que la vue scindée montre deux feuilles. */
  .page {
    position: relative;
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
</style>
