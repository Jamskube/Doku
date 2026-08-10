<script lang="ts">
  import { onMount, type Component } from 'svelte'
  import Sidebar from './components/Sidebar.svelte'
  import TitleBar from './components/TitleBar.svelte'
  import DocumentView from './components/DocumentView.svelte'
  import ConfirmDialog from './components/ConfirmDialog.svelte'
  import WikilinkPrompt from './components/WikilinkPrompt.svelte'
  import { app, activeTab, askSave, checkExternalChanges, cycleTab, dialog, dismissReloadPrompt, initApp, isDirty, openCopilot, openDropped, openPath, openTab, openWikilink, reloadPromptedTab, requestCloseTab, saveSession, saveSettings, saveTab, togglePin, toggleSidebarView } from './lib/stores.svelte'
  import { onFileDrop, onOpenFile, onWindowCloseRequested, onWindowFocus, openFileDialog } from './lib/tauri'
  import { detectUnsupported } from './lib/encoding'

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

  // Persiste la session (onglets ouverts + actif), débouncée à 500 ms.
  let sessionTimer: ReturnType<typeof setTimeout> | undefined
  $effect(() => {
    void [app.tabs.map((t) => t.path).join('|'), app.activeId]
    clearTimeout(sessionTimer)
    sessionTimer = setTimeout(saveSession, 500)
  })

  async function saveActive() {
    const tab = activeTab()
    if (tab) await saveTab(tab)
  }

  async function openFromDialog() {
    try {
      const file = await openFileDialog()
      if (!file) return
      const reason = detectUnsupported(file.content, file.name)
      if (reason) {
        app.banner = { tone: 'error', title: 'Fichier non pris en charge', message: reason }
        return
      }
      openTab(file.name, file.path, file.content)
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
    initApp()

    // Précharge le module du copilote à l'idle : au premier clic, le composant est déjà
    // en cache et l'ouverture (montage fermé → slide) est instantanée.
    if ('requestIdleCallback' in window) requestIdleCallback(() => void loadCopilotPanel(), { timeout: 3000 })
    else setTimeout(() => void loadCopilotPanel(), 1000)

    let unlistenClose: (() => void) | null = null
    onWindowCloseRequested(async () => {
      saveSession() // flush au quit (au-delà du débounce)
      const dirty = app.tabs.filter(isDirty)
      if (dirty.length === 0) return true
      const choice = await askSave(
        'Enregistrer les modifications ?',
        dirty.length === 1
          ? `Voulez-vous enregistrer les modifications apportées à « ${dirty[0].name} » avant de quitter ?`
          : `Voulez-vous enregistrer les modifications de ${dirty.length} documents avant de quitter ?`,
      )
      if (choice === 'cancel') return false
      if (choice === 'save') {
        for (const t of dirty) if (!(await saveTab(t))) return false
      }
      return true
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
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const k = e.key.toLowerCase()
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
        app.sourceMode = !app.sourceMode
      } else if (k === 'o' && !e.shiftKey) {
        e.preventDefault()
        await openFromDialog()
      } else if (k === 'e' && e.shiftKey) {
        e.preventDefault()
        toggleSidebarView('files')
      } else if (k === 'p' && e.shiftKey) {
        e.preventDefault()
        toggleSidebarView('plan')
      } else if (k === 'h' && e.shiftKey) {
        e.preventDefault()
        toggleSidebarView('history')
      } else if (k === 'f' && e.shiftKey) {
        e.preventDefault()
        toggleSidebarView('search')
      } else if (k === 't' && e.shiftKey) {
        e.preventDefault()
        togglePin()
      }
    }

    const onWikilink = (e: Event) => {
      openWikilink((e as CustomEvent<string>).detail)
    }

    window.addEventListener('keydown', onKey)
    window.addEventListener('doku:wikilink', onWikilink)
    return () => {
      unlistenClose?.()
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
  <div class="main" class:copilot-expanded={app.copilotExpanded}>
    {#if !app.focus}<TitleBar onOpen={openFromDialog} />{/if}
    {#if !app.focus && (app.banner || app.reloadPrompt)}
      <div class="notice-stack" aria-live="polite">
        {#if app.banner}
          <div
            class="notice"
            class:error={app.banner.tone === 'error'}
            class:warning={app.banner.tone === 'warning'}
            class:success={app.banner.tone === 'success'}
            role={app.banner.tone === 'error' ? 'alert' : 'status'}
          >
            <span class="notice-icon msr" aria-hidden="true">
              {app.banner.tone === 'success' ? 'check' : app.banner.tone === 'warning' ? 'warning' : 'priority_high'}
            </span>
            <span class="notice-copy">
              <strong>{app.banner.title}</strong>
              <span>{app.banner.message}</span>
            </span>
            <button class="notice-close" onclick={() => (app.banner = null)} aria-label="Fermer la notification">
              <span class="msr" aria-hidden="true">close</span>
            </button>
          </div>
        {/if}
        {#if app.reloadPrompt}
          <div class="notice reload" role="status">
            <span class="notice-icon msr" aria-hidden="true">sync</span>
            <span class="notice-copy">
              <strong>Fichier modifié sur le disque</strong>
              <span>« {app.reloadPrompt.name} » a changé ailleurs. Le recharger remplacera vos modifications locales.</span>
            </span>
            <button class="notice-action" onclick={() => void reloadPromptedTab()}>Recharger</button>
            <button class="notice-close" onclick={dismissReloadPrompt} aria-label="Ignorer la notification">
              <span class="msr" aria-hidden="true">close</span>
            </button>
          </div>
        {/if}
      </div>
    {/if}
    <div class="stage">
      <div class="page" class:with-copilot={app.copilotOpen}>
        {#if !app.focus}
          <button
            class="collapse-btn"
            class:on={app.copilotOpen}
            title="Copilote — panneau latéral"
            aria-label="Copilote"
            aria-pressed={app.copilotOpen}
            onclick={() => {
              if (app.copilotOpen) {
                // Fermeture → réinitialise en 'chat' : la réouverture repart sur la coquille
                // sans re-solliciter le moteur (la vue Modèles seule déclenche ensureReady).
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
        <DocumentView onOpen={openFromDialog} />
      </div>
    </div>
  </div>
  {#if !app.focus && (app.copilotMounted || app.copilotOpen) && CopilotPanelComp}<CopilotPanelComp />{/if}
  {#if app.dragging}
    <div class="drop-overlay" role="presentation">
      <div class="drop-hint">
        <span class="msr" style="font-size:30px">file_download</span>
        Déposez le fichier pour l'ouvrir
      </div>
    </div>
  {/if}
</div>

<ConfirmDialog />
<WikilinkPrompt />
{#if app.settingsOpen && SettingsDialogComp}<SettingsDialogComp />{/if}

<style>
  .app {
    position: relative;
    height: 100%;
    display: flex;
    background: var(--chrome-material);
    background-color: var(--chrome-material-base);
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
      flex-grow 240ms cubic-bezier(0.4, 0, 1, 1),
      opacity 130ms ease-in;
  }
  .main.copilot-expanded { flex-grow: 0; opacity: 0; pointer-events: none; }
  .drop-overlay {
    position: absolute;
    inset: 8px;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 14px;
    border: 2px dashed var(--line-3);
    background: rgba(var(--ink-rgb), 0.06);
    backdrop-filter: blur(1px);
    pointer-events: none;
  }
  .drop-hint {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 20px 28px;
    border-radius: 12px;
    background: var(--cream-content);
    box-shadow: 0 12px 32px rgba(var(--shadow-rgb), 0.18);
    color: var(--ink-2);
    font-size: 14px;
  }
  .drop-hint > .msr { color: var(--ink-3); }
  .notice-stack {
    position: absolute;
    z-index: 30;
    top: calc(var(--chrome-titlebar-height) + 12px);
    left: 50%;
    width: min(540px, calc(100% - 32px));
    display: grid;
    gap: 8px;
    pointer-events: none;
    transform: translateX(-50%);
  }
  .notice {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 58px;
    padding: 10px 10px 10px 12px;
    border-radius: 16px;
    background: var(--cream-base);
    color: var(--ink-2);
    box-shadow:
      0 0 0 1px var(--elevation-ring),
      0 12px 32px rgba(var(--shadow-rgb), 0.22);
    animation: notice-in 180ms cubic-bezier(0.22, 1, 0.36, 1) both;
  }
  .notice-icon {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    border-radius: 11px;
    background: var(--accent-soft);
    color: var(--ink-3);
    font-size: 18px;
  }
  .notice.error .notice-icon { background: color-mix(in srgb, var(--err) 14%, transparent); color: var(--err-text); }
  .notice.warning .notice-icon { background: color-mix(in srgb, var(--warn) 16%, transparent); color: var(--warn-text); }
  .notice.success .notice-icon { background: color-mix(in srgb, var(--ok) 16%, transparent); color: var(--ok-text); }
  .notice-copy {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 2px;
    font-size: 12px;
    line-height: 1.35;
  }
  .notice-copy strong { color: var(--ink); font-size: 12.5px; font-weight: 620; }
  .notice-copy > span { color: var(--ink-3); overflow-wrap: anywhere; }
  .notice-action {
    flex: none;
    min-height: 32px;
    padding: 6px 14px;
    border-radius: 999px;
    border: 0;
    background: var(--ink);
    color: var(--cream-content);
    font: 600 12px var(--font-sans);
    cursor: pointer;
    transition: transform 100ms ease, opacity 140ms ease;
  }
  .notice-action:hover { opacity: 0.88; }
  .notice-action:active { transform: scale(0.97); }
  .notice-close {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border: 0;
    background: transparent;
    color: var(--ink-4);
    cursor: pointer;
    border-radius: 999px;
    transition: background 140ms ease, color 140ms ease, transform 100ms ease;
  }
  .notice-close .msr { font-size: 17px; }
  .notice-close:hover { background: var(--surface-hover); color: var(--ink); }
  .notice-close:active { transform: scale(0.94); }
  .notice-action:focus-visible,
  .notice-close:focus-visible { outline: 2px solid var(--line-3); outline-offset: 2px; }
  @keyframes notice-in {
    from { opacity: 0; transform: translateY(-7px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  @media (prefers-reduced-motion: reduce) {
    .notice { animation: none; }
  }
  .stage { flex: 1; min-height: 0; display: flex; background: transparent; }
  .page {
    position: relative;
    flex: 1;
    min-width: 0;
    background: var(--cream-content);
    border-radius: 14px 14px 0 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    transition: border-radius 240ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  /* Panneau copilote ouvert : la jonction document↔chat est à angle droit. */
  .page.with-copilot { border-radius: 14px 0 0 0; }
  /* Bouton d'ouverture du copilote, coin haut-droit du document (maquette w2-copilot). */
  .collapse-btn {
    position: absolute;
    top: 8px;
    right: 12px;
    z-index: 5;
    width: 32px;
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: 9px;
    background: var(--cream-base);
    color: var(--ink-2);
    box-shadow:
      0 0 0 1px var(--elevation-ring),
      0 4px 12px rgba(var(--shadow-rgb), 0.16);
    cursor: pointer;
    transition:
      background-color 140ms ease,
      color 140ms ease,
      box-shadow 140ms ease,
      transform 100ms ease;
  }
  .collapse-btn:hover,
  .collapse-btn.on {
    background: var(--cream-tint);
    color: var(--ink);
    box-shadow:
      0 0 0 1px var(--elevation-ring),
      0 5px 14px rgba(var(--shadow-rgb), 0.20);
  }
  .collapse-btn:active { transform: scale(0.96); }
  .collapse-btn:focus-visible { outline: 2px solid var(--line-3); outline-offset: 2px; }
</style>
