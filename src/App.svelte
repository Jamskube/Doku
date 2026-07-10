<script lang="ts">
  import { onMount } from 'svelte'
  import Sidebar from './components/Sidebar.svelte'
  import TitleBar from './components/TitleBar.svelte'
  import DocumentView from './components/DocumentView.svelte'
  import ConfirmDialog from './components/ConfirmDialog.svelte'
  import WikilinkPrompt from './components/WikilinkPrompt.svelte'
  import { app, activeTab, askSave, checkExternalChanges, cycleTab, dialog, dismissReloadPrompt, initApp, isDirty, openDropped, openPath, openTab, openWikilink, reloadPromptedTab, requestCloseTab, saveSession, saveSettings, saveTab, togglePin, toggleSidebarView } from './lib/stores.svelte'
  import { onFileDrop, onOpenFile, onWindowCloseRequested, onWindowFocus, openFileDialog } from './lib/tauri'
  import { detectUnsupported } from './lib/encoding'

  // Persiste les préférences (thème, état sidebar) à chaque changement — les lectures
  // de app.* dans saveSettings sont suivies par l'effet.
  $effect(() => {
    saveSettings()
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
        app.banner = reason
        return
      }
      openTab(file.name, file.path, file.content)
    } catch (err) {
      console.error('Ouverture du fichier échouée', err)
      app.banner = "Impossible d'ouvrir le fichier (erreur de lecture ou d'encodage)."
    }
  }

  onMount(() => {
    initApp()

    let unlistenClose: (() => void) | null = null
    onWindowCloseRequested(async () => {
      saveSession() // flush au quit (au-delà du débounce)
      const dirty = app.tabs.filter(isDirty)
      if (dirty.length === 0) return true
      const choice = await askSave(
        'Modifications non enregistrées',
        dirty.length === 1
          ? `« ${dirty[0].name} » contient des modifications non enregistrées.`
          : `${dirty.length} documents contiennent des modifications non enregistrées.`,
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
  <div class="main">
    {#if !app.focus}<TitleBar onOpen={openFromDialog} />{/if}
    {#if app.banner && !app.focus}
      <div class="banner" role="status">
        <span class="msr" style="font-size:18px">error</span>
        <span class="banner-msg">{app.banner}</span>
        <button class="banner-close" onclick={() => (app.banner = null)} aria-label="Fermer">
          <span class="msr" style="font-size:16px">close</span>
        </button>
      </div>
    {/if}
    {#if app.reloadPrompt && !app.focus}
      <div class="banner reload" role="status">
        <span class="msr" style="font-size:18px">sync</span>
        <span class="banner-msg">« {app.reloadPrompt.name} » a été modifié en dehors de Doku. Vos modifications locales seront perdues au rechargement.</span>
        <button class="banner-action" onclick={() => void reloadPromptedTab()}>Recharger</button>
        <button class="banner-close" onclick={dismissReloadPrompt} aria-label="Ignorer">
          <span class="msr" style="font-size:16px">close</span>
        </button>
      </div>
    {/if}
    <div class="stage">
      <div class="page">
        <DocumentView onOpen={openFromDialog} />
      </div>
    </div>
  </div>
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

<style>
  .app { position: relative; height: 100%; display: flex; background: var(--cream-base); }
  .main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
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
    box-shadow: 0 12px 32px rgba(var(--ink-rgb), 0.18);
    color: var(--ink-2);
    font-size: 14px;
  }
  .drop-hint > .msr { color: var(--ink-3); }
  .banner {
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 16px;
    background: rgba(var(--ink-rgb), 0.04);
    border-bottom: 1px solid var(--line-2);
    color: var(--ink-2);
    font-size: 12.5px;
  }
  .banner > .msr { color: var(--warn); flex: none; }
  .banner.reload > .msr { color: var(--ink-3); }
  .banner-msg { flex: 1; min-width: 0; }
  .banner-action {
    flex: none;
    min-height: 24px;
    padding: 4px 12px;
    border-radius: 7px;
    border: 1px solid var(--line-2);
    background: var(--ink);
    color: var(--cream-content);
    font-size: 12px;
    cursor: pointer;
    transition: background 140ms ease;
  }
  .banner-action:hover { background: var(--ink-2); }
  .banner-close {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: 0;
    background: transparent;
    color: var(--ink-4);
    cursor: pointer;
    border-radius: 5px;
  }
  .banner-close:hover { background: var(--surface-hover); color: var(--ink); }
  .stage { flex: 1; min-height: 0; display: flex; background: var(--cream-base); }
  .page {
    flex: 1;
    min-width: 0;
    background: var(--cream-content);
    border-radius: 14px 14px 0 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
</style>
