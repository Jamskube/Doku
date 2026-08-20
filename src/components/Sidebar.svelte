<script lang="ts">
  import { app, activeTab, collapseExplorer, docHeadings, isDirty, loadSnapshotsForActive, openPath, openSearchHit, openSettings, refreshExplorer, restoreSnapshot, runSearch, scrollToLine, setExplorerSort, toggleExplorerExpanded, toggleSidebarView } from '../lib/stores.svelte'
  import { flattenTree, joinPath, nameExists, normalizeNewName, parentPath, pathCrumbs, reachableExpanded, type FsEntry, type SortKey, type TreeRow } from '../lib/explorer'
  import { createDirAt, createFileAt, isTauri, openFolderDialog, readDirectory } from '../lib/tauri'
  import { DEMO_DIR } from '../lib/demo'
  import DokuMark from '../lib/DokuMark.svelte'
  import CopilotConversationList from './CopilotConversationList.svelte'
  import { untrack } from 'svelte'

  // Plan : titres du Markdown seulement (un .txt/.html n'en a pas), et pas pour un
  // gros fichier (docHeadings O(doc) + DOM de milliers de titres gèlerait — 1.6).
  // docHeadings est mémoïsé côté store : la frappe ne re-scanne pas le document.
  const headings = $derived(
    activeTab()?.kind === 'md' && !activeTab()!.heavy ? docHeadings(activeTab()!.content) : [],
  )

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

  // --- Menu d'en-tête (actions rares + tri) ---
  let headerMenu = $state(false)
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

<aside
  class="sidebar"
  class:open={app.sidebarOpen}
  class:covered={app.copilotExpanded}
  aria-hidden={app.copilotExpanded || !app.sidebarOpen}
  inert={app.copilotExpanded}
