<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { app, activeTab, applyColumnWidth, requestCloseTab, isDirty, saveTab, toggleTheme, togglePin, type ColumnWidth, type DocKind } from '../lib/stores.svelte'
  import { tabDiscriminator } from '../lib/tabs'
  import { parentPath } from '../lib/explorer'
  import { exportViaPrint } from '../lib/export/print'
  import { exportStandaloneHtml } from '../lib/export/standalone'
  import { closeWindow, minimizeWindow, readImageDataUrl, saveDocxDialog, saveHtmlDialog, toggleMaximizeWindow } from '../lib/tauri'
  import DokuMark from '../lib/DokuMark.svelte'

  let { onOpen }: { onOpen: () => void } = $props()

  let railHover = $state(false)
  let menuOpen = $state(false)
  let submenu = $state<'export' | 'width' | null>(null)
  let menuRootEl: HTMLElement | undefined = $state()
  let menuTriggerEl: HTMLButtonElement | undefined = $state()
  let mainMenuEl: HTMLElement | undefined = $state()
  let exportMenuEl: HTMLElement | undefined = $state()
  let widthMenuEl: HTMLElement | undefined = $state()
  let exportTriggerEl: HTMLButtonElement | undefined = $state()
  let widthTriggerEl: HTMLButtonElement | undefined = $state()
  const showLogo = $derived(!app.sidebarOpen && !railHover)
  const canExport = $derived(activeTab()?.kind !== 'pdf' && !!activeTab())

  type ExportTab = { kind: DocKind; name: string; content: string; path: string | null }

  function closeMenus(restoreFocus = false) {
    menuOpen = false
    submenu = null
    if (restoreFocus) void tick().then(() => menuTriggerEl?.focus())
  }

  function toggleMenu() {
    menuOpen = !menuOpen
    submenu = null
  }

  function runMenuAction(action: () => void | Promise<void>) {
    closeMenus()
    void action()
  }

  async function saveActive() {
    const tab = activeTab()
    if (tab && tab.kind !== 'pdf') await saveTab(tab)
  }

  function exportHtml(tab: ExportTab) {
    if (tab.kind === 'pdf') return
    exportStandaloneHtml(
      { kind: tab.kind, name: tab.name, content: tab.content, dir: parentPath(tab.path ?? null) ?? '' },
      { readImageDataUrl, save: saveHtmlDialog },
    ).catch((err) => console.error('Export HTML échoué', err))
  }

  function exportDocx(tab: ExportTab) {
    if (tab.kind === 'pdf') return
    const doc = { kind: tab.kind, name: tab.name, content: tab.content }
    import('../lib/export/docx')
      .then((m) => m.exportDocx(doc, { save: saveDocxDialog }))
      .catch((err) => console.error('Export DOCX échoué', err))
  }

  function exportPrint(tab: ExportTab) {
    if (tab.kind === 'pdf') return
    exportViaPrint({ kind: tab.kind, name: tab.name, content: tab.content, dir: parentPath(tab.path ?? null) ?? '' })
  }

  function exportActive(format: 'docx' | 'html' | 'pdf') {
    const tab = activeTab()
    if (!tab || tab.kind === 'pdf') return
    closeMenus()
    if (format === 'docx') exportDocx(tab)
    else if (format === 'html') exportHtml(tab)
    else exportPrint(tab)
  }

  function setColumnWidth(width: ColumnWidth) {
    app.columnWidth = width
    applyColumnWidth()
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
    submenu = name
    if (!focusFirst) return
    await tick()
    const menu = name === 'export' ? exportMenuEl : widthMenuEl
    if (menu) directMenuItems(menu)[0]?.focus()
  }

  async function openMenuFromKeyboard(event: KeyboardEvent) {
    if (!['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) return
    event.preventDefault()
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
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && menuOpen) closeMenus()
    }
    const onWindowChange = () => closeMenus()
    window.addEventListener('blur', onWindowChange)
    window.addEventListener('resize', onWindowChange)
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('blur', onWindowChange)
      window.removeEventListener('resize', onWindowChange)
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  })
</script>

