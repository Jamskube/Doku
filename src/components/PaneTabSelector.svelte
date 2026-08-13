<script lang="ts">
  import { onMount, tick } from 'svelte'
  import {
    activatePane,
    app,
    assignTabToPane,
    createWorkspaceNote,
    isDirty,
    requestCloseTab,
    swapPanes,
    workspace,
  } from '../lib/stores.svelte'
  import { tabDiscriminator } from '../lib/tabs'
  import { otherPane, type PaneId } from '../lib/workspace'

  let {
    paneId,
    onOpen,
    local = false,
  }: {
    paneId: PaneId
    onOpen: () => void
    local?: boolean
  } = $props()

  let open = $state(false)
  let root: HTMLElement | undefined = $state()
  let trigger: HTMLButtonElement | undefined = $state()
  let menu: HTMLElement | undefined = $state()

  const tabId = $derived(workspace[paneId].tabId)
  const tab = $derived(app.tabs.find((item) => item.id === tabId))
  const active = $derived(workspace.activePaneId === paneId)

  function menuItems(): HTMLButtonElement[] {
    return Array.from(menu?.querySelectorAll<HTMLButtonElement>('.menu-item:not(:disabled)') ?? [])
  }

  function close(restoreFocus = false) {
    open = false
    if (restoreFocus) void tick().then(() => trigger?.focus())
  }

  async function toggle(focusFirst = false) {
    activatePane(paneId)
    open = !open
    if (open && focusFirst) {
      await tick()
      menuItems()[0]?.focus()
    }
  }

  function pick(candidateId: number) {
    if (assignTabToPane(paneId, candidateId)) close(true)
  }

  function onMenuKeydown(event: KeyboardEvent) {
    const items = menuItems()
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const direction = event.key === 'ArrowDown' ? 1 : -1
      items[(index + direction + items.length) % items.length]?.focus()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close(true)
    } else if (event.key === 'Tab') {
      close()
    }
  }

  onMount(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!root?.contains(event.target as Node | null)) close()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && open) close(true)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  })
</script>

