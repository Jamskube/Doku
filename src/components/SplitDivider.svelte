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
  /* Le séparateur occupe l'écart du bureau entre les deux feuilles : rien n'y est dessiné
     au repos (l'écart sépare déjà), une poignée en pilule apparaît au survol et s'affirme
     pendant le glisser ; au clavier, la pilule à la couleur du focus tient lieu d'anneau. */
  .divider {
    position: relative;
    z-index: 4;
    flex: 0 0 var(--canvas-gap);
    width: var(--canvas-gap);
    cursor: col-resize;
    touch-action: none;
    padding: 0;
    border: 0;
    background: transparent;
  }
  .divider span { position: absolute; inset: 0; }
  .divider span::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 4px;
    height: 32px;
    translate: -50% -50%;
    border-radius: var(--radius-full);
    background: var(--ink-4);
    opacity: 0;
    scale: 1 0.7;
    transition: opacity var(--duration-basic) ease, scale var(--duration-moderate) var(--ease-enter-snappy), background-color var(--duration-basic) ease;
  }
  .divider.vertical span::after { width: 32px; height: 4px; scale: 0.7 1; }
  .divider:is(:hover, :active, :focus-visible) span::after { opacity: 1; scale: 1; }
  .divider:active span::after { background: var(--ink-2); }
  .divider:focus-visible { outline: none; }
  .divider:focus-visible span::after { background: var(--focus-ring); }
  .divider.vertical {
    flex-basis: var(--canvas-gap);
    width: auto;
    height: var(--canvas-gap);
    cursor: row-resize;
  }
  /* Au doigt, 8 px ne se saisissent pas : la zone déborde sur la feuille de DROITE (à gauche,
     elle recouvrirait la barre de défilement du premier volet, que la souris doit garder).
     Empilé, le bas est pris par le sélecteur du volet et le haut peut porter la barre de
     défilement horizontale d'un PDF zoomé : la zone ne grandit qu'après un geste au doigt. */
  @media (any-pointer: coarse) {
    .divider:not(.vertical)::before { content: ''; position: absolute; inset: 0 -12px 0 0; }
    :global(:root[data-input='touch']) .divider.vertical::before { content: ''; position: absolute; inset: -12px 0 0; }
  }
</style>