>
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
      <button class="rib" class:active={app.sidebarView === 'discussions' && app.sidebarOpen} title="Discussions Doku-San" aria-label="Discussions Doku-San" onclick={() => toggleSidebarView('discussions')}>
        <span class="msr" style="font-size:21px">chat_bubble</span>
      </button>

      <div class="spacer"></div>

      <button class="rib" class:active={app.settingsOpen} title="Paramètres" aria-label="Paramètres" onclick={() => openSettings()}>
        <span class="msr" style="font-size:21px">settings</span>
      </button>
    </div>

    <div class="panel">
      {#if app.sidebarView === 'discussions'}
        <CopilotConversationList />
      {:else}
      <div class="panel-head">
        {#if app.sidebarView === 'files'}
          <span class="panel-title">Fichiers</span>
          <!-- Hiérarchie de fréquence : créer (2 boutons) reste visible, le reste
               (ouvrir un dossier, suivre le doc, tout replier, trier) vit dans UN menu. -->
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
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) headerMenu = false
              }}
            >
              <button
                class:active={headerMenu}
                title="Plus d’options"
                aria-label="Plus d’options"
                aria-haspopup="menu"
                aria-expanded={headerMenu}
                onclick={() => (headerMenu = !headerMenu)}
              ><span class="msr" style="font-size:19px">more_horiz</span></button>
              {#if headerMenu}
                <div class="sort-menu" role="menu" tabindex="-1" onkeydown={(e) => { if (e.key === 'Escape') headerMenu = false }}>
                  <button role="menuitem" disabled={!isTauri} onclick={() => { headerMenu = false; void chooseFolder() }}>
                    <span class="tick msr">folder_open</span>
                    <span class="grow">Ouvrir un dossier…</span>
                  </button>
                  <button
                    role="menuitem"
                    disabled={!activeDocumentDir || activeDocumentDir === targetDir}
                    onclick={() => { headerMenu = false; followActiveDocument() }}
                  >
                    <span class="tick msr">my_location</span>
                    <span class="grow">Aller au document actif</span>
                  </button>
                  <button
                    role="menuitem"
                    disabled={!hasExpanded}
                    onclick={() => { headerMenu = false; if (targetDir) collapseExplorer(targetDir) }}
                  >
                    <span class="tick msr">unfold_less</span>
                    <span class="grow">Tout replier</span>
                  </button>
                  <div class="menu-sep" role="separator"></div>
                  <span class="menu-head">Trier par</span>
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

      {#if app.sidebarView === 'files' && targetDir}
        <div class="explorer-nav">
          <div class="nav-controls">
            <button class="nav-btn" title="Précédent" aria-label="Dossier précédent" disabled={navigationIndex <= 0} onclick={navigateBack}>
              <span class="msr">arrow_back</span>
            </button>
            <button class="nav-btn" title="Suivant" aria-label="Dossier suivant" disabled={navigationIndex >= navigationHistory.length - 1} onclick={navigateForward}>
              <span class="msr">arrow_forward</span>
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
              {#if index > 0}<span class="msr crumb-separator" aria-hidden="true">chevron_right</span>{/if}
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
            {#each treeRows as row (row.path)}
              {@const open = tabsByPath.get(row.path)}
              {@const expanded = row.entry.isDir && expandedSet.has(row.path)}
              <button
                class="row"
                class:current={!row.entry.isDir && activePath === row.path}
                title={row.path}
                aria-expanded={row.entry.isDir ? expanded : undefined}
                style={`padding-left: ${10 + row.depth * 16}px`}
                onclick={() => onRowClick(row)}
                ondblclick={() => onRowDblClick(row)}
              >
                {#if row.entry.isDir}
                  <span class="msr twist" class:open={expanded} aria-hidden="true">chevron_right</span>
                  <span class="msr fold">{expanded ? 'folder_open' : 'folder'}</span>
                {:else}
                  <span class="twist-spacer" aria-hidden="true"></span>
                  <span class="msr fold">description</span>
                {/if}
                <span class="label grow" class:strong={row.entry.isDir}>{row.entry.name}</span>
                {#if open && isDirty(open)}<span class="filedot">●</span>{/if}
              </button>
            {:else}
              <p class="empty">Dossier vide</p>
            {/each}
          {:else}
            <div class="folder-empty">
              <span class="msr" aria-hidden="true">folder_open</span>
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
              oninput={(e) => onSearchInput(e.currentTarget.value)}
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
      {/if}
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
    /* Même tempo que le panneau copilote (.cop-panel) : les deux rideaux latéraux
       doivent respirer à la même vitesse. */
    transition: width 300ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  .sidebar.open:not(.covered) { width: 296px; }
  @media (prefers-reduced-motion: reduce) {
    .sidebar { transition-duration: 0.01ms; }
  }
  /* contain : le contenu (largeur figée) est isolé des invalidations externes — la
     transition de width de .sidebar ne re-layoute plus l'arbre entier à chaque frame. */
  .inner { width: 296px; height: 100%; display: flex; contain: layout paint; }

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
  .panel-head { height: 43px; flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 0 8px 0 12px; }
  .panel-title { min-width: 0; font-size: 12.5px; font-weight: 600; color: var(--ink-2); }
  .actions { display: flex; align-items: center; gap: 1px; }
  .actions button {
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 0;
    border-radius: 7px;
    color: var(--ink-4);
    cursor: pointer;
  }
  .actions button:hover:not(:disabled) { background: var(--surface-hover); color: var(--ink); }
  .actions button:disabled { opacity: 0.35; cursor: default; }
  .actions button.active { background: var(--surface-hover); color: var(--ink); }

  .explorer-nav {
    height: 39px;
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 8px;
    border-bottom: 1px solid var(--line-1);
  }
  .nav-controls {
    display: flex;
    align-items: center;
    gap: 1px;
    flex: 0 0 auto;
    padding: 2px;
    border-radius: 9px;
    background: var(--surface-hover);
  }
  .nav-btn {
    width: 25px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--ink-3);
    cursor: pointer;
    transition: background-color 140ms ease, color 140ms ease, transform 100ms ease;
  }
  .nav-btn .msr { font-size: 17px; }
  .nav-btn:hover:not(:disabled) { background: var(--surface-hover); color: var(--ink); }
  .nav-btn:active:not(:disabled) { transform: scale(0.96); }
  .nav-btn:disabled { opacity: 0.28; cursor: default; }
  .breadcrumbs {
    min-width: 0;
    flex: 1;
    display: flex;
    align-items: center;
    overflow-x: auto;
    height: 30px;
    padding: 2px 4px;
    border-radius: 9px;
    background: var(--surface-hover);
    scrollbar-width: none;
    overscroll-behavior-x: contain;
    /* Tactile : défilement horizontal natif ; le drag souris est géré en JS. */
    touch-action: pan-x;
  }
  .breadcrumbs::-webkit-scrollbar { display: none; }
  /* Fondus aux bords : signalent le chemin masqué (la scrollbar est cachée). */
  .breadcrumbs.fade-left {
    -webkit-mask-image: linear-gradient(90deg, transparent, #000 22px);
    mask-image: linear-gradient(90deg, transparent, #000 22px);
  }
  .breadcrumbs.fade-right {
    -webkit-mask-image: linear-gradient(270deg, transparent, #000 22px);
    mask-image: linear-gradient(270deg, transparent, #000 22px);
  }
  .breadcrumbs.fade-left.fade-right {
    -webkit-mask-image: linear-gradient(90deg, transparent, #000 22px, #000 calc(100% - 22px), transparent);
    mask-image: linear-gradient(90deg, transparent, #000 22px, #000 calc(100% - 22px), transparent);
  }
  .breadcrumbs button {
    max-width: 86px;
    height: 26px;
    flex: 0 0 auto;
    padding: 0 5px;
    overflow: hidden;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--ink-4);
    font: inherit;
    font-size: 11.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }
  .breadcrumbs button:hover:not(:disabled) { background: var(--surface-hover); color: var(--ink); }
  .breadcrumbs button.current { max-width: 120px; color: var(--ink-2); font-weight: 600; opacity: 1; cursor: default; }
  .crumb-separator { flex: 0 0 auto; font-size: 14px; color: var(--ink-5); }

  /* Menu de tri : ancré sous le bouton, aligné à droite pour ne pas déborder du panneau. */
  .sort-wrap { position: relative; display: inline-flex; }
  /* Même matériau que .app-menu (TitleBar) : sans bordure — fond cream-tint,
     anneau d'élévation + ombre portée, rayon 13px, entrée animée. Si l'un change,
     changer l'autre. */
  .sort-menu {
    position: absolute;
    top: 34px;
    right: 0;
    z-index: 40;
    min-width: 224px;
    padding: 6px;
    border-radius: 13px;
    background: var(--cream-tint);
    box-shadow:
      0 0 0 1px var(--elevation-ring),
      0 12px 30px rgba(var(--shadow-rgb), 0.18);
    animation: sidebar-menu-in 150ms cubic-bezier(0.22, 1, 0.36, 1);
    transform-origin: top right;
  }
  .sort-menu button {
    width: 100%;
    height: 36px;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 0 9px;
    background: transparent;
    border: 0;
    border-radius: 7px;
    color: var(--ink-2);
    font-family: var(--font-sans);
    font-size: 12.5px;
    text-align: left;
    cursor: pointer;
    transition: background 130ms ease, color 130ms ease, scale 100ms ease;
  }
  .sort-menu button:hover:not(:disabled) { background: var(--surface-hover); color: var(--ink); }
  .sort-menu button:hover:not(:disabled) .tick { color: var(--ink-2); }
  .sort-menu button:active:not(:disabled) { scale: 0.96; }
  .sort-menu button:focus-visible { outline: 2px solid var(--line-3); outline-offset: -2px; }
  .sort-menu button:disabled { opacity: 0.38; cursor: default; }
  .sort-menu button.on { color: var(--ink); font-weight: 500; }
  .sort-menu .tick { font-size: 17px; width: 18px; flex: 0 0 auto; color: var(--ink-4); }
  .sort-menu .grow { flex: 1; min-width: 0; white-space: nowrap; }
  .sort-menu .arrow { font-size: 15px; color: var(--ink-4); }
  .menu-sep { height: 1px; margin: 5px 7px; background: var(--line-1); }
  /* Intitulé de section du menu — libellé, pas action : non focusable, teinte retirée. */
  .menu-head { display: block; padding: 6px 9px 3px; font-size: 10.5px; font-weight: 550; color: var(--ink-4); }
  @keyframes sidebar-menu-in {
    from { opacity: 0; transform: translateY(-3px) scale(0.985); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  @media (prefers-reduced-motion: reduce) {
    .sort-menu { animation: none; }
  }

  /* Saisie du nom en place : mêmes métriques qu'une .row pour ne pas faire sauter la liste. */
  .newrow { display: flex; align-items: center; gap: 5px; height: 28px; padding: 0 6px; }
  .newname {
    flex: 1;
    min-width: 0;
    height: 22px;
    padding: 0 6px;
    background: var(--cream-content);
    border: 0;
    border-radius: 5px;
    color: var(--ink);
    font: inherit;
    font-size: 13px;
  }
  .newname:focus { outline: 2px solid var(--line-3); outline-offset: 1px; }
  .newerr { margin: 2px 6px 4px 30px; font-size: 11.5px; color: var(--err-text); line-height: 1.35; }

  .panel-body { flex: 1; overflow-y: auto; min-height: 0; padding: 5px 8px 16px; contain: layout paint; }

  .row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 5px;
    height: 30px;
    padding: 0 6px;
    background: transparent;
    border: 0;
    border-radius: 7px;
    cursor: pointer;
    color: var(--ink-2);
    text-align: left;
  }
  .row:hover { background: var(--surface-hover); color: var(--ink); }
  .row.current { background: var(--accent-soft); color: var(--ink); }
  .row.current .label { font-weight: 500; }
  .fold { font-size: 19px; color: var(--ink-4); }
  .label { font-size: 13px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .label.strong { font-weight: 500; }
  .label.grow { flex: 1; }
  .filedot { font-size: 8px; color: var(--ink); flex-shrink: 0; }
  /* Chevron de dépliage : pivote à 90° quand le dossier est ouvert. */
  .twist {
    flex: 0 0 auto;
    font-size: 16px;
    color: var(--ink-5);
    transition: transform 140ms ease;
  }
  .twist.open { transform: rotate(90deg); }
  /* Aligne les fichiers sur les libellés des dossiers (largeur du chevron + gap). */
  .twist-spacer { flex: 0 0 16px; }
  @media (prefers-reduced-motion: reduce) {
    .twist { transition: none; }
  }

  .folder-empty {
    min-height: 220px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 24px 16px;
    text-align: center;
  }
  .folder-empty > .msr { margin-bottom: 9px; font-size: 27px; color: var(--ink-4); }
  .folder-empty strong { font-size: 12.5px; color: var(--ink-2); }
  .folder-empty p { max-width: 22ch; margin: 5px 0 13px; font-size: 11.5px; line-height: 1.45; color: var(--ink-4); text-wrap: pretty; }
  .folder-empty button {
    min-height: 32px;
    padding: 0 14px;
    border: 0;
    border-radius: 999px;
    background: var(--ink);
    color: var(--cream-content);
    font: inherit;
    font-size: 11.5px;
    font-weight: 600;
    cursor: pointer;
  }
  .folder-empty button:hover:not(:disabled) { background: var(--ink-2); }
  .folder-empty button:disabled { opacity: 0.4; cursor: default; }
  .actions button:focus-visible,
  .nav-btn:focus-visible,
  .breadcrumbs button:focus-visible,
  .row:focus-visible,
  .folder-empty button:focus-visible {
    outline: 2px solid var(--line-3);
    outline-offset: 1px;
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
    border: 0;
    border-radius: 8px;
    background: var(--cream-content);
    color: var(--ink);
    font-size: 13px;
    outline: none;
  }
  .search-input:focus { outline: 2px solid var(--line-3); outline-offset: -2px; }
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