<div class="titlebar">
  <div class="rail-zone">
    <button
      class="rail-btn"
      class:lit={app.sidebarOpen || railHover}
      title={app.sidebarOpen ? 'Replier la barre latérale' : 'Déplier la barre latérale'}
      aria-label={app.sidebarOpen ? 'Replier la barre latérale' : 'Déplier la barre latérale'}
      aria-pressed={app.sidebarOpen}
      onmouseenter={() => (railHover = true)}
      onmouseleave={() => (railHover = false)}
      onclick={() => (app.sidebarOpen = !app.sidebarOpen)}
    >
      <span class="layer" style:opacity={showLogo ? 1 : 0}>
        <DokuMark size={22} />
      </span>
      <span class="layer" style:opacity={showLogo ? 0 : 1}>
        <svg width="20" height="20" viewBox="-0.5 -0.5 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5.625 2.1875v10.625M1.875 5.875c0 -1.4 0 -2.1 0.2725 -2.635a2.5 2.5 0 0 1 1.0925 -1.0925C3.775 1.875 4.475 1.875 5.875 1.875h3.25c1.4 0 2.1 0 2.635 0.2725a2.5 2.5 0 0 1 1.0925 1.0925C13.125 3.775 13.125 4.475 13.125 5.875v3.25c0 1.4 0 2.1 -0.2725 2.635a2.5 2.5 0 0 1 -1.0925 1.0925C11.225 13.125 10.525 13.125 9.125 13.125H5.875c-1.4 0 -2.1 0 -2.635 -0.2725a2.5 2.5 0 0 1 -1.0925 -1.0925C1.875 11.225 1.875 10.525 1.875 9.125z" />
        </svg>
      </span>
    </button>
  </div>

  <div class="tabs" data-tauri-drag-region>
    {#each app.tabs as tab (tab.id)}
      {@const parent = tabDiscriminator(tab, app.tabs)}
      <button
        class="tab"
        class:active={tab.id === app.activeId}
        role="tab"
        aria-selected={tab.id === app.activeId}
        title={(tab.path ?? tab.name) + (isDirty(tab) ? ' — non enregistré' : '')}
        onclick={() => (app.activeId = tab.id)}
        onauxclick={(e) => { if (e.button === 1) requestCloseTab(tab.id) }}
      >
        {#if isDirty(tab)}<span class="dot">●</span>{/if}
        <span class="name">{tab.name}</span>
        {#if parent}<span class="parent">{parent}</span>{/if}
        <span
          class="close"
          title="Fermer l'onglet"
          role="button"
          tabindex="-1"
          onclick={(e) => { e.stopPropagation(); requestCloseTab(tab.id) }}
          onkeydown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); requestCloseTab(tab.id) } }}
        >
          <span class="msr" style="font-size:16px">close</span>
        </span>
      </button>
    {/each}
    <button class="new-tab" title="Nouvel onglet (Ctrl+O)" aria-label="Nouvel onglet" onclick={onOpen}>
      <span class="msr" style="font-size:20px">add</span>
    </button>
  </div>

  <div class="document-menu-root" bind:this={menuRootEl}>
    <button
      class="document-menu-trigger"
      class:open={menuOpen}
      bind:this={menuTriggerEl}
      title="Options du document"
      aria-label="Options du document"
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      onclick={toggleMenu}
      onkeydown={openMenuFromKeyboard}
    >
      <span class="msr" aria-hidden="true">more_horiz</span>
    </button>

    {#if menuOpen}
      <div class="app-menu document-menu" role="menu" tabindex="-1" aria-label="Options du document" bind:this={mainMenuEl} onkeydown={handleMainMenuKeydown}>
        <button
          class="app-menu-item"
          role="menuitem"
          disabled={!activeTab() || activeTab()?.kind === 'pdf' || !isDirty(activeTab()!)}
          onmouseenter={() => (submenu = null)}
          onclick={() => runMenuAction(saveActive)}
        >
          <span class="msr">save</span><span class="menu-label">Enregistrer</span><kbd>Ctrl+S</kbd>
        </button>

        <div class="submenu-root" role="none" onmouseenter={() => { if (canExport) submenu = 'export' }}>
          <button
            class="app-menu-item"
            class:open={submenu === 'export'}
            bind:this={exportTriggerEl}
            data-submenu="export"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={submenu === 'export'}
            disabled={!canExport}
            onclick={() => { if (canExport) submenu = submenu === 'export' ? null : 'export' }}
          >
            <span class="msr">ios_share</span><span class="menu-label">Exporter</span><span class="msr menu-chevron">chevron_left</span>
          </button>
          {#if submenu === 'export' && canExport}
            <div class="app-menu flyout-menu" role="menu" tabindex="-1" aria-label="Exporter" bind:this={exportMenuEl} onkeydown={(event) => handleSubmenuKeydown(event, 'export')}>
              <button class="app-menu-item" role="menuitem" onclick={() => exportActive('docx')}>
                <span class="msr">description</span><span class="menu-label">Document Word</span><span class="menu-format">.docx</span>
              </button>
              <button class="app-menu-item" role="menuitem" onclick={() => exportActive('html')}>
                <span class="msr">html</span><span class="menu-label">Page web autonome</span><span class="menu-format">.html</span>
              </button>
              <button class="app-menu-item" role="menuitem" onclick={() => exportActive('pdf')}>
                <span class="msr">picture_as_pdf</span><span class="menu-label">Document PDF</span><span class="menu-format">.pdf</span>
              </button>
            </div>
          {/if}
        </div>

        <div class="app-menu-sep"></div>

        <button
          class="app-menu-item"
          role="menuitemcheckbox"
          aria-checked={app.sourceMode}
          disabled={!activeTab() || activeTab()?.kind === 'pdf'}
          onmouseenter={() => (submenu = null)}
          onclick={() => runMenuAction(() => { app.sourceMode = !app.sourceMode })}
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

        <div class="submenu-root" role="none" onmouseenter={() => (submenu = 'width')}>
          <button
            class="app-menu-item"
            class:open={submenu === 'width'}
            bind:this={widthTriggerEl}
            data-submenu="width"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={submenu === 'width'}
            onclick={() => (submenu = submenu === 'width' ? null : 'width')}
          >
            <span class="msr">view_column</span><span class="menu-label">Largeur du document</span><span class="msr menu-chevron">chevron_left</span>
          </button>
          {#if submenu === 'width'}
            <div class="app-menu flyout-menu width-menu" role="menu" tabindex="-1" aria-label="Largeur du document" bind:this={widthMenuEl} onkeydown={(event) => handleSubmenuKeydown(event, 'width')}>
              <button class="app-menu-item" role="menuitemradio" aria-checked={app.columnWidth === 'narrow'} onclick={() => setColumnWidth('narrow')}>
                <span class="menu-check">{app.columnWidth === 'narrow' ? '✓' : ''}</span><span class="msr">width_normal</span><span class="menu-label">Étroit</span>
              </button>
              <button class="app-menu-item" role="menuitemradio" aria-checked={app.columnWidth === 'wide'} onclick={() => setColumnWidth('wide')}>
                <span class="menu-check">{app.columnWidth === 'wide' ? '✓' : ''}</span><span class="msr">width_wide</span><span class="menu-label">Confortable</span>
              </button>
              <button class="app-menu-item" role="menuitemradio" aria-checked={app.columnWidth === 'full'} onclick={() => setColumnWidth('full')}>
                <span class="menu-check">{app.columnWidth === 'full' ? '✓' : ''}</span><span class="msr">width_full</span><span class="menu-label">Pleine largeur</span>
              </button>
            </div>
          {/if}
        </div>
      </div>
    {/if}
  </div>

  <div class="win-controls">
    <button class="ctrl pin" class:on={app.pinned} title="Toujours au-dessus (Ctrl+Maj+T)" aria-label="Toujours au-dessus" aria-pressed={app.pinned} onclick={togglePin}>
      <span class="msr" style="font-size:19px">keep</span>
    </button>
    <button class="ctrl" title="Thème sombre" aria-label="Thème sombre" aria-pressed={app.theme === 'dark'} onclick={toggleTheme}>
      <span class="msr" style="font-size:18px">{app.theme === 'dark' ? 'light_mode' : 'dark_mode'}</span>
    </button>
    {#if !app.copilotOpen}
      <!-- Panneau copilote ouvert → ces contrôles migrent dans son en-tête (maquette w2). -->
      <div class="sep"></div>
      <button class="ctrl wide" title="Réduire" aria-label="Réduire" onclick={minimizeWindow}>
        <span class="msr" style="font-size:18px">remove</span>
      </button>
      <button class="ctrl wide" title="Agrandir" aria-label="Agrandir" onclick={toggleMaximizeWindow}>
        <span class="msr" style="font-size:15px">crop_square</span>
      </button>
      <button class="ctrl wide close-win" title="Fermer" aria-label="Fermer" onclick={closeWindow}>
        <span class="msr" style="font-size:18px">close</span>
      </button>
    {/if}
  </div>
</div>

<style>
  .titlebar {
    position: relative;
    z-index: 20;
    display: flex;
    align-items: stretch;
    padding-left: 4px;
    height: 40px;
    flex-shrink: 0;
    background: var(--cream-base);
    user-select: none;
  }

  .rail-zone { display: flex; align-items: center; flex-shrink: 0; }
  .rail-btn {
    position: relative;
    width: 40px;
    height: 32px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--ink-3);
    cursor: pointer;
    transition: color 140ms ease, background 140ms ease;
  }
  .rail-btn.lit { background: var(--surface-hover); color: var(--ink); }
  .rail-btn .layer {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: opacity 140ms ease;
    pointer-events: none;
  }

  .document-menu-root {
    position: relative;
    display: flex;
    align-items: center;
    flex: 0 0 40px;
  }
  .document-menu-trigger {
    width: 40px;
    height: 40px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--ink-3);
    cursor: pointer;
    transition: background 140ms ease, color 140ms ease;
  }
  .document-menu-trigger > .msr { font-size: 20px; }
  .document-menu-trigger:hover,
  .document-menu-trigger.open { background: var(--surface-hover); color: var(--ink); }
  .document-menu-trigger:focus-visible { outline: 2px solid var(--line-3); outline-offset: -3px; }

  .app-menu {
    position: absolute;
    top: 38px;
    z-index: 40;
    width: 244px;
    padding: 6px;
    border-radius: 13px;
    background: var(--cream-tint);
    box-shadow:
      0 0 0 1px var(--elevation-ring),
      0 12px 30px rgba(var(--shadow-rgb), 0.18);
    animation: app-menu-in 150ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  .document-menu { right: 0; transform-origin: top right; }
  .submenu-root { position: relative; }
  .flyout-menu {
    top: -6px;
    right: calc(100% + 7px);
    width: 236px;
    transform-origin: top right;
  }
  .width-menu { width: 220px; }
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
  .app-menu-item {
    width: 100%;
    height: 40px;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 0 9px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--ink-2);
    font-family: var(--font-sans);
    font-size: 12.5px;
    text-align: left;
    cursor: pointer;
    transition: background 130ms ease, color 130ms ease, scale 100ms ease;
  }
  .app-menu-item > .msr { width: 18px; flex: 0 0 auto; font-size: 17px; color: var(--ink-4); }
  .app-menu-item:hover,
  .app-menu-item.open { background: var(--surface-hover); color: var(--ink); }
  .app-menu-item:hover > .msr { color: var(--ink-2); }
  .app-menu-item:focus-visible { outline: 2px solid var(--line-3); outline-offset: -2px; }
  .app-menu-item:active:not(:disabled) { scale: 0.96; }
  .app-menu-item:disabled { opacity: 0.38; cursor: default; }
  .menu-label { flex: 1; min-width: 0; white-space: nowrap; }
  .app-menu-item kbd,
  .menu-format {
    margin-left: auto;
    color: var(--ink-5);
    font-family: var(--font-sans);
    font-size: 10px;
    font-weight: 400;
  }
  .menu-chevron { width: 15px !important; font-size: 16px !important; }
  .menu-check {
    width: 16px;
    flex: 0 0 auto;
    color: var(--ink-2);
    font-size: 12px;
    font-weight: 600;
    text-align: center;
  }
  .app-menu-sep { height: 1px; margin: 5px 7px; background: var(--line-1); }
  @keyframes app-menu-in {
    from { opacity: 0; transform: translateY(-3px) scale(0.985); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  @media (prefers-reduced-motion: reduce) {
    .app-menu { animation: none; }
  }

  .tabs {
    flex: 1;
    display: flex;
    align-items: flex-end;
    gap: 3px;
    padding: 0 4px;
    min-width: 0;
  }

  .tab {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 0 8px 0 13px;
    height: 34px;
    min-width: 0;
    border: 1px solid transparent;
    border-bottom-width: 0;
    border-radius: 10px 10px 0 0;
    background: transparent;
    color: var(--ink-4);
    font-size: 12.5px;
    cursor: pointer;
    transition: background 140ms ease, color 140ms ease;
  }
  .tab:hover { background: var(--surface-hover); color: var(--ink-2); }
  .tab.active {
    background: var(--cream-content);
    color: var(--ink);
    font-weight: 500;
    z-index: 2;
  }
  .tab.active:hover { background: var(--cream-content); }
  .tab.active::before,
  .tab.active::after {
    content: '';
    position: absolute;
    bottom: 0;
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

  .dot { font-size: 9px; color: var(--ink); line-height: 1; margin-right: 1px; }
  .name { min-width: 0; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .parent {
    flex-shrink: 3;
    min-width: 0;
    max-width: 90px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 10.5px;
    color: var(--ink-4);
  }
  .parent::before { content: '·'; margin-right: 4px; opacity: 0.55; }
  .close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    margin-right: -4px;
    border-radius: 6px;
    color: var(--ink-4);
    opacity: 0.45;
    transition: opacity 120ms ease, background 120ms ease, color 120ms ease;
  }
  .tab.active .close { opacity: 0.9; }
  .close:hover { background: var(--surface-hover); color: var(--ink); }

  .new-tab {
    width: 32px;
    height: 33px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 0;
    border-radius: 8px;
    color: var(--ink-4);
    cursor: pointer;
    transition: color 140ms ease, background 140ms ease;
  }
  .new-tab:hover { background: var(--surface-hover); color: var(--ink); }

  .win-controls { display: flex; align-items: center; gap: 2px; padding-right: 2px; flex-shrink: 0; }
  .ctrl {
    width: 36px;
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 0;
    border-radius: 6px;
    color: var(--ink-3);
    cursor: pointer;
    transition: color 140ms ease, background 140ms ease, transform 100ms ease;
  }
  .ctrl:hover { background: var(--surface-hover); color: var(--ink); }
  .ctrl:active { background: var(--accent-soft); transform: translateY(1px); }
  .ctrl:focus-visible { outline: 1px solid var(--line-3); outline-offset: -2px; background: var(--surface-hover); }
  .ctrl.wide { width: 40px; border-radius: 7px; }
  .ctrl.pin.on { background: var(--accent-soft); color: var(--ink); }
  .close-win:hover { background: var(--window-close); color: #fff; }
  .close-win:active { background: var(--window-close-active); color: #fff; }
  .sep { width: 1px; height: 16px; background: var(--line-2); margin: 0 6px; }
</style>
