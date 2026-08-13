<script lang="ts">
  import { clampWorkspaceRatioForSize } from '../lib/workspace'
  let {
    orientation,
    ratio,
    onChange,
    onDragging,
  }: {
    orientation: 'horizontal' | 'vertical'
    ratio: number
    onChange: (ratio: number) => void
    onDragging: (dragging: boolean) => void
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
    onDragging(true)
  }


  function pointerEnd(event: PointerEvent) {
    const target = event.currentTarget as HTMLElement
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId)
    onDragging(false)
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
  .divider span {
    position: absolute;
    inset: 0 4px;
    background: var(--line-1);
    transition: background 140ms ease, box-shadow 140ms ease;
  }
  .divider:hover span,
  .divider:focus-visible span {
    background: var(--line-3);
    box-shadow: 0 0 0 1px var(--cream-content);
  }
  .divider:focus-visible { outline: none; }
  .divider.vertical {
    flex-basis: 9px;
    width: auto;
    height: 9px;
    margin: -4px 0;
    cursor: row-resize;
  }
  .divider.vertical span { inset: 4px 0; }
  @media (prefers-reduced-motion: reduce) {
    .divider span { transition: none; }
  }
</style>
