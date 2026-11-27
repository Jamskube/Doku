<script lang="ts">
  import { onMount } from 'svelte'
  import { snapSidebarToggle } from './Sidebar.svelte'
  import {
    activeTab,
    app,
    createWorkspaceNote,
    docxActions,
    isBinaryKind,
    newWindow,
    openCopilot,
    openSettings,
    requestCloseTab,
    saveTabOrSaveAs,
    selectTab,
    setColumnWidth,
    setTheme,
    toggleActiveSourceMode,
    togglePin,
    toggleSidebarView,
    toggleWorkspaceSplit,
    workspace,
    type ColumnWidth,
    type ThemeMode,
  } from '../lib/stores.svelte'
  import { isTauri, openFolderDialog } from '../lib/tauri'
  import { tabLabel } from '../lib/tabs'
  import { closeDialog } from '../lib/dialog-close'
  import { filterCommands, groupCommands, type PaletteCommand } from '../lib/command-palette'
  import { openQuickAsk } from '../lib/quick-ask.svelte'

  let { onOpen }: { onOpen: () => void } = $props()

  let dlg = $state<HTMLDialogElement | null>(null)
  let input = $state<HTMLInputElement | null>(null)
  let query = $state('')
  let active = $state(0)
  // Lancée APRÈS la fermeture : une commande qui ouvre une autre modale (Paramètres) ne
  // doit pas se faire reprendre le focus par celle-ci quand elle finit de sortir.
  let pending: PaletteCommand | null = null

  async function saveActive() {
    const tab = activeTab()
    if (!tab) return
    if (tab.kind === 'docx') {
      if (docxActions.tabId === tab.id) await docxActions.save?.()
      return
    }
    if (!isBinaryKind(tab.kind)) await saveTabOrSaveAs(tab)
  }

  async function openFolder() {
    const dir = await openFolderDialog(app.explorerDir)
    if (!dir) return
    app.explorerDir = dir
    app.sidebarView = 'files'
    app.sidebarOpen = true
  }

  function sidebarView(view: Parameters<typeof toggleSidebarView>[0]) {
    snapSidebarToggle()
    toggleSidebarView(view)
  }

  // Icônes nommées sans tiret, invisibles au collecteur du sprite (scripts/icon-names.mjs) :
  // #i-sun #i-moon — les citer ici les garde dans src/assets/icons.svg.
  const THEME_LABELS: Record<ThemeMode, [string, string, string]> = {
    light: ['Clair', 'sun', 'light jour'],
    dark: ['Sombre', 'moon', 'dark nuit'],
    system: ['Système', 'monitor', 'system auto windows'],
  }
  const WIDTH_LABELS: Record<ColumnWidth, [string, string]> = {
    narrow: ['Étroit', 'fold-horizontal'],
    wide: ['Confortable', 'unfold-horizontal'],
    full: ['Pleine largeur', 'move-horizontal'],
  }

  // Figée à l'ouverture : la palette vit le temps d'un choix, l'état ne bouge pas sous elle.
  function buildCommands(): PaletteCommand[] {
    const tab = activeTab()
    const savable = !!tab && (tab.kind === 'docx' ? docxActions.tabId === tab.id && !!docxActions.save : !isBinaryKind(tab.kind))
    const commands: (PaletteCommand | false)[] = [
      { id: 'open', group: 'Fichier', label: 'Ouvrir un fichier…', icon: 'folder-open', kbd: 'Ctrl+O', run: onOpen },
      isTauri && { id: 'open-folder', group: 'Fichier', label: 'Ouvrir un dossier…', icon: 'folder-input', keywords: 'explorateur répertoire', run: openFolder },
      { id: 'new-note', group: 'Fichier', label: 'Nouvelle note Markdown', icon: 'file-plus', keywords: 'nouveau document créer', run: () => void createWorkspaceNote(workspace.activePaneId) },
      savable && { id: 'save', group: 'Fichier', label: 'Enregistrer', icon: 'save', kbd: 'Ctrl+S', keywords: 'sauvegarder', run: saveActive },
      !!tab && { id: 'print', group: 'Fichier', label: 'Imprimer ou exporter en PDF', icon: 'printer', kbd: 'Ctrl+P', keywords: 'export pdf', run: () => void import('../lib/export/print').then((m) => m.printDocument(tab)) },
      !!tab && { id: 'close-tab', group: 'Fichier', label: 'Fermer l’onglet', icon: 'x', kbd: 'Ctrl+W', run: () => void requestCloseTab(tab.id) },
      isTauri && { id: 'new-window', group: 'Fichier', label: 'Nouvelle fenêtre', icon: 'external-link', kbd: 'Ctrl+Maj+N', run: newWindow },

      { id: 'sidebar', group: 'Affichage', label: app.sidebarOpen ? 'Masquer la barre latérale' : 'Afficher la barre latérale', icon: 'app-window', keywords: 'panneau gauche', run: () => { app.sidebarOpen = !app.sidebarOpen } },
      { id: 'files', group: 'Affichage', label: 'Fichiers du dossier', icon: 'folder', kbd: 'Ctrl+Maj+E', keywords: 'explorateur', run: () => sidebarView('files') },
      { id: 'search', group: 'Affichage', label: 'Rechercher dans le dossier', icon: 'search', kbd: 'Ctrl+Maj+F', run: () => sidebarView('search') },
      { id: 'plan', group: 'Affichage', label: 'Plan du document', icon: 'list', kbd: 'Ctrl+Maj+P', keywords: 'titres sommaire', run: () => sidebarView('plan') },
      { id: 'history', group: 'Affichage', label: 'Historique des versions', icon: 'rotate-ccw-clock', kbd: 'Ctrl+Maj+H', run: () => sidebarView('history') },
      { id: 'copilot', group: 'Affichage', label: app.copilotOpen ? 'Fermer le copilote' : 'Ouvrir le copilote', icon: 'sparkles', keywords: 'doku-san ia chat', run: () => {
        if (!app.copilotOpen) return openCopilot()
        app.copilotOpen = false
        app.copilotView = 'chat'
        app.copilotExpanded = false
      } },
      { id: 'quick-ask', group: 'Affichage', label: 'Demander à Doku-San…', icon: 'sparkles', kbd: 'Ctrl+Espace', keywords: 'question rapide îlot ia siri', run: openQuickAsk },
      // Développement seulement : fait défiler chaque notification de l'îlot (island-demo.ts).
      import.meta.env.DEV && { id: 'island-demo', group: 'Affichage', label: 'Démo : notifications de l’îlot', icon: 'wand-sparkles', keywords: 'îlot notification test simuler', run: () => void import('../lib/island-demo').then((m) => m.runIslandDemo()) },
      { id: 'focus', group: 'Affichage', label: app.focus ? 'Quitter le mode focus' : 'Mode focus', icon: 'maximize-2', kbd: 'F9', keywords: 'zen plein écran', run: () => { app.focus = !app.focus } },
      !!tab && !isBinaryKind(tab.kind) && { id: 'source', group: 'Affichage', label: app.sourceMode ? 'Quitter le mode source' : 'Mode source', icon: 'code', kbd: 'Ctrl+/', keywords: 'markdown brut', run: toggleActiveSourceMode },
      { id: 'split', group: 'Affichage', label: workspace.split ? 'Réunir l’affichage' : 'Scinder l’affichage', icon: 'columns-2', keywords: 'deux volets côte à côte', run: toggleWorkspaceSplit },
      ...(Object.keys(WIDTH_LABELS) as ColumnWidth[])
        .filter((width) => width !== app.columnWidth)
        .map((width) => ({ id: `width-${width}`, group: 'Affichage', label: `Largeur : ${WIDTH_LABELS[width][0]}`, icon: WIDTH_LABELS[width][1], keywords: 'colonne document', run: () => setColumnWidth(width) })),
      isTauri && { id: 'pin', group: 'Affichage', label: app.pinned ? 'Ne plus garder au-dessus' : 'Toujours au-dessus', icon: 'pin', kbd: 'Ctrl+Maj+T', keywords: 'épingler', run: togglePin },

      ...(Object.keys(THEME_LABELS) as ThemeMode[])
        .filter((mode) => mode !== app.themeMode)
        .map((mode) => ({ id: `theme-${mode}`, group: 'Préférences', label: `Thème : ${THEME_LABELS[mode][0]}`, icon: THEME_LABELS[mode][1], keywords: `apparence ${THEME_LABELS[mode][2]}`, run: () => setTheme(mode) })),
      { id: 'settings', group: 'Préférences', label: 'Paramètres', icon: 'settings', keywords: 'réglages options préférences', run: () => openSettings() },
      { id: 'shortcuts', group: 'Préférences', label: 'Raccourcis clavier', icon: 'keyboard', keywords: 'touches aide', run: () => openSettings('shortcuts') },

      ...app.tabs
        .filter((other) => other.id !== app.activeId)
        .map((other) => ({ id: `tab-${other.id}`, group: 'Onglets ouverts', label: tabLabel(other), icon: 'file-text', keywords: other.path ?? '', run: () => selectTab(other.id) })),
    ]
    return commands.filter((command): command is PaletteCommand => !!command)
  }

  // Tuile teintée par groupe : le repère de couleur se lit avant le libellé (Spotlight).
  const GROUP_TINTS: Record<string, string> = { Fichier: 'slate', Affichage: 'sage', 'Préférences': 'ochre' }

  const commands = buildCommands()
  const matches = $derived(filterCommands(commands, query))
  const groups = $derived(groupCommands(matches))
  // Ordre de navigation = ordre affiché (groupes à plat), pas celui du classement brut.
  const flat = $derived(groups.flatMap((group) => group.items))
  const activeId = $derived(flat[active] ? `palette-${flat[active].id}` : undefined)

  onMount(() => {
    dlg?.showModal()
    input?.focus()
  })

  function close() {
    closeDialog(dlg)
  }

  function choose(command: PaletteCommand | undefined) {
    if (!command) return
    pending = command
    close()
  }

  function moveTo(index: number) {
    active = Math.max(0, Math.min(flat.length - 1, index))
    requestAnimationFrame(() => {
      if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' })
    })
  }

  function onKey(event: KeyboardEvent) {
    // Modale : les raccourcis de la fenêtre (Ctrl+W, F9, Échap du mode focus…) ne passent pas dessous.
    event.stopPropagation()
    const mod = event.ctrlKey || event.metaKey
    if (mod && event.shiftKey && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      close()
      return
    }
    const to = ({ ArrowDown: active + 1, ArrowUp: active - 1, PageDown: active + 8, PageUp: active - 8 } as Record<string, number>)[event.key]
    if (to !== undefined) {
      event.preventDefault()
      moveTo(to)
    } else if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault()
      choose(flat[active])
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<dialog
  bind:this={dlg}
  class="palette"
  aria-label="Palette de commandes"
  onkeydown={onKey}
  oncancel={(event) => {
    event.preventDefault()
    close()
  }}
  onclose={() => {
    app.paletteOpen = false
    const command = pending
    pending = null
    void command?.run()
  }}
  onclick={(event) => {
    if (event.target === dlg) close()
  }}
>
  <div class="shell" aria-hidden="true"></div>
  <div class="search">
    <svg class="icon" aria-hidden="true"><use href="#i-search" /></svg>
    <input
      bind:this={input}
      bind:value={query}
      oninput={() => (active = 0)}
      type="text"
      role="combobox"
      aria-expanded="true"
      aria-controls="palette-list"
      aria-autocomplete="list"
      aria-activedescendant={activeId}
      aria-label="Rechercher une commande"
      placeholder="Rechercher une commande…"
      spellcheck="false"
      autocomplete="off"
    />
  </div>
  <div class="list" id="palette-list" role="listbox" aria-label="Commandes">
    {#each groups as group (group.group)}
      <div class="group-title" id="palette-group-{group.group}" role="presentation">{group.group}</div>
      <div role="group" aria-labelledby="palette-group-{group.group}">
        {#each group.items as command (command.id)}
          {@const index = flat.indexOf(command)}
          <!-- Le clavier reste dans le champ (combobox) : flèches et Entrée y sont gérées. -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div
            class="item"
            class:active={index === active}
            id="palette-{command.id}"
            role="option"
            tabindex="-1"
            aria-selected={index === active}
            onpointermove={() => (active = index)}
            onclick={() => choose(command)}
          >
            <span class="doku-tile tint-{GROUP_TINTS[command.group] ?? 'ink'}" aria-hidden="true"><svg class="icon" aria-hidden="true"><use href="#i-{command.icon}" /></svg></span>
            <span class="label">{command.label}</span>
            {#if command.kbd}<kbd>{command.kbd}</kbd>{/if}
          </div>
        {/each}
      </div>
    {/each}
  </div>
  {#if flat.length === 0}
    <p class="empty" role="status">Aucune commande pour « {query.trim()} »</p>
  {/if}
  <footer class="hint" aria-hidden="true">
    <span><kbd>↑</kbd><kbd>↓</kbd> naviguer</span>
    <span><kbd>↵</kbd> ouvrir</span>
    <span><kbd>Échap</kbd> fermer</span>
  </footer>
</dialog>

<style>
  /* Façon Spotlight : un grand champ, des rangées à tuile teintée, un pied d'aide. */
  .palette {
    width: min(640px, calc(100vw - 32px));
    max-width: none;
    max-height: none;
    /* Tiers haut de la fenêtre : l'œil y est déjà, et la liste qui raccourcit à la frappe
       ne fait pas sauter le champ (un centrage vertical le ferait). */
    margin: max(16px, 14vh) auto auto;
    padding: 0;
    flex-direction: column;
    border: 0;
    background: transparent;
    color: var(--ink);
    font-size: var(--text-sm);
    overflow: visible;
    transform-origin: 50% 0;
  }
  /* Le verre vit sur une couche sous le contenu (la modale, position fixe, est son contexte
     d'empilement). */
  .shell {
    position: absolute;
    top: 0;
    left: 0;
    z-index: -1;
    width: 100%;
    height: 100%;
    border-radius: 22px;
    background: var(--glass-bg);
    backdrop-filter: var(--glass-filter);
    box-shadow: var(--glass-shadow);
    pointer-events: none;
  }
  /* Sur [open] seulement : un display d'auteur l'emporterait sur le masquage natif de la modale fermée. */
  .palette[open] { display: flex; }
  .palette::backdrop {
    background: var(--scrim);
    animation: doku-fade-in 150ms var(--ease-enter-snappy);
  }
  .palette[open] { animation: doku-pop-in var(--duration-moderate) var(--ease-enter-snappy); }

  .search {
    flex: 0 0 auto;
    height: 52px;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 18px;
    border-bottom: 1px solid var(--line-1);
  }
  .search > .icon { flex: none; font-size: 20px; color: var(--ink-4); }
  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--ink);
    font: inherit;
    font-size: 17px;
    letter-spacing: -0.01em;
  }
  .search input::placeholder { color: var(--ink-4); }

  .list {
    max-height: min(360px, max(120px, 70vh - 120px));
    padding: 6px 8px 8px;
    overflow-y: auto;
    scrollbar-width: none;
    /* Le titre de groupe reste visible au-dessus d'une rangée atteinte au clavier. */
    scroll-padding-block: 32px 8px;
    display: flex;
    flex-direction: column;
  }
  .group-title {
    padding: 10px 10px 4px;
    color: var(--section-label);
    font-size: var(--text-2xs);
    font-weight: var(--weight-strong);
  }
  [role='group'] { display: flex; flex-direction: column; gap: 1px; }
  .item {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 40px;
    padding: 0 10px 0 8px;
    border-radius: 10px;
    color: var(--ink-2);
    font-size: var(--text-md);
    cursor: pointer;
  }
  .item .doku-tile { --tile-size: 26px; border-radius: 7px; font-size: 14px; }
  .item.active { background: var(--menu-row-hover); color: var(--ink); }
  .label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .item > kbd {
    flex: none;
    color: var(--ink-4);
    font: var(--weight-regular) var(--text-xs) var(--font-sans);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .empty {
    margin: 0;
    padding: 20px 16px 24px;
    text-align: center;
    color: var(--ink-3);
    font-size: var(--text-sm);
  }
  .hint {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 16px;
    height: 34px;
    padding: 0 18px;
    border-top: 1px solid var(--line-1);
    color: var(--ink-4);
    font-size: var(--text-2xs);
  }
  .hint span { display: inline-flex; align-items: center; gap: 4px; }
  .hint kbd {
    min-width: 18px;
    height: 18px;
    display: inline-grid;
    place-items: center;
    padding: 0 4px;
    border-radius: 5px;
    background: rgba(var(--ink-rgb), 0.07);
    color: var(--ink-3);
    font: var(--weight-control) 10.5px var(--font-sans);
  }
  :global(:where(:root[data-input='touch'])) .item { min-height: 44px; }
  :global(:where(:root[data-input='touch'])) .hint { display: none; }
</style>
