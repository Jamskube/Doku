<script lang="ts">
  import { app, activeTab, docHeadings, isDirty, loadSnapshotsForActive, openPath, openSearchHit, openSettings, refreshExplorer, restoreSnapshot, runSearch, scrollToLine, setExplorerSort, toggleSidebarView } from '../lib/stores.svelte'
  import { baseName, joinPath, nameExists, normalizeNewName, parentPath, visibleEntries, type FsEntry, type SortKey } from '../lib/explorer'
  import { createDirAt, createFileAt, isTauri, readDirectory } from '../lib/tauri'
  import { DEMO_DIR } from '../lib/demo'
  import DokuMark from '../lib/DokuMark.svelte'

  // Plan : titres du Markdown seulement (un .txt/.html n'en a pas), et pas pour un
  // gros fichier (docHeadings O(doc) + DOM de milliers de titres gèlerait — 1.6).
  const headings = $derived(
    activeTab()?.kind === 'md' && !activeTab()!.heavy ? docHeadings(activeTab()!.content) : [],
  )

  // Dossier explorateur : navigation explicite, sinon dossier du document actif.
  const targetDir = $derived(app.explorerDir ?? parentPath(activeTab()?.path ?? null))
  let entries = $state<FsEntry[]>([])

  $effect(() => {
    const dir = targetDir
    const sort = app.explorerSort
    void app.explorerNonce // dépendance explicite : rejoue après une création
    if (!dir) {
      entries = []
      return
    }
    let cancelled = false
    ;(async () => {
      // Le stat par entrée n'est payé que si l'on trie effectivement par date.
      const raw = isTauri ? await readDirectory(dir, sort.key === 'modified') : DEMO_DIR
      if (!cancelled) entries = visibleEntries(raw, sort)
    })()
    return () => {
      cancelled = true
    }
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

  // --- Menu de tri ---
  let sortMenu = $state(false)
  const SORT_LABELS: Record<SortKey, string> = { name: 'Nom', modified: 'Modifié le', type: 'Type' }
  const SORT_KEYS: SortKey[] = ['name', 'modified', 'type']

  function chooseSort(key: SortKey) {
    setExplorerSort(key)
    sortMenu = false
  }

  function openEntry(entry: FsEntry) {
    if (!targetDir) return
    const full = joinPath(targetDir, entry.name)
    if (entry.isDir) app.explorerDir = full
    else openPath(full)
  }

  // Charge l'historique du fichier actif quand le panneau est ouvert ; recharge au
  // changement d'onglet (dépendance activeTab().id). Les saves rafraîchissent via saveTab.
  $effect(() => {
    if (app.sidebarView === 'history' && app.sidebarOpen) {
      void activeTab()?.id
      void loadSnapshotsForActive()
    }
  })

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

</script>

<aside class="sidebar" class:open={app.sidebarOpen}>
  <div class="inner">
    <div class="ribbon">
      <button class="logo" title="À propos de Doku" aria-label="À propos de Doku" onclick={() => openSettings('about')}>
        <DokuMark size={26} />
      </button>
      <div class="divider"></div>

      <button class="rib" class:active={app.sidebarView === 'files' && app.sidebarOpen} title="Fichiers" aria-label="Fichiers" onclick={() => toggleSidebarView('files')}>
        <span class="msr" style="font-size:21px">folder_open</span>
      </button>
      <button class="rib" class:active={app.sidebarView === 'search' && app.sidebarOpen} title="Rechercher dans le dossier (Ctrl+Maj+F)" aria-label="Rechercher" onclick={() => toggleSidebarView('search')}>
        <span class="msr" style="font-size:21px">search</span>
      </button>
      <button class="rib" class:active={app.sidebarView === 'plan' && app.sidebarOpen} title="Plan du document" aria-label="Plan" onclick={() => toggleSidebarView('plan')}>
        <span class="msr" style="font-size:21px">format_list_bulleted</span>
      </button>
      <button class="rib" class:active={app.sidebarView === 'history' && app.sidebarOpen} title="Historique des versions" aria-label="Historique" onclick={() => toggleSidebarView('history')}>
        <span class="msr" style="font-size:21px">history</span>
      </button>

      <div class="spacer"></div>

      <button class="rib" class:active={app.settingsOpen} title="Paramètres" aria-label="Paramètres" onclick={() => openSettings()}>
        <span class="msr" style="font-size:21px">settings</span>
      </button>
    </div>

    <div class="panel">
      <div class="panel-head">
        {#if app.sidebarView === 'files'}
          <div class="actions">
            <button
              title={canCreate ? 'Nouvelle note' : createHint}
              aria-label="Nouvelle note"
              disabled={!canCreate}
              onclick={() => startCreate('file')}
            ><span class="msr" style="font-size:19px">edit_square</span></button>
            <button
              title={canCreate ? 'Nouveau dossier' : createHint}
              aria-label="Nouveau dossier"
              disabled={!canCreate}
              onclick={() => startCreate('dir')}
            ><span class="msr" style="font-size:19px">create_new_folder</span></button>
            <div
              class="sort-wrap"
              onfocusout={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) sortMenu = false
              }}
            >
              <button
                class:active={sortMenu}
                title="Trier ({SORT_LABELS[app.explorerSort.key]})"
                aria-label="Trier"
                aria-haspopup="menu"
                aria-expanded={sortMenu}
                onclick={() => (sortMenu = !sortMenu)}
              ><span class="msr" style="font-size:19px">sort</span></button>
              {#if sortMenu}
                <div class="sort-menu" role="menu" tabindex="-1" onkeydown={(e) => { if (e.key === 'Escape') sortMenu = false }}>
                  {#each SORT_KEYS as key (key)}
                    <button role="menuitem" class:on={app.explorerSort.key === key} onclick={() => chooseSort(key)}>
                      <span class="tick msr">{app.explorerSort.key === key ? 'check' : ''}</span>
                      <span class="grow">{SORT_LABELS[key]}</span>
                      {#if app.explorerSort.key === key}
                        <span class="msr arrow">{app.explorerSort.order === 'asc' ? 'arrow_upward' : 'arrow_downward'}</span>
                      {/if}
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          </div>
        {/if}
      </div>

      <div class="panel-body">
        {#if app.sidebarView === 'files'}
          {#if targetDir}
            <div class="crumb">{baseName(targetDir)}</div>
            {#if parentPath(targetDir)}
              <button class="row up" onclick={() => (app.explorerDir = parentPath(targetDir))}>
                <span class="msr fold">drive_folder_upload</span>
                <span class="label">..</span>
              </button>
            {/if}
            {#if creating}
              <div class="newrow">
                <span class="msr fold">{creating === 'dir' ? 'create_new_folder' : 'description'}</span>
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
            {#each entries as entry (entry.name)}
              {@const full = joinPath(targetDir, entry.name)}
              {@const open = app.tabs.find((t) => t.path === full)}
              <button
                class="row"
                class:current={!entry.isDir && activeTab()?.path === full}
                title={entry.name}
                onclick={() => openEntry(entry)}
              >
                <span class="msr fold">{entry.isDir ? 'folder' : 'description'}</span>
                <span class="label grow" class:strong={entry.isDir}>{entry.name}</span>
                {#if open && isDirty(open)}<span class="filedot">●</span>{/if}
              </button>
            {:else}
              <p class="empty">Dossier vide</p>
            {/each}
          {:else}
            <p class="empty">Ouvrez un fichier pour explorer son dossier</p>
          {/if}
        {:else if app.sidebarView === 'plan'}
          <div class="plan">
            {#each headings as h (h.line)}
              {#if h.level === 1}
                <button class="plan-h1" class:active={h.line === app.activeHeadingLine} onclick={() => scrollToLine(h.line)}>{h.text}</button>
              {:else}
                <button class="plan-sub" class:active={h.line === app.activeHeadingLine} onclick={() => scrollToLine(h.line)}>{h.text}</button>
              {/if}
            {:else}
              <p class="empty">Pas de titres dans ce document</p>
            {/each}
          </div>
        {:else if app.sidebarView === 'search'}
          <div class="search">
            <input
              class="search-input"
              type="text"
              placeholder="Rechercher dans le dossier…"
              aria-label="Rechercher dans le dossier"
              value={app.searchQuery}
              bind:this={searchInput}
              oninput={(e) => runSearch(e.currentTarget.value)}
            />
            {#if !app.searchQuery.trim()}
              <p class="empty">Tapez pour chercher dans le dossier et ses sous-dossiers.</p>
            {:else if app.searchResults.length}
              {#each app.searchResults as result (result.path)}
                <div class="result">
                  <button
                    class="result-file"
                    title={result.path}
                    onclick={() => (result.hits[0] ? openSearchHit(result.path, result.hits[0].line, result.hits[0].col, result.hits[0].length) : openPath(result.path))}
                  >
                    <span class="msr fold">description</span>
                    <span class="label grow">{result.name}</span>
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
            {:else if !app.searching}
              <p class="empty">Aucun résultat.</p>
            {/if}
          </div>
        {:else}
          <div class="history">
            {#if !activeTab()?.path}
              <p class="empty">Enregistrez le document pour créer un historique.</p>
            {:else if app.snapshotsFor !== activeTab()?.id}
              <!-- chargement en cours -->
            {:else if app.snapshots.length === 0}
              <p class="empty">Aucune version enregistrée pour l'instant.</p>
            {:else}
              {#each app.snapshots as snap (snap.name)}
                <button class="snap" title="Restaurer cette version" onclick={() => restoreSnapshot(snap.name)}>
                  <span class="snap-date">{formatSnapshotDate(snap.time)}</span>
                  {#if snap.preview}<span class="snap-preview">{snap.preview}</span>{/if}
                </button>
              {/each}
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </div>
</aside>

<style>
  .sidebar {
    flex: 0 0 auto;
    width: 0;
    overflow: hidden;
    background: transparent;
    -webkit-backdrop-filter: blur(24px) saturate(145%);
    backdrop-filter: blur(24px) saturate(145%);
    box-shadow: inset 0 1px 0 var(--chrome-material-filet);
    transition: width 220ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  .sidebar.open { width: 296px; }
  .inner { width: 296px; height: 100%; display: flex; }

  .ribbon {
    flex: 0 0 46px;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0 0 12px;
    gap: 2px;
  }
  .logo {
    width: 38px;
    height: 40px;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 0;
    border-radius: 10px;
    cursor: pointer;
    color: var(--ink);
    margin-bottom: 6px;
  }
  .divider { width: 22px; height: 1px; background: var(--line-2); margin: 0 0 6px; }
  .rib {
    width: 38px;
    height: 38px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 0;
    border-radius: 10px;
    cursor: pointer;
    color: var(--ink-3);
    transition: color 140ms ease, background 140ms ease;
  }
  .rib:hover { background: var(--surface-hover); color: var(--ink); }
  .rib.active { background: var(--accent-soft); color: var(--ink); }
  .spacer { flex: 1; }

  .panel { flex: 1; min-width: 0; display: flex; flex-direction: column; border-left: 1px solid var(--chrome-material-divider); }
  .panel-head { height: 41px; flex-shrink: 0; display: flex; align-items: center; justify-content: flex-end; padding: 0 8px 0 14px; }
  .actions { display: flex; align-items: center; gap: 1px; }
  .actions button {
    width: 26px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 0;
    border-radius: 6px;
    color: var(--ink-4);
    cursor: pointer;
  }
  .actions button:hover:not(:disabled) { background: var(--surface-hover); color: var(--ink); }
  .actions button:disabled { opacity: 0.35; cursor: default; }
  .actions button.active { background: var(--surface-hover); color: var(--ink); }

  /* Menu de tri : ancré sous le bouton, aligné à droite pour ne pas déborder du panneau. */
  .sort-wrap { position: relative; display: inline-flex; }
  .sort-menu {
    position: absolute;
    top: 30px;
    right: 0;
    z-index: 20;
    min-width: 168px;
    padding: 4px;
    background: var(--surface);
    border: 1px solid var(--line-2);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.14);
  }
  .sort-menu button {
    width: 100%;
    height: 28px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 6px;
    background: transparent;
    border: 0;
    border-radius: 6px;
    color: var(--ink-2);
    font-size: 13px;
    text-align: left;
    cursor: pointer;
  }
  .sort-menu button:hover { background: var(--surface-hover); color: var(--ink); }
  .sort-menu button.on { color: var(--ink); font-weight: 500; }
  .sort-menu .tick { font-size: 15px; width: 15px; flex-shrink: 0; }
  .sort-menu .grow { flex: 1; }
  .sort-menu .arrow { font-size: 15px; color: var(--ink-4); }

  /* Saisie du nom en place : mêmes métriques qu'une .row pour ne pas faire sauter la liste. */
  .newrow { display: flex; align-items: center; gap: 5px; height: 28px; padding: 0 6px; }
  .newname {
    flex: 1;
    min-width: 0;
    height: 22px;
    padding: 0 6px;
    background: var(--surface);
    border: 1px solid var(--accent, var(--line-3));
    border-radius: 5px;
    color: var(--ink);
    font: inherit;
    font-size: 13px;
  }
  .newname:focus { outline: 2px solid var(--line-3); outline-offset: 1px; }
  .newerr { margin: 2px 6px 4px 30px; font-size: 11.5px; color: var(--danger, #b4442f); line-height: 1.35; }

  .panel-body { flex: 1; overflow-y: auto; min-height: 0; padding: 4px 8px 16px; }

  .row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 5px;
    height: 28px;
    padding: 0 6px;
    background: transparent;
    border: 0;
    border-radius: 6px;
    cursor: pointer;
    color: var(--ink-2);
    text-align: left;
  }
  .row:hover { background: var(--surface-hover); color: var(--ink); }
  .row.current { background: var(--accent-soft); color: var(--ink); }
  .row.current .label { font-weight: 500; }
  .row.up { color: var(--ink-4); }
  .fold { font-size: 19px; color: var(--ink-4); }
  .label { font-size: 13px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .label.strong { font-weight: 500; }
  .label.grow { flex: 1; }
  .filedot { font-size: 8px; color: var(--ink); flex-shrink: 0; }
  .crumb {
    font-size: 11px;
    color: var(--ink-4);
    font-weight: 500;
    padding: 2px 8px 6px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .plan { padding-top: 4px; }
  .plan-h1 {
    width: 100%;
    display: block;
    text-align: left;
    padding: 7px 12px;
    background: transparent;
    border: 0;
    border-left: 2px solid transparent;
    border-radius: 0 8px 8px 0;
    cursor: pointer;
    color: var(--ink);
    font-size: 13px;
    font-weight: 600;
  }
  .plan-h1.active { background: var(--accent-soft); border-left-color: var(--ink); }
  .plan-h1:hover { background: var(--accent-soft); }
  .plan-sub {
    width: 100%;
    display: block;
    text-align: left;
    padding: 6px 12px 6px 26px;
    background: transparent;
    border: 0;
    border-radius: 8px;
    cursor: pointer;
    color: var(--ink-3);
    font-size: 12.5px;
    margin-top: 2px;
  }
  .plan-sub:hover { background: var(--surface-hover); color: var(--ink); }
  .plan-sub.active { background: var(--accent-soft); color: var(--ink); }
  .empty { font-size: 12px; color: var(--ink-4); padding: 8px 12px; }

  .history { padding-top: 2px; }
  .snap {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    padding: 7px 12px;
    border: 0;
    background: transparent;
    border-radius: 8px;
    cursor: pointer;
    text-align: left;
  }
  .snap:hover { background: var(--surface-hover); }
  .snap-date { font-size: 12px; color: var(--ink-2); font-weight: 500; }
  .snap-preview {
    font-size: 11.5px;
    color: var(--ink-4);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .search { padding-top: 2px; }
  .search-input {
    width: 100%;
    height: 30px;
    margin-bottom: 8px;
    padding: 0 10px;
    border: 1px solid var(--line-2);
    border-radius: 8px;
    background: var(--cream-content);
    color: var(--ink);
    font-size: 13px;
    outline: none;
  }
  .search-input:focus { border-color: var(--line-3); }
  .result { margin-bottom: 6px; }
  .result-file {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 5px;
    height: 26px;
    padding: 0 6px;
    background: transparent;
    border: 0;
    border-radius: 6px;
    cursor: pointer;
    color: var(--ink-2);
    text-align: left;
  }
  .result-file:hover { background: var(--surface-hover); color: var(--ink); }
  .count { font-size: 11px; color: var(--ink-4); flex-shrink: 0; }
  .hit {
    width: 100%;
    display: flex;
    gap: 8px;
    padding: 4px 8px 4px 26px;
    background: transparent;
    border: 0;
    border-radius: 6px;
    cursor: pointer;
    text-align: left;
    color: var(--ink-3);
  }
  .hit:hover { background: var(--surface-hover); }
  .hit-line { font-size: 11px; color: var(--ink-4); flex-shrink: 0; min-width: 20px; }
  .hit-text {
    font-size: 12px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hl { background: var(--accent-soft); color: var(--ink); border-radius: 2px; padding: 0 1px; }
</style>
