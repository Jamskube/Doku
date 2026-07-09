<script lang="ts">
  import { onMount } from 'svelte'
  import Sidebar from './components/Sidebar.svelte'
  import TitleBar from './components/TitleBar.svelte'
  import DocumentView from './components/DocumentView.svelte'
  import ConfirmDialog from './components/ConfirmDialog.svelte'
  import { app, activeTab, askSave, cycleTab, dialog, initApp, isDirty, openPath, openTab, openWikilink, requestCloseTab, saveSession, saveSettings, saveTab, toggleSidebarView } from './lib/stores.svelte'
  import { onOpenFile, onWindowCloseRequested, openFileDialog } from './lib/tauri'

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
      if (file) openTab(file.name, file.path, file.content)
    } catch (err) {
      // UX d'erreur complète (encodage/binaire) : story 1.2
      console.error('Ouverture du fichier échouée', err)
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

    const onKey = async (e: KeyboardEvent) => {
      if (dialog.open) return
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
    <div class="stage">
      <div class="page">
        <DocumentView onOpen={openFromDialog} />
      </div>
    </div>
  </div>
</div>

<ConfirmDialog />

<style>
  .app { height: 100%; display: flex; background: var(--cream-base); }
  .main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
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
  .banner-msg { flex: 1; min-width: 0; }
  .banner-close {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    background: transparent;
    color: var(--ink-4);
    cursor: pointer;
    border-radius: 5px;
    padding: 3px;
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
