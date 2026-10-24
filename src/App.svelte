<script lang="ts">
  import { onMount, untrack, type Component } from 'svelte'
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import Sidebar, { snapSidebarToggle } from './components/Sidebar.svelte'
  import TitleBar from './components/TitleBar.svelte'
  import WorkspaceView from './components/WorkspaceView.svelte'
  import ConfirmDialog from './components/ConfirmDialog.svelte'
  import WikilinkPrompt from './components/WikilinkPrompt.svelte'
  import { openSearchPanel } from './lib/editor/editor'
  import { NOTE_MAX_CHARS } from './lib/session'
  import { activatePane, activeEditorView, app, activeTab, askSave, checkExternalChanges, cycleTab, dialog, dismissReloadPrompt, initApp, isDirty, newWindow, openCopilot, openDropped, openPath, openTab, openWikilink, reloadPromptedTab, requestCloseTab, saveSession, saveSettings, setBackgroundModeSetting, saveTabOrSaveAs, toggleActiveSourceMode, togglePin, toggleSidebarView, workspace, zoomDocText } from './lib/stores.svelte'
  import { backgroundModeActive, closeWindow, hideWindow, isMainWindow, isTauri, onFileDrop, onOpenFile, onQuitRequested, onWindowCloseRequested, onWindowFocus, openFileDialog, showWindow } from './lib/tauri'
  import { detectUnsupported } from './lib/encoding'
  import { isBinaryDocumentName } from './lib/doc-kind'
  import { otherPane, type PaneId } from './lib/workspace'
  import { NOTICE_DELAY, autoDismiss } from './lib/auto-dismiss'
  import { tooltip } from './lib/tooltip'
  import { COPILOT_MIN_DOCUMENT_WIDTH, SIDEBAR_OPEN_WIDTH, copilotMaxWidthCss, copilotWidthCss } from './lib/copilot-width'

  // Les transitions Svelte passent par WAAPI et échappent à la règle reduced-motion d'app.css.
  // Lu à chaque transition : la préférence système peut changer pendant que l'app tourne.
  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

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
    if (expanded && !releaseStage) {
      sharedWidth = main.getBoundingClientRect().width
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
      } else if (k === 't' && e.shiftKey) {
        e.preventDefault()
        togglePin()
      } else if (k === 'n' && e.shiftKey && isTauri) {
        e.preventDefault()
        newWindow()
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

<div class="app">
  {#if !app.focus}<Sidebar />{/if}
  <div class="main" class:copilot-expanded={app.copilotExpanded} bind:this={mainEl}>
    {#if !app.focus}<TitleBar onOpen={openFromDialog} />{/if}
    {#if !app.focus}
      <!-- Pile toujours montée (vide, elle ne capte rien) : la sortie de la notification
           peut se jouer. Pas d'aria-live ici : les rôles alert/status des cartes annoncent
           déjà, la région en plus doublait l'annonce. -->
      <div class="notice-stack">
        {#if app.banner}
          <!-- Sortie sur l'enveloppe : elle ne joue qu'à l'effacement. Au remplacement, la
               carte reste montée (pas de nouvelle entrée) ; seul le filet de vie repart, et
               autoDismiss remet le minuteur à zéro par `key`. -->
          <div class="notice-slot" out:fly={{ y: 8, opacity: 0, duration: reducedMotion() ? 0 : 150, easing: cubicOut }}>
          <div
            class="notice"
            class:error={app.banner.tone === 'error'}
            class:warning={app.banner.tone === 'warning'}
            class:success={app.banner.tone === 'success'}
            role={app.banner.tone === 'error' ? 'alert' : 'status'}
            use:autoDismiss={{
              delay: NOTICE_DELAY[app.banner.tone],
              key: app.banner,
              onDismiss: () => (app.banner = null),
            }}
          >
            <svg class="icon notice-icon" aria-hidden="true"><use href="#i-{app.banner.tone === 'success' ? 'check' : app.banner.tone === 'warning' ? 'triangle-alert' : 'circle-alert'}" /></svg>
            <span class="notice-copy">
              <strong>{app.banner.title}</strong>
              <span>{app.banner.message}</span>
            </span>
            <button class="notice-close" onclick={() => (app.banner = null)} aria-label="Fermer la notification">
              <svg class="icon" aria-hidden="true"><use href="#i-x" /></svg>
            </button>
            <!-- Pas de filet sur une notification persistante (erreur) : il promettrait un
                 effacement qui ne viendra pas. -->
            {#if NOTICE_DELAY[app.banner.tone] > 0}
              {#key app.banner}
                <span class="notice-life" aria-hidden="true" style:animation-duration="{NOTICE_DELAY[app.banner.tone]}ms"></span>
              {/key}
            {/if}
          </div>
          </div>
        {/if}
        {#if app.reloadPrompt}
          <div class="notice reload" role="status">
            <svg class="icon notice-icon" aria-hidden="true"><use href="#i-refresh-cw" /></svg>
            <span class="notice-copy">
              <strong>Fichier modifié sur le disque</strong>
              <span>« {app.reloadPrompt.name} » a changé ailleurs. Le recharger remplacera vos modifications locales.</span>
            </span>
            <button class="notice-action" onclick={() => void reloadPromptedTab()}>Recharger</button>
            <button class="notice-close" onclick={dismissReloadPrompt} aria-label="Ignorer la notification">
              <svg class="icon" aria-hidden="true"><use href="#i-x" /></svg>
            </button>
          </div>
        {/if}
      </div>
    {/if}
    <div class="stage" bind:this={stageEl}>
      <div class="page" class:with-copilot={app.copilotOpen}>
        {#if !app.focus}
          <button
            class="collapse-btn"
            class:on={app.copilotOpen}
            use:tooltip={'Copilote — panneau latéral'}
            aria-label="Copilote"
            aria-pressed={app.copilotOpen}
            onclick={() => {
              if (app.copilotOpen) {
                app.copilotOpen = false
                app.copilotView = 'chat'
                app.copilotExpanded = false
              } else {
                openCopilot()
              }
            }}
          >
            <svg width="17" height="17" viewBox="-0.5 -0.5 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" style="transform:scaleX(-1)"><path d="M5.625 2.1875v10.625M1.875 5.875c0 -1.4 0 -2.1 0.2725 -2.635a2.5 2.5 0 0 1 1.0925 -1.0925C3.775 1.875 4.475 1.875 5.875 1.875h3.25c1.4 0 2.1 0 2.635 0.2725a2.5 2.5 0 0 1 1.0925 1.0925C13.125 3.775 13.125 4.475 13.125 5.875v3.25c0 1.4 0 2.1 -0.2725 2.635a2.5 2.5 0 0 1 -1.0925 1.0925C11.225 13.125 10.525 13.125 9.125 13.125H5.875c-1.4 0 -2.1 0 -2.635 -0.2725a2.5 2.5 0 0 1 -1.0925 -1.0925C1.875 11.225 1.875 10.525 1.875 9.125z"></path></svg>
          </button>
        {/if}
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
{#if app.pdfPagesPath && PdfPagesDialogComp}<PdfPagesDialogComp />{/if}
{#if app.pdfTextEditPath && PdfTextEditDialogComp}<PdfTextEditDialogComp />{/if}

<style>
  .app {
    position: relative;
    height: 100%;
    display: flex;
    background: var(--chrome-material);
    background-color: var(--chrome-material-base);
  }
  :global(:root[data-window-backdrop='mica']) .app {
    background: transparent;
    background-color: transparent;
  }
  .main {
    position: relative;
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    opacity: 1;
    transition:
      flex-grow var(--duration-relaxed) var(--ease-curtain),
      opacity 100ms var(--ease-enter-snappy);
  }
  .main.copilot-expanded { flex-grow: 0; opacity: 0; pointer-events: none; }
  .cop-placeholder { flex: 0 0 auto; min-width: 0; }
  .drop-overlay {
    position: absolute;
    inset: 8px;
    z-index: var(--z-overlay);
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-2xl);
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
  /* En BAS de la zone document : en haut, la carte recouvrait le titre du document qu'on lit.
     `.main` exclut le copilote : le composer n'est jamais masqué. */
  .notice-stack {
    position: absolute;
    z-index: var(--z-toast);
    bottom: 16px;
    left: 50%;
    width: min(540px, calc(100% - 32px));
    display: grid;
    gap: 8px;
    pointer-events: none;
    transform: translateX(-50%);
  }
  /* Notification (motif Toast de Kube) : surface élevée, pastille d'icône teintée par le ton,
     entrée qui monte en fondu depuis le bord bas. */
  @keyframes notice-in { from { opacity: 0; transform: translateY(6px) scale(0.98); } }
  .notice {
    pointer-events: auto;
    position: relative;
    overflow: hidden;
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 52px;
    padding: 8px;
    border-radius: var(--radius-2xl);
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--shadow-xl);
    animation: notice-in var(--duration-moderate) var(--ease-enter);
  }
  /* Pastille de 36 px : le padding ramène le glyphe (qui remplit la boîte de contenu du svg) à 16 px. */
  .notice-icon {
    flex: none;
    width: 36px;
    height: 36px;
    padding: 10px;
    border-radius: var(--radius-md);
    background: var(--accent-soft);
    color: var(--ink-3);
  }
  .notice.error .notice-icon { background: color-mix(in srgb, var(--err) 14%, transparent); color: var(--err-text); }
  .notice.warning .notice-icon { background: color-mix(in srgb, var(--warn) 16%, transparent); color: var(--warn-text); }
  .notice.success .notice-icon { background: color-mix(in srgb, var(--ok) 16%, transparent); color: var(--ok-text); }
  .notice-copy {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 2px;
    font-size: var(--text-xs);
    line-height: var(--leading-snug);
    /* Un message d'erreur se copie (chemin, cause) : le body interdit la sélection. */
    user-select: text;
  }
  .notice-copy strong { color: var(--ink); font-size: var(--text-sm); font-weight: var(--weight-strong); text-wrap: balance; }
  .notice-copy > span { color: var(--ink-3); overflow-wrap: anywhere; text-wrap: pretty; }
  /* Rayon concentrique : carte 16 − padding 8 = 8. */
  .notice-action {
    flex: none;
    height: var(--control-sm);
    padding: 0 12px;
    border-radius: var(--radius-md);
    border: 0;
    background: var(--ink);
    color: var(--cream-content);
    font: var(--weight-control) var(--text-sm) var(--font-sans);
    cursor: pointer;
    transition: background-color var(--duration-basic) ease, transform var(--duration-basic) var(--ease-enter-snappy);
  }
  .notice-action:hover { background: var(--ink-2); }
  .notice-close {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--control-sm);
    height: var(--control-sm);
    border: 0;
    background: transparent;
    color: var(--ink-4);
    cursor: pointer;
    border-radius: var(--radius-md);
    transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease, transform var(--duration-basic) var(--ease-enter-snappy);
  }
  .notice-close .icon { font-size: 16px; }
  .notice-close:hover { background: var(--fill-hover); color: var(--ink); }
  .notice-action:active,
  .notice-close:active,
  .collapse-btn:active { transform: scale(0.97); }
  /* Filet de vie : dit que la notification est TRANSITOIRE, et combien de temps il
     reste. Sans lui, l'effacement automatique surprend au lieu d'être attendu. Il se
     fige sur `data-paused`, posé par le compte à rebours JS lui-même : jamais de barre
     qui court sur une minuterie suspendue, ni l'inverse (survol collant au doigt). */
  .notice-life {
    position: absolute;
    left: 0; right: 0; bottom: 0;
    height: 2px;
    background: var(--line-2);
    transform-origin: left center;
    animation: doku-life linear forwards;
  }
  .notice.error .notice-life { background: color-mix(in srgb, var(--err) 45%, transparent); }
  .notice.warning .notice-life { background: color-mix(in srgb, var(--warn) 45%, transparent); }
  .notice.success .notice-life { background: color-mix(in srgb, var(--ok) 45%, transparent); }
  .notice:global([data-paused]) .notice-life { animation-play-state: paused; }
  @media (prefers-reduced-motion: reduce) {
    /* La notification part toujours seule ; seule l'ANIMATION du filet disparaît. */
    .notice-life { animation: none; transform: scaleX(1); opacity: 0.5; }
  }
  .stage { flex: 1; min-height: 0; display: flex; background: transparent; }
  .page {
    position: relative;
    flex: 1;
    min-width: 0;
    background: var(--cream-content);
    border-radius: var(--radius-2xl) var(--radius-2xl) 0 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    /* Couplé au rideau du copilote : même durée, même courbe. */
    transition: border-radius var(--duration-curtain) var(--ease-curtain);
  }
  /* Panneau copilote ouvert : la jonction document↔chat est à angle droit. */
  .page.with-copilot { border-radius: var(--radius-2xl) 0 0 0; }
  /* PdfView aligne ses contrôles flottants sur ce bouton (top 8, hauteur 32). */
  .collapse-btn {
    position: absolute;
    top: 8px;
    right: 12px;
    z-index: 5;
    width: var(--control-md);
    height: var(--control-md);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    /* Même famille que les capsules flottantes du PDF : rond, ombre de carte. */
    border-radius: var(--radius-full);
    background: var(--surface);
    color: var(--ink-3);
    box-shadow: var(--shadow-card);
    cursor: pointer;
    transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease, transform var(--duration-basic) var(--ease-enter-snappy);
  }
  .collapse-btn:hover,
  .collapse-btn.on {
    background: var(--cream-tint);
    color: var(--ink);
  }
</style>
