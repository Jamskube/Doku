<script lang="ts" module>
  export type DocMenuItem = { label: string; icon: string; kbd?: string; disabled?: boolean; run: () => void } | 'sep'
</script>

<script lang="ts">
  // Menu contextuel du document, en verre (couche flottante). Né au pointeur, il se replie
  // vers la gauche ou le haut quand la place manque ; né du clavier, il n'est pas animé et
  // le focus va à la première entrée active.
  import { onMount } from 'svelte'

  let {
    x,
    y,
    kbd,
    items,
    label = 'Actions',
    onClose,
  }: { x: number; y: number; kbd: boolean; items: DocMenuItem[]; label?: string; onClose: (refocus: boolean) => void } = $props()

  let el: HTMLElement | undefined = $state()
  let placed = $state<{ left: number; top: number; origin: string } | null>(null)

  const enabledItems = () => Array.from(el?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])

  onMount(() => {
    if (!el) return
    const margin = 8
    const { offsetWidth: w, offsetHeight: h } = el
    const flipX = x + w > innerWidth - margin
    const flipY = y + h > innerHeight - margin
    placed = {
      left: Math.max(margin, Math.min(flipX ? x - w : x, innerWidth - w - margin)),
      top: Math.max(margin, Math.min(flipY ? y - h : y, innerHeight - h - margin)),
      origin: `${flipX ? 'right' : 'left'} ${flipY ? 'bottom' : 'top'}`,
    }
    if (kbd) enabledItems()[0]?.focus()
    else el.focus()

    const onPointerDown = (event: PointerEvent) => {
      if (!el?.contains(event.target as Node)) onClose(false)
    }
    const dismiss = () => onClose(false)
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    window.addEventListener('blur', dismiss)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('blur', dismiss)
    }
  })

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault()
      onClose(true)
      return
    }
    const list = enabledItems()
    if (!list.length) return
    const index = list.indexOf(document.activeElement as HTMLButtonElement)
    let next: number
    if (event.key === 'ArrowDown') next = index < 0 ? 0 : (index + 1) % list.length
    else if (event.key === 'ArrowUp') next = index < 0 ? list.length - 1 : (index - 1 + list.length) % list.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = list.length - 1
    else return
    event.preventDefault()
    list[next].focus()
  }

  function choose(item: Exclude<DocMenuItem, 'sep'>) {
    onClose(false)
    item.run()
  }
</script>

<div
  class="doc-menu"
  class:kbd
  bind:this={el}
  role="menu"
  aria-label={label}
  tabindex="-1"
  style:left="{placed?.left ?? x}px"
  style:top="{placed?.top ?? y}px"
  style:transform-origin={placed?.origin}
  onkeydown={onKeyDown}
  oncontextmenu={(e) => e.preventDefault()}
>
  {#each items as item, i (i)}
    {#if item === 'sep'}
      <div class="sep" role="separator"></div>
    {:else}
      <button class="row" role="menuitem" disabled={item.disabled} onclick={() => choose(item)}>
        <svg class="icon" aria-hidden="true"><use href="#i-{item.icon}" /></svg>
        <span class="row-label">{item.label}</span>
        {#if item.kbd}<kbd>{item.kbd}</kbd>{/if}
      </button>
    {/if}
  {/each}
</div>

<style>
  .doc-menu {
    position: fixed;
    z-index: var(--z-context);
    width: 232px;
    padding: 4px;
    border-radius: var(--radius-xl);
    background: var(--glass-bg);
    -webkit-backdrop-filter: var(--glass-filter);
    backdrop-filter: var(--glass-filter);
    box-shadow: var(--glass-shadow);
    color: var(--ink);
    font: var(--weight-control) var(--text-sm) var(--font-sans);
    user-select: none;
    animation: doku-pop-in var(--duration-basic) var(--ease-enter-snappy);
  }
  .doc-menu.kbd { animation: none; }
  .doc-menu:focus { outline: none; }
  .sep { height: 1px; margin: 4px 8px; background: var(--line-1); }
  .row {
    width: 100%;
    height: var(--control-md);
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .row .icon { font-size: 15px; color: var(--ink-3); }
  .row-label { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .row kbd { color: var(--ink-4); font: 400 var(--text-xs) var(--font-sans); }
  /* Survol instantané : les flèches le déplacent en rafale. */
  .row:not(:disabled):hover,
  .row:focus-visible { background: var(--menu-row-hover); }
  .row:not(:disabled):hover .icon { color: var(--ink); }
  .row:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
  .row:disabled { opacity: var(--opacity-disabled); cursor: default; }
  :global(:where(:root[data-input='touch'])) .row { height: 40px; }
</style>
