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
  import { tabDiscriminator, tabLabel } from '../lib/tabs'
  import { middleTruncate } from '../lib/middle-truncate'
  import { tooltip } from '../lib/tooltip'
  import { otherPane, type PaneId } from '../lib/workspace'

  let {
    paneId,
    onOpen,
    local = false,
    onTabMenu,
  }: {
    paneId: PaneId
    onOpen: () => void
    local?: boolean
    // Clic droit sur l'onglet affiché ou sur une entrée de la liste (menu contextuel d'onglet).
    onTabMenu?: (event: MouseEvent, tabId: number) => void
  } = $props()

  let open = $state(false)
  let root: HTMLElement | undefined = $state()
  let trigger: HTMLButtonElement | undefined = $state()
  let menu: HTMLElement | undefined = $state()
  let positioned = $state(false)
  let opensAbove = $state(false)
  // Ouvert au clavier : pas d'animation d'entrée (geste répété, il doit être instantané).
  let kbd = $state(false)

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
    menu.style.setProperty('--menu-origin-y', opensAbove ? 'bottom' : 'top')
    // Menu borné au bord droit : l'origine du zoom reste sous le déclencheur.
    menu.style.setProperty('--menu-origin-x', `${Math.round(Math.max(0, anchor.left - left))}px`)

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

  async function toggle(focusFirst = false, fromKeyboard = focusFirst) {
    activatePane(paneId)
    if (open) {
      close()
      return
    }

    kbd = fromKeyboard
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
    use:tooltip={tab?.path ?? tab?.name ?? 'Choisir un document'}
    aria-haspopup="menu"
    aria-expanded={open}
    aria-label={`${tab?.name ?? 'Choisir un document'}${tab && isDirty(tab) ? ', non enregistré' : ''} — ${app.tabs.length} onglets ouverts`}
    onclick={(event) => void toggle(false, event.detail === 0)}
    oncontextmenu={tab && onTabMenu ? (event) => { close(); onTabMenu(event, tab.id) } : undefined}
    onkeydown={(event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        void toggle(true)
      }
    }}
  >
    {#if tab && isDirty(tab)}<span class="dirty-dot" aria-hidden="true"></span>{/if}
    <span class="name">{tab ? tabLabel(tab) : 'Choisir un document'}</span>
    {#if app.tabs.length > 1}<span class="count">+{app.tabs.length - 1}</span>{/if}
    <svg class="icon chevron" aria-hidden="true"><use href="#i-chevron-down" /></svg>
  </button>

  {#if open}
    <div
      class="menu"
      class:positioned
      class:above={opensAbove}
      class:kbd
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
              title={shownElsewhere ? 'Déjà affiché dans l’autre volet' : (candidate.path ?? candidate.name) + (isDirty(candidate) ? ' — non enregistré' : '')}
              onclick={() => pick(candidate.id)}
              oncontextmenu={onTabMenu ? (event) => { close(); onTabMenu(event, candidate.id) } : undefined}
            >
              <span class="state-dot" class:dirty={isDirty(candidate)} class:current={workspace[paneId].tabId === candidate.id}></span>
              <span class="menu-label">{middleTruncate(tabLabel(candidate))}</span>
              {#if isDirty(candidate)}<span class="sr-only">non enregistré</span>{/if}
              {#if parent}<span class="parent">{parent}</span>{/if}
            </button>
            <button class="close" use:tooltip={`Fermer ${candidate.name}`} aria-label={`Fermer ${candidate.name}`} onclick={() => requestCloseTab(candidate.id)}>
              <svg class="icon" aria-hidden="true"><use href="#i-x" /></svg>
            </button>
          </div>
        {/each}
      </div>
      <div class="menu-actions">
        <div class="separator"></div>
        <button class="menu-item" role="menuitem" onclick={() => { createWorkspaceNote(paneId); close() }}>
          <svg class="icon" aria-hidden="true"><use href="#i-plus" /></svg><span class="menu-label">Nouvelle note Markdown</span>
        </button>
        <button class="menu-item" role="menuitem" onclick={() => { activatePane(paneId); close(); onOpen() }}>
          <svg class="icon" aria-hidden="true"><use href="#i-folder-open" /></svg><span class="menu-label">Ouvrir un autre fichier…</span>
        </button>
        <button class="menu-item" role="menuitem" onclick={() => { swapPanes(); close() }}>
          <svg class="icon" aria-hidden="true"><use href="#i-arrow-up-down" /></svg><span class="menu-label">Permuter les volets</span>
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
  /* 40 px : même hauteur que la barre de titre (--chrome-titlebar-height), sur la grille. */
  .selector.local {
    z-index: 3;
    flex: 0 0 var(--chrome-titlebar-height);
    padding: 4px 8px;
    background: var(--cream-content);
  }
  /* Dans la barre de titre, le déclencheur prend l'allure de l'onglet actif (TitleBar .tab.active). */
  .trigger {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: var(--control-md);
    min-width: 0;
    max-width: 100%;
    flex: 0 1 auto;
    padding: 0 8px 0 12px;
    border: 1px solid transparent;
    border-bottom-width: 0;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    background: var(--cream-content);
    box-shadow: 0 4px 0 var(--cream-content);
    color: var(--ink);
    font: var(--weight-control) var(--text-sm) var(--font-sans);
    cursor: pointer;
  }
  .trigger.empty { color: var(--ink-3); }
  .selector.local .trigger {
    padding: 0 8px;
    border: 0;
    border-radius: var(--radius-lg);
    background: transparent;
    box-shadow: none;
    transition: background-color var(--duration-basic) ease;
  }
  .selector.local .trigger:hover,
  .selector.local .trigger.open { background: var(--fill-hover); }
  .trigger:focus-visible,
  .menu-item:focus-visible,
  .close:focus-visible { outline-offset: -2px; }
  /* « Non enregistré » : pastille CSS 6 px (même grammaire que les onglets de TitleBar). */
  .dirty-dot { flex: 0 0 auto; width: 6px; height: 6px; border-radius: 50%; background: var(--ink); }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }
  .name { min-width: 0; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .count {
    flex: 0 0 auto;
    color: var(--ink-4);
    font-size: var(--text-2xs);
    font-weight: var(--weight-strong);
    font-variant-numeric: tabular-nums;
  }
  .chevron {
    flex: 0 0 auto;
    color: var(--ink-4);
    font-size: 14px;
    transition: transform var(--duration-moderate) var(--ease-enter-snappy);
  }
  .trigger.open .chevron { transform: rotate(180deg); }
  .menu {
    position: fixed;
    z-index: var(--z-popover);
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
    border-radius: var(--radius-xl);
    background: var(--composer-bg);
    color: var(--ink);
    box-shadow: var(--shadow-xl);
    transform-origin: var(--menu-origin-x, 0px) var(--menu-origin-y, top);
    animation: doku-pop-in var(--duration-basic) var(--ease-enter-snappy);
  }
  .menu:is(:not(.positioned), .kbd) { animation: none; }
  .menu:not(.positioned) { visibility: hidden; }
  .menu-documents {
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    padding: 4px 4px 0;
  }
  .menu-actions {
    flex: 0 0 auto;
    padding: 0 4px 4px;
    background: var(--composer-bg);
  }
  .menu-row { display: flex; align-items: center; gap: 2px; }
  /* Fond de survol = couche ::before, instantanée (motif des menus de TitleBar) : les flèches
     du clavier la déplacent en rafale. */
  .menu-item {
    position: relative;
    isolation: isolate;
    width: 100%;
    height: var(--control-md);
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--ink);
    font: var(--weight-control) var(--text-sm) var(--font-sans);
    text-align: left;
    cursor: pointer;
  }
  /* Rangées hautes seulement après un geste au doigt (data-input posé par main.ts) :
     sur Surface, `any-pointer: coarse` reste vrai à la souris. */
  :global(:root[data-input='touch']) .menu-item { min-height: 40px; }
  .menu-item::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1;
    border-radius: inherit;
    background: var(--accent-soft);
    opacity: 0;
  }
  .menu-item:not(:disabled):is(:hover, :focus-visible)::before { opacity: 1; }
  .menu-row .menu-item { flex: 1; }
  .menu-item[aria-checked='true'] { background: var(--accent-soft); }
  .menu-item:disabled { opacity: var(--opacity-disabled); cursor: default; }
  .menu-item > .icon { flex: 0 0 auto; color: var(--ink-3); font-size: 15px; }
  .menu-item:not(:disabled):is(:hover, :focus-visible) > .icon { color: var(--ink); }
  .menu-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .state-dot { width: 6px; height: 6px; flex: 0 0 auto; border-radius: 50%; }
  .state-dot.current { border: 1.5px solid var(--line-3); }
  .state-dot.dirty { border: 0; background: var(--ink); }
  .parent {
    max-width: 90px;
    min-width: 0;
    flex-shrink: 3;
    overflow: hidden;
    color: var(--ink-4);
    font-size: var(--text-xs);
    font-weight: var(--weight-regular);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .parent::before { content: '·'; margin-right: 4px; opacity: 0.55; }
  .close {
    position: relative;
    width: var(--control-2xs);
    height: var(--control-2xs);
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--ink-4);
    cursor: pointer;
    transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease;
  }
  .close > .icon { font-size: 14px; }
  /* Fermer un onglet n'est pas destructif : survol neutre, pas la couleur d'erreur. */
  .close:hover { background: var(--fill-hover); color: var(--ink); }
  /* Zone invisible portée à la hauteur de la rangée (32 px à la souris, 40 px au doigt), sans
     mordre sur l'entrée voisine (1 px du trou de 2 px) ; à droite, jusqu'au bord du menu. */
  @media (any-pointer: coarse) {
    .close::after { content: ''; position: absolute; inset: -4px -4px -4px -1px; }
    :global(:root[data-input='touch']) .close::after { inset: -8px -4px -8px -1px; }
  }
  .separator { height: 1px; margin: 4px 8px; background: var(--line-1); }
</style>