<div class="selector" class:local class:active data-tauri-drag-region bind:this={root}>
  <button
    class="trigger"
    class:open
    class:empty={!tab}
    bind:this={trigger}
    title={tab?.path ?? tab?.name ?? 'Choisir un document'}
    aria-haspopup="menu"
    aria-expanded={open}
    aria-label={`${tab?.name ?? 'Choisir un document'} — ${app.tabs.length} onglets ouverts`}
    onclick={() => void toggle()}
    onkeydown={(event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        void toggle(true)
      }
    }}
  >
    {#if tab && isDirty(tab)}<span class="dirty-dot">●</span>{/if}
    <span class="name">{tab?.name ?? 'Choisir un document'}</span>
    {#if app.tabs.length > 1}<span class="count">+{app.tabs.length - 1}</span>{/if}
    <span class="msr chevron" aria-hidden="true">expand_more</span>
  </button>

  {#if active}
    <button class="add" title="Ouvrir un document (Ctrl+O)" aria-label="Ouvrir un document" onclick={onOpen}>
      <span class="msr" aria-hidden="true">add</span>
    </button>
  {/if}

  {#if open}
    <div class="menu" role="menu" tabindex="-1" aria-label="Documents du volet" bind:this={menu} onkeydown={onMenuKeydown}>
      {#each app.tabs as candidate (candidate.id)}
        {@const shownElsewhere = workspace[otherPane(paneId)].tabId === candidate.id}
        {@const parent = tabDiscriminator(candidate, app.tabs)}
        <div class="menu-row" role="none">
          <button
            class="menu-item"
            role="menuitemradio"
            aria-checked={workspace[paneId].tabId === candidate.id}
            disabled={shownElsewhere}
            title={shownElsewhere ? 'Déjà affiché dans l’autre volet' : candidate.path ?? candidate.name}
            onclick={() => pick(candidate.id)}
          >
            <span class="state-dot" class:dirty={isDirty(candidate)} class:current={workspace[paneId].tabId === candidate.id}></span>
            <span class="menu-label">{candidate.name}</span>
            {#if parent}<span class="parent">{parent}</span>{/if}
          </button>
          <button class="close" title={`Fermer ${candidate.name}`} aria-label={`Fermer ${candidate.name}`} onclick={() => requestCloseTab(candidate.id)}>
            <span class="msr" aria-hidden="true">close</span>
          </button>
        </div>
      {/each}
      <div class="separator"></div>
      <button class="menu-item" role="menuitem" onclick={() => { createWorkspaceNote(paneId); close() }}>
        <span class="msr">add</span><span class="menu-label">Nouvelle note Markdown</span>
      </button>
      <button class="menu-item" role="menuitem" onclick={() => { activatePane(paneId); close(); onOpen() }}>
        <span class="msr">folder_open</span><span class="menu-label">Ouvrir un autre fichier…</span>
      </button>
      <button class="menu-item" role="menuitem" onclick={() => { swapPanes(); close() }}>
        <span class="msr">swap_vert</span><span class="menu-label">Permuter les volets</span>
      </button>
    </div>
  {/if}
</div>

<style>
  .selector {
    position: relative;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 3px;
  }
  .selector.local {
    z-index: 3;
    flex: 0 0 38px;
    padding: 0 8px;
    background: var(--chrome-material);
    box-shadow: inset 0 1px 0 var(--chrome-material-filet);
  }
  .trigger {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 32px;
    min-width: 0;
    max-width: 100%;
    flex: 0 1 auto;
    padding: 0 8px 0 13px;
    border: 1px solid transparent;
    border-bottom-width: 0;
    border-radius: 10px 10px 0 0;
    background: var(--cream-content);
    box-shadow: 0 4px 0 var(--cream-content);
    color: var(--ink);
    font: 500 12.5px var(--font-sans);
    cursor: pointer;
  }
  .trigger.empty { color: var(--ink-4); font-weight: 450; }
  .trigger:focus-visible,
  .add:focus-visible,
  .menu-item:focus-visible,
  .close:focus-visible { outline: 1px solid var(--line-3); outline-offset: -2px; }
  .dirty-dot { flex: 0 0 auto; margin-right: 1px; color: var(--ink); font-size: 9px; line-height: 1; }
  .name { min-width: 0; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .count {
    flex: 0 0 auto;
    color: var(--ink-4);
    font: 500 10.5px var(--font-mono);
  }
  .chevron { flex: 0 0 auto; color: var(--ink-4); font-size: 16px; transition: transform 140ms ease; }
  .trigger.open .chevron { transform: rotate(180deg); }
  .add {
    width: 32px;
    height: 32px;
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--ink-4);
    cursor: pointer;
  }
  .add > .msr { font-size: 20px; }
  .add:hover { background: var(--surface-hover); color: var(--ink); }
  .menu {
    position: absolute;
    z-index: 40;
    top: 38px;
    left: 0;
    width: min(264px, calc(100% - 8px));
    max-height: min(52vh, 420px);
    overflow: auto;
    padding: 6px;
    border-radius: 13px;
    background: var(--cream-tint);
    box-shadow: 0 0 0 1px var(--elevation-ring), 0 12px 30px rgba(var(--shadow-rgb), 0.18);
    transform-origin: top left;
    animation: menu-in 150ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  .selector.local .menu { top: 36px; left: 8px; width: min(264px, calc(100% - 16px)); }
  .menu-row { display: flex; align-items: center; gap: 2px; }
  .menu-item {
    width: 100%;
    height: 36px;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 0 9px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--ink-2);
    font: 400 12.5px var(--font-sans);
    text-align: left;
    cursor: pointer;
  }
  .menu-row .menu-item { flex: 1; }
  .menu-item[aria-checked='true'] { background: var(--accent-soft); color: var(--ink); }
  .menu-item:hover { background: var(--surface-hover); color: var(--ink); }
  .menu-item:disabled { opacity: 0.38; cursor: default; }
  .menu-item > .msr { width: 18px; flex: 0 0 auto; color: var(--ink-4); font-size: 17px; }
  .menu-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .state-dot { width: 8px; height: 8px; flex: 0 0 auto; border-radius: 50%; }
  .state-dot.current { border: 1.5px solid var(--line-3); }
  .state-dot.dirty { border: 0; background: var(--ink); }
  .parent {
    max-width: 90px;
    min-width: 0;
    flex-shrink: 3;
    overflow: hidden;
    color: var(--ink-4);
    font-size: 10.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .parent::before { content: '·'; margin-right: 4px; opacity: 0.55; }
  .close {
    width: 26px;
    height: 26px;
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--ink-4);
    cursor: pointer;
  }
  .close > .msr { font-size: 15px; }
  .close:hover { background: var(--surface-hover); color: var(--err); }
  .separator { height: 1px; margin: 5px 7px; background: var(--line-1); }
  @keyframes menu-in {
    from { opacity: 0; transform: translateY(-3px) scale(0.985); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  @media (prefers-reduced-motion: reduce) {
    .menu { animation: none; }
    .chevron { transition: none; }
  }
</style>
