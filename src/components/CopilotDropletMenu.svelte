<script lang="ts">
  // Menu « goutte » du « + » de contexte (refonte v2, façon droplet button) : à l'ouverture, les
  // actions sortent du « + » en gouttes qui s'étirent, se détachent et se posent sur un ressort ;
  // à la fermeture elles fondent dans le « + ». Deux couches superposées au pixel : les CORPS
  // dans un calque filtré par #doku-goo (main.ts) qui les fait fusionner, les icônes et
  // libellés nets au-dessus. Ouvert au clavier : aucune animation (règles du plan v2).
  import { onMount } from 'svelte'
  import type { TransitionConfig } from 'svelte/transition'
  import { prefersReducedMotion } from '../lib/liquid'

  export type DropItem = {
    id: string
    label: string
    icon: string
    checked?: boolean
    run: () => void
  }

  let {
    anchor,
    items,
    keyboard,
    onclose,
    menuEl = $bindable(null),
  }: {
    // Centre du « + » dans le repère du panneau, et largeur du panneau (côté des libellés).
    anchor: { x: number; y: number; width: number }
    items: DropItem[]
    keyboard: boolean
    onclose: (restoreFocus: boolean) => void
    menuEl?: HTMLElement | null
  } = $props()

  const touch = typeof document !== 'undefined' && document.documentElement.dataset.input === 'touch'
  // Écart au repos > portée du filtre (~10 px) : les gouttes posées restent distinctes, elles ne
  // fusionnent qu'en route.
  const D = touch ? 44 : 36
  const A = touch ? 34 : 30
  const GAP = 14
  const PAD = 20
  const offset = (i: number) => A / 2 + GAP + D / 2 + i * (D + GAP)

  const labelsLeft = $derived(anchor.x > anchor.width * 0.6)
  const top = $derived(anchor.y - offset(items.length - 1) - D / 2 - PAD)
  const layer = $derived({ left: anchor.x - D / 2 - PAD, top, width: D + PAD * 2, height: anchor.y + A / 2 + PAD - top })
  const labelMax = $derived(Math.max(80, (labelsLeft ? anchor.x : anchor.width - anchor.x) - D / 2 - 24))

  // Ressort amorti (~8 % de dépassement vers 40 %), proche de --ease-spring-liquid.
  const spring = (t: number) => 1 - Math.exp(-6.5 * t) * Math.cos(8 * t)
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
  const reduced = prefersReducedMotion()
  const still = (): TransitionConfig => (reduced ? { duration: 140, css: (t) => `opacity:${t}` } : { duration: 0 })

  // `crisp` : la couche nette n'apparaît qu'à l'arrivée (le corps liquide porte le trajet).
  function dropIn(_node: Element, { i, crisp = false }: { i: number; crisp?: boolean }): TransitionConfig {
    if (keyboard || reduced) return still()
    const dy = offset(i)
    return {
      delay: i * 45,
      duration: 520,
      css: (t) => {
        const p = spring(t)
        const swell = Math.sin(Math.PI * clamp01(t * 1.6))
        const s = 0.35 + 0.65 * Math.min(p, 1.04)
        const opacity = crisp ? clamp01((t - 0.42) / 0.3) : 1
        return `translate: 0 ${dy * (1 - p)}px; scale: ${s * (1 - 0.12 * swell)} ${s * (1 + 0.2 * swell)}; opacity: ${opacity}`
      },
    }
  }

  // Retour : la plus éloignée part d'abord, s'étire vers le « + » et s'y fond (scale → 0.3).
  function dropOut(_node: Element, { i, crisp = false }: { i: number; crisp?: boolean }): TransitionConfig {
    if (keyboard || reduced) return still()
    const dy = offset(i)
    return {
      delay: (items.length - 1 - i) * 35,
      duration: 300,
      css: (t) => {
        const q = 1 - t
        const e = q * q * (3 - 2 * q)
        const swell = Math.sin(Math.PI * e)
        const s = 1 - 0.7 * e
        const opacity = crisp ? clamp01((t - 0.6) / 0.4) : 1
        return `translate: 0 ${dy * e}px; scale: ${s * (1 - 0.12 * swell)} ${s * (1 + 0.22 * swell)}; opacity: ${opacity}`
      },
    }
  }

  // Le « + » gonfle en goutte et tourne en × ; au retour il attend que la dernière goutte l'ait
  // rejoint, puis rétrécit (dans le calque goo, s'effacer = fondre : le seuil ronge le bord).
  function anchorIn(_node: Element, { rotate = false }: { rotate?: boolean } = {}): TransitionConfig {
    if (keyboard || reduced) return still()
    return {
      duration: 260,
      css: (t) => `scale: ${0.75 + 0.25 * spring(t)};${rotate ? ` opacity: ${t}; rotate: ${45 * spring(t)}deg` : ''}`,
    }
  }

  function anchorOut(_node: Element, { rotate = false }: { rotate?: boolean } = {}): TransitionConfig {
    if (keyboard || reduced) return still()
    return {
      delay: (items.length - 1) * 35 + 200,
      duration: 200,
      css: (t) => `scale: ${0.8 + 0.2 * t}; opacity: ${t};${rotate ? ` rotate: ${45 * t}deg` : ''}`,
    }
  }

  let buttons: HTMLButtonElement[] = $state([])

  onMount(() => {
    buttons[0]?.focus()
  })

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onclose(true)
      return
    }
    if (e.key === 'Tab') {
      onclose(false)
      return
    }
    const list = buttons.filter(Boolean)
    const index = list.indexOf(document.activeElement as HTMLButtonElement)
    // La pile monte depuis le « + » : Haut s'en éloigne, Bas y revient.
    const next =
      e.key === 'ArrowUp' ? list[index + 1] ?? list[0]
      : e.key === 'ArrowDown' ? list[index - 1] ?? list.at(-1)
      : e.key === 'Home' ? list[0]
      : e.key === 'End' ? list.at(-1)
      : null
    if (!next) return
    e.preventDefault()
    next.focus()
  }
