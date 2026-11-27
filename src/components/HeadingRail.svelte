<script lang="ts">
  // Rail des titres (Kube nav-rail) : un trait par titre au bord du document, qui grandit vers
  // le pointeur comme un dock et saute au titre au clic. Le libellé du titre survolé flotte à
  // gauche du rail.
  import type { Heading } from '../lib/stores.svelte'
  import { moveLiquid } from '../lib/liquid'

  let {
    headings,
    activeLine,
    muted = false,
    onJump,
  }: { headings: Heading[]; activeLine: number; muted?: boolean; onJump: (line: number) => void } = $props()

  let rail: HTMLElement | undefined = $state()
  let bead: HTMLElement | undefined = $state()
  let beadHeadings: Heading[] | null = null

  const BEAD = 5
  // Perle du titre courant : elle coule d'un trait à l'autre (étirée en goutte, liquid.ts).
  // Nouveau document = pose sèche, sans traverser le rail.
  $effect(() => {
    const index = headings.findIndex((h) => h.line === activeLine)
    const mark = rail?.children[index] as HTMLElement | undefined
    if (!bead) return
    bead.style.opacity = mark ? '' : '0'
    if (!mark) return
    const animate = beadHeadings === headings
    beadHeadings = headings
    moveLiquid(bead, { x: mark.offsetTop + (mark.offsetHeight - BEAD) / 2, w: BEAD }, { axis: 'y', animate })
  })
  let label = $state<{ text: string; top: number } | null>(null)

  function showLabel(event: Event, text: string) {
    if (event instanceof PointerEvent && event.pointerType === 'touch') return
    const mark = event.currentTarget as HTMLElement
    if (!rail) return
    label = { text, top: rail.offsetTop + mark.offsetTop - rail.scrollTop + mark.offsetHeight / 2 }
  }

  // Garde la marque courante visible quand la liste dépasse la hauteur du rail. scrollTop seul :
  // scrollIntoView ferait aussi défiler les ancêtres en `overflow: hidden` (volets, espace de travail).
  $effect(() => {
    const index = headings.findIndex((h) => h.line === activeLine)
    const mark = rail?.children[index] as HTMLElement | undefined
    if (!rail || !mark) return
    if (mark.offsetTop < rail.scrollTop) rail.scrollTop = mark.offsetTop
    else if (mark.offsetTop + mark.offsetHeight > rail.scrollTop + rail.clientHeight)
      rail.scrollTop = mark.offsetTop + mark.offsetHeight - rail.clientHeight
  })
</script>

<div class="heading-rail" class:muted inert={muted}>
  <nav class="rail" aria-label="Aller à la section" bind:this={rail} onpointerleave={() => (label = null)} onscroll={() => (label = null)}>
    {#each headings as h (h.line)}
      <button
        class="mark"
        type="button"
        data-level={h.level}
        aria-current={h.line === activeLine ? 'true' : undefined}
        aria-label={h.text}
        onpointerenter={(e) => showLabel(e, h.text)}
        onfocus={(e) => showLabel(e, h.text)}
        onblur={() => (label = null)}
        onclick={() => onJump(h.line)}
      ><span class="line"></span></button>
    {/each}
    <!-- Après les marques : rail.children[i] reste la i-ième marque. -->
    <span class="bead" aria-hidden="true" bind:this={bead}></span>
  </nav>
  {#if label}
    <span class="label" style:top="{label.top}px" dir="auto" aria-hidden="true">{label.text}</span>
  {/if}
</div>

<style>
  /* 9px de gouttière de défilement + 4px : le rail ne chevauche jamais la barre. Ses traits
     (23 à 49px du bord) restent dans le retrait de 40px du contenu, même en pleine largeur. */
  .heading-rail {
    position: absolute;
    z-index: 3;
    top: 50%;
    right: 13px;
    translate: 0 -50%;
    transition: opacity var(--duration-basic) ease;
  }
  .heading-rail.muted { opacity: 0; pointer-events: none; }
  .rail {
    position: relative;
    display: flex;
    flex-direction: column;
    max-height: min(70vh, 40rem);
    padding: 4px 0;
    overflow-y: auto;
    scrollbar-width: none;
  }
  .rail::-webkit-scrollbar { display: none; }
  .mark {
    --base: calc(6 / 26);
    --grow: 0;
    flex: none;
    width: 44px;
    height: 10px;
    display: flex;
    align-items: center;
    padding: 0 0 0 8px;
    border: 0;
    background: none;
    cursor: pointer;
  }
  .bead {
    position: absolute;
    top: 0;
    left: 1px;
    width: 5px;
    height: 5px;
    border-radius: var(--radius-full);
    background: var(--ink);
    pointer-events: none;
    transition: opacity var(--duration-basic) ease;
  }
  .mark[data-level='1'] { --base: calc(12 / 26); }
  .mark[data-level='2'] { --base: calc(8 / 26); }
  .mark[data-level='3'] { --base: calc(4 / 26); }
  .mark:focus-visible { outline: none; }
  .line {
    width: 26px;
    height: 2px;
    border-radius: 1px;
    background: var(--ink-2);
    opacity: 0.4;
    transform-origin: left center;
    transform: scaleX(calc(var(--base) + (1 - var(--base)) * var(--grow)));
    transition:
      transform 160ms cubic-bezier(.3, 1.3, .6, 1),
      opacity var(--duration-basic) ease,
      background-color var(--duration-basic) ease;
  }
  .mark[aria-current='true'] .line { background: var(--ink); opacity: 0.6; }
  /* Effet dock : la marque survolée pleine longueur, ses voisines à 70, 40 et 20 % du reste. */
  .mark:hover + .mark,
  .mark:has(+ .mark:hover) { --grow: 0.7; }
  .mark:hover + .mark + .mark,
  .mark:has(+ .mark + .mark:hover) { --grow: 0.4; }
  .mark:hover + .mark + .mark + .mark,
  .mark:has(+ .mark + .mark + .mark:hover) { --grow: 0.2; }
  .rail:hover .mark[aria-current='true']:not(:hover) .line { background: var(--ink-2); opacity: 0.4; }
  .mark:hover,
  .mark:focus-visible { --grow: 1; }
  .mark:hover .line,
  .mark:focus-visible .line { background: var(--ink); opacity: 1; }
  :global(:where(:root[data-input='touch'])) .mark { height: 16px; }

  .label {
    position: absolute;
    right: calc(100% + 2px);
    max-width: 240px;
    padding: 4px 8px;
    border-radius: var(--radius-md);
    background: var(--glass-bg);
    -webkit-backdrop-filter: var(--glass-filter-sm);
    backdrop-filter: var(--glass-filter-sm);
    box-shadow: var(--glass-shadow);
    color: var(--ink);
    font: var(--weight-control) var(--text-xs)/16px var(--font-sans);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    translate: 0 -50%;
    pointer-events: none;
    animation: doku-fade-in 120ms var(--ease-enter-snappy);
  }
</style>
