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
  let positioned = $state(false)
  let opensAbove = $state(false)

  const MENU_WIDTH = 264
  const MENU_MAX_HEIGHT = 420
  const MENU_MARGIN = 8
  const MENU_GAP = 4

  const tabId = $derived(workspace[paneId].tabId)
  const tab = $derived(app.tabs.find((item) => item.id === tabId))
  function menuItems(): HTMLButtonElement[] {
    return Array.from(menu?.querySelectorAll<HTMLButtonElement>('.menu-item:not(:disabled)') ?? [])
  }

  function close(restoreFocus = false) {
    if (menu?.matches(':popover-open')) menu.hidePopover()
    open = false
    positioned = false
    if (restoreFocus) void tick().then(() => trigger?.focus())
  }

  function positionMenu() {
    if (!menu || !trigger) return

    const anchor = trigger.getBoundingClientRect()
    const viewportWidth = document.documentElement.clientWidth
    const viewportHeight = document.documentElement.clientHeight
    const width = Math.min(MENU_WIDTH, viewportWidth - MENU_MARGIN * 2)
    const roomBelow = viewportHeight - anchor.bottom - MENU_MARGIN - MENU_GAP
    const roomAbove = anchor.top - MENU_MARGIN - MENU_GAP

    opensAbove = roomBelow < MENU_MAX_HEIGHT && roomAbove > roomBelow
    const availableHeight = Math.max(120, opensAbove ? roomAbove : roomBelow)
    const maxHeight = Math.min(MENU_MAX_HEIGHT, availableHeight, viewportHeight - MENU_MARGIN * 2)
    const left = Math.min(
      Math.max(anchor.left, MENU_MARGIN),
      viewportWidth - width - MENU_MARGIN,
    )

    menu.style.setProperty('--menu-left', `${Math.round(left)}px`)
    menu.style.setProperty('--menu-width', `${Math.round(width)}px`)
    menu.style.setProperty('--menu-max-height', `${Math.round(maxHeight)}px`)
    menu.style.setProperty('--menu-enter-y', opensAbove ? '3px' : '-3px')
    menu.style.setProperty('--menu-origin-y', opensAbove ? 'bottom' : 'top')

    const height = menu.getBoundingClientRect().height
    const top = opensAbove
      ? anchor.top - MENU_GAP - height
      : anchor.bottom + MENU_GAP
    menu.style.setProperty(
      '--menu-top',
      `${Math.round(Math.min(Math.max(top, MENU_MARGIN), viewportHeight - height - MENU_MARGIN))}px`,
    )
    positioned = true
  }

  async function toggle(focusFirst = false) {
    activatePane(paneId)
    if (open) {
      close()
      return
    }

    open = true
    positioned = false
    await tick()
    menu?.showPopover()
    positionMenu()
    if (focusFirst) menuItems()[0]?.focus()
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
    window.addEventListener('resize', positionMenu)

    const observer = new ResizeObserver(() => {
      if (open) positionMenu()
    })
    if (root?.parentElement) observer.observe(root.parentElement)

    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', positionMenu)
      observer.disconnect()
    }
  })
</script>

<div class="selector" class:local data-tauri-drag-region bind:this={root}>
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

  {#if open}
    <div
      class="menu"
      class:positioned
      class:above={opensAbove}
      popover="manual"
      role="menu"
      tabindex="-1"
      aria-label="Documents du volet"
      bind:this={menu}
      onkeydown={onMenuKeydown}
    >
      <div class="menu-documents">
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
      </div>
      <div class="menu-actions">
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
    flex: 0 0 42px;
    padding: 6px 8px 4px;
    background: var(--cream-content);
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
  .selector.local .trigger {
    height: 32px;
    padding: 0 8px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    box-shadow: none;
  }
  .selector.local .trigger:hover,
  .selector.local .trigger.open { background: var(--surface-hover); }
  .selector.local .trigger:focus-visible {
    outline: 0;
    background: var(--surface-hover);
  }
  .trigger:focus-visible,
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
  .menu {
    position: fixed;
    z-index: 40;
    inset: auto;
    top: var(--menu-top);
    left: var(--menu-left);
    width: var(--menu-width, 264px);
    max-width: calc(100vw - 16px);
    max-height: var(--menu-max-height, 420px);
    margin: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: 0;
    border: 0;
    border-radius: 13px;
    background: var(--cream-tint);
    box-shadow: 0 0 0 1px var(--elevation-ring), 0 12px 30px rgba(var(--shadow-rgb), 0.18);
    transform-origin: left var(--menu-origin-y, top);
    animation: menu-in 150ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  .menu:not(.positioned) { visibility: hidden; animation: none; }
  .menu-documents {
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    padding: 6px 6px 2px;
  }
  .menu-actions {
    flex: 0 0 auto;
    padding: 0 6px 6px;
    background: var(--cream-tint);
  }
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
    from { opacity: 0; transform: translateY(var(--menu-enter-y, -3px)) scale(0.985); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  @media (prefers-reduced-motion: reduce) {
    .menu { animation: none; }
    .chevron { transition: none; }
  }
</style>
