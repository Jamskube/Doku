<script lang="ts">
  import { clampWorkspaceRatioForSize } from '../lib/workspace'
  let {
    orientation,
    ratio,
    onChange,
  }: {
    orientation: 'horizontal' | 'vertical'
    ratio: number
    onChange: (ratio: number) => void
  } = $props()

  let frame = 0
  let pending = 50
  let divider: HTMLElement | undefined

  function schedule(value: number) {
    pending = bounded(value)
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      onChange(pending)
    })
  }

  function bounded(value: number): number {
    const workspace = divider?.parentElement?.getBoundingClientRect()
    const size = workspace ? (orientation === 'horizontal' ? workspace.width : workspace.height) : 0
    const minimum = orientation === 'horizontal' ? 280 : 240
    return clampWorkspaceRatioForSize(value, size, minimum)
  }

  function pointerDown(event: PointerEvent) {
    const target = event.currentTarget as HTMLElement
    target.setPointerCapture(event.pointerId)
  }


  function pointerEnd(event: PointerEvent) {
    const target = event.currentTarget as HTMLElement
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId)
  }

  function pointerMove(event: PointerEvent) {
    const target = event.currentTarget as HTMLElement
    if (!target.hasPointerCapture(event.pointerId)) return
    const workspace = target.parentElement?.getBoundingClientRect()
    if (!workspace) return
    const value = orientation === 'horizontal'
      ? ((event.clientX - workspace.left) / workspace.width) * 100
      : ((event.clientY - workspace.top) / workspace.height) * 100
    schedule(value)
  }

  function keydown(event: KeyboardEvent) {
    const decreasing = orientation === 'horizontal' ? event.key === 'ArrowLeft' : event.key === 'ArrowUp'
    const increasing = orientation === 'horizontal' ? event.key === 'ArrowRight' : event.key === 'ArrowDown'
    if (decreasing || increasing) {
      event.preventDefault()
      onChange(bounded(ratio + (increasing ? 5 : -5)))
    } else if (event.key === 'Home') {
      event.preventDefault()
      onChange(bounded(25))
    } else if (event.key === 'End') {
      event.preventDefault()
      onChange(bounded(75))
    }
  }
</script>

<!-- Le role separator focusable est le pattern ARIA attendu pour un séparateur redimensionnable. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  bind:this={divider}
  class="divider"
  class:vertical={orientation === 'vertical'}
  role="separator"
  tabindex="0"
  aria-label="Redimensionner les volets"
  title="Glissez ou utilisez les flèches pour redimensionner"
  aria-orientation={orientation === 'horizontal' ? 'vertical' : 'horizontal'}
  aria-valuemin="25"
  aria-valuemax="75"
  aria-valuenow={ratio}
  onpointerdown={pointerDown}
  onpointermove={pointerMove}
  onpointerup={pointerEnd}
  onpointercancel={pointerEnd}
  ondblclick={() => onChange(50)}
  onkeydown={keydown}
>
  <span></span>
</div>

<style>
  .divider {
    position: relative;
    z-index: 4;
    flex: 0 0 9px;
    width: 9px;
    margin: 0 -4px;
    cursor: col-resize;
    touch-action: none;
    padding: 0;
    border: 0;
    background: transparent;
  }
  /* Filet de 1 px au repos (deux volets de même fond), --line-3 au survol et pendant le
     glisser ; au clavier, une barre de 3 px à la couleur du focus tient lieu d'anneau. */
  .divider span {
    position: absolute;
    inset: 0 4px;
    background: var(--line-1);
    transition: background-color var(--duration-basic) ease;
  }
  .divider:is(:hover, :active) span { background: var(--line-3); }
  .divider:focus-visible { outline: none; }
  .divider:focus-visible span { inset: 0 3px; background: var(--focus-ring); }
  .divider.vertical {
    flex-basis: 9px;
    width: auto;
    height: 9px;
    margin: -4px 0;
    cursor: row-resize;
  }
  .divider.vertical span { inset: 4px 0; }
  .divider.vertical:focus-visible span { inset: 3px 0; }
  /* Au doigt, 9 px ne se saisissent pas : 24 px, le filet reste sur la couture et l'encombrement
     net reste 1 px. La zone déborde surtout sur le volet de DROITE : à gauche, elle
     recouvrirait la barre de défilement du premier volet, que la souris doit garder.
     Empilé, le bas est pris par le sélecteur du volet (.selector.local) et le haut peut porter
     la barre de défilement horizontale d'un PDF zoomé : 4 px de chaque côté, comme à la souris.
     Seulement après un geste au doigt (qui fait défiler sans la barre), la zone monte de 19 px. */
  @media (any-pointer: coarse) {
    .divider { flex-basis: 24px; width: 24px; margin: 0 -19px 0 -4px; }
    .divider span { inset: 0 19px 0 4px; }
    .divider:focus-visible span { inset: 0 18px 0 3px; }
    .divider.vertical { flex-basis: 9px; width: auto; height: 9px; margin: -4px 0; }
    .divider.vertical span { inset: 4px 0; }
    .divider.vertical:focus-visible span { inset: 3px 0; }
    :global(:root[data-input='touch']) .divider.vertical { flex-basis: 24px; height: 24px; margin: -19px 0 -4px; }
    :global(:root[data-input='touch']) .divider.vertical span { inset: 19px 0 4px; }
    :global(:root[data-input='touch']) .divider.vertical:focus-visible span { inset: 18px 0 3px; }
  }
</style>
