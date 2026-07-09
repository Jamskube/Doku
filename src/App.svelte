<script lang="ts">
  import { onMount } from 'svelte'
  import Sidebar from './components/Sidebar.svelte'
  import TitleBar from './components/TitleBar.svelte'
  import DocumentView from './components/DocumentView.svelte'
  import ConfirmDialog from './components/ConfirmDialog.svelte'
  import { app, activeTab, askSave, cycleTab, dialog, initApp, isDirty, openTab, requestCloseTab, saveTab, toggleSidebarView } from './lib/stores.svelte'
  import { onWindowCloseRequested, openFileDialog } from './lib/tauri'

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

    const onKey = async (e: KeyboardEvent) => {
      if (dialog.open) return
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
      const target = (e as CustomEvent<string>).detail
      const existing = app.tabs.find((t) => t.name.replace(/\.(md|markdown)$/i, '') === target)
      if (existing) app.activeId = existing.id
    }

    window.addEventListener('keydown', onKey)
    window.addEventListener('doku:wikilink', onWikilink)
    return () => {
      unlistenClose?.()
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('doku:wikilink', onWikilink)
    }
  })
</script>

<div class="app">
  <Sidebar />
  <div class="main">
    <TitleBar onOpen={openFromDialog} />
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