</script>

<div
  class="cop-drops"
  class:labels-left={labelsLeft}
  role="menu"
  tabindex="-1"
  aria-label="Ajouter du contexte"
  aria-orientation="vertical"
  style="--d:{D}px; --label-max:{labelMax}px"
  bind:this={menuEl}
  {onkeydown}
>
  <div
    class="cop-drops-goo"
    aria-hidden="true"
    style="left:{layer.left}px; top:{layer.top}px; width:{layer.width}px; height:{layer.height}px"
  >
    <span
      class="cop-drops-blob"
      style="width:{A}px; height:{A}px; left:{PAD + D / 2 - A / 2}px; top:{anchor.y - layer.top - A / 2}px"
      in:anchorIn|global
      out:anchorOut|global
    ></span>
    {#each items as item, i (item.id)}
      <span
        class="cop-drops-blob"
        style="width:{D}px; height:{D}px; left:{PAD}px; top:{anchor.y - layer.top - offset(i) - D / 2}px"
        in:dropIn|global={{ i }}
        out:dropOut|global={{ i }}
      ></span>
    {/each}
  </div>
  <span
    class="cop-drops-x"
    aria-hidden="true"
    style="left:{anchor.x - A / 2}px; top:{anchor.y - A / 2}px; width:{A}px; height:{A}px"
    in:anchorIn|global={{ rotate: true }}
    out:anchorOut|global={{ rotate: true }}
  ><svg class="icon"><use href="#i-plus" /></svg></span>
  {#each items as item, i (item.id)}
    <button
      class="cop-drop"
      class:checked={item.checked}
      role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={item.checked}
      style="{labelsLeft ? `right:${anchor.width - anchor.x - D / 2}px` : `left:${anchor.x - D / 2}px`}; top:{anchor.y - offset(i) - D / 2}px"
      bind:this={buttons[i]}
      onclick={() => item.run()}
      in:dropIn|global={{ i, crisp: true }}
      out:dropOut|global={{ i, crisp: true }}
    >
      <span class="cop-drop-disc"><svg class="icon" aria-hidden="true"><use href="#i-{item.icon}" /></svg></span>
      <span class="cop-drop-label">{item.label}</span>
    </button>
  {/each}
</div>

<style>
  .cop-drops { position: absolute; inset: 0; z-index: var(--z-popover); pointer-events: none; }
  .cop-drops:focus { outline: none; }
  /* Corps liquides : opaques (le seuillage d'alpha rendrait un verre translucide opaque de toute
     façon), l'ombre portée APRÈS le filtre pour qu'elle épouse la forme fusionnée. */
  .cop-drops-goo {
    position: absolute;
    filter: url(#doku-goo) drop-shadow(0 6px 12px rgba(var(--shadow-rgb), 0.2)) drop-shadow(0 0 0.6px rgba(var(--shadow-rgb), 0.5));
  }
  .cop-drops-blob { position: absolute; border-radius: 50%; background: var(--track-thumb); }
  /* Sombre : graphite mat, à peine plus clair que le fond, sans liseré ni reflet (un corps
     éclairci au liseré clair « brillait » trop). L'ombre seule le détache. */
  :global(:root[data-theme='dark']) .cop-drops-goo {
    filter: url(#doku-goo) drop-shadow(0 4px 10px rgb(0 0 0 / 0.5));
  }
  :global(:root[data-theme='dark']) .cop-drops-blob { background: color-mix(in srgb, var(--ink) 8%, var(--surface-2)); }
  .cop-drops-x {
    position: absolute; display: inline-flex; align-items: center; justify-content: center;
    color: var(--ink); font-size: 15px; rotate: 45deg;
  }
  .cop-drop {
    position: absolute; display: flex; align-items: center; gap: 8px; padding: 0; border: 0;
    background: none; color: var(--ink); font: var(--weight-control) var(--text-xs)/1 var(--font-sans);
    pointer-events: auto; cursor: pointer; transform-origin: calc(var(--d) / 2) 50%;
  }
  .labels-left .cop-drop { flex-direction: row-reverse; transform-origin: calc(100% - var(--d) / 2) 50%; }
  /* Reflet du verre : liseré et lumière du haut, nets, posés sur le corps liquide. */
  .cop-drop-disc {
    width: var(--d); height: var(--d); flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
    border-radius: 50%; font-size: 16px;
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.55), inset 0 0 0 0.5px var(--elevation-ring);
    transition: background-color var(--duration-basic) ease, scale var(--duration-basic) var(--ease-enter-snappy);
  }
  :global(:root[data-theme='dark']) .cop-drop-disc { box-shadow: none; }
  .cop-drop:hover .cop-drop-disc { background: var(--fill-hover); }
  .cop-drop:active .cop-drop-disc { scale: 0.94; }
  .cop-drop.checked .cop-drop-disc { background: var(--ink); color: var(--cream-content); }
  .cop-drop:focus-visible { outline: none; }
  .cop-drop:focus-visible .cop-drop-disc { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
  .cop-drop-label {
    max-width: var(--label-max); height: 26px; padding: 0 10px; display: block; line-height: 26px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    border-radius: var(--radius-full); background: var(--glass-bg); box-shadow: var(--glass-shadow);
  }
  .cop-drop:hover .cop-drop-label { color: var(--ink); background: color-mix(in srgb, var(--glass-bg), var(--ink) 4%); }
  :global(:where(:root[data-input='touch'])) .cop-drop-label { height: 32px; line-height: 32px; font-size: var(--text-sm); }
</style>
