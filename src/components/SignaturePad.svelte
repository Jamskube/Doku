<script lang="ts">
  // Pavé de signature : on trace UNE fois, au doigt, au stylet ou à la souris — les
  // Pointer Events couvrent les trois sans branche. Le résultat est vectoriel (mêmes
  // tracés que le crayon du lecteur PDF), donc net à toutes les tailles de pose.
  import { extendPdfDrawingPoints, pdfStrokePathData, smoothPdfDrawingStroke, type PdfDrawingPoint } from '../lib/pdf-drawing'
  import { untrack } from 'svelte'
  import { SIGNATURE_STROKE_WIDTH, SIGNATURE_STROKE_WIDTHS, captureSignature, type SavedSignature } from '../lib/pdf-signature-stamp'

  let { onsave, onclose, strokeWidth: initialStrokeWidth = SIGNATURE_STROKE_WIDTH }: {
    onsave: (signature: SavedSignature) => void | Promise<void>
    onclose: () => void
    /** Épaisseur de la signature qu'on refait : le pavé rouvre sur le dernier choix. */
    strokeWidth?: number
  } = $props()

  const PAD_WIDTH = 500
  const PAD_HEIGHT = 200
  // Une signature occupe ~300 unités du pavé et ~240 millièmes de page une fois posée :
  // ce rapport fait que le trait du pavé a l'allure de celui du document.
  const PAD_STROKE_SCALE = 1.25

  let dlg = $state<HTMLDialogElement | null>(null)
  let pad = $state<SVGSVGElement | null>(null)
  let strokes = $state<PdfDrawingPoint[][]>([])
  let current = $state<PdfDrawingPoint[]>([])
  let saving = $state(false)
  let strokeWidth = $state(untrack(() => initialStrokeWidth))
  // Un seul pointeur trace à la fois : la paume posée pendant qu'on signe au stylet ne
  // doit pas ouvrir un second trait.
  let activePointer: number | null = null

  const pathData = $derived(pdfStrokePathData(current.length ? [...strokes, current] : strokes, PAD_WIDTH, PAD_HEIGHT))
  const signature = $derived(captureSignature(strokes, PAD_WIDTH / PAD_HEIGHT, strokeWidth))

  $effect(() => {
    if (dlg && !dlg.open) dlg.showModal()
  })

  function padPoint(event: PointerEvent): PdfDrawingPoint {
    const rect = pad!.getBoundingClientRect()
    return {
      x: Math.min(Math.max((event.clientX - rect.left) / Math.max(rect.width, 1), 0), 1),
      y: Math.min(Math.max((event.clientY - rect.top) / Math.max(rect.height, 1), 0), 1),
    }
  }

  function handlePointerDown(event: PointerEvent) {
    if (activePointer !== null || event.button !== 0 || !pad) return
    event.preventDefault()
    activePointer = event.pointerId
    try { pad.setPointerCapture(event.pointerId) } catch { /* capture indisponible hors geste natif */ }
    current = [padPoint(event)]
  }

  function handlePointerMove(event: PointerEvent) {
    if (event.pointerId !== activePointer) return
    const coalesced = event.getCoalescedEvents?.()
    current = extendPdfDrawingPoints(current, (coalesced?.length ? coalesced : [event]).map(padPoint))
  }

  function handlePointerUp(event: PointerEvent) {
    if (event.pointerId !== activePointer) return
    activePointer = null
    // Un simple appui est un POINT (celui d'un « i ») : on lui donne une longueur
    // infime, le bout rond du trait en fait une pastille.
    const stroke = current.length === 1
      ? [current[0], { x: Math.min(current[0].x + 0.004, 1), y: current[0].y }]
      : smoothPdfDrawingStroke(current)
    current = []
    if (stroke.length >= 2) strokes = [...strokes, stroke]
  }

  function handlePointerCancel(event: PointerEvent) {
    if (event.pointerId !== activePointer) return
    activePointer = null
    current = []
  }

  async function save() {
    if (!signature || saving) return
    saving = true
    try {
      await onsave(signature)
    } finally {
      saving = false
    }
  }
</script>

<dialog class="sigpad" bind:this={dlg} {onclose} aria-labelledby="sigpad-title">
  <div class="window">
    <header>
      <span class="title-icon" aria-hidden="true"><svg class="icon" aria-hidden="true"><use href="#i-signature" /></svg></span>
      <div class="title">
        <h2 id="sigpad-title">Ma signature</h2>
        <p>Tracez-la au doigt, au stylet ou à la souris.</p>
      </div>
      <span class="spacer"></span>
      <button class="close" aria-label="Fermer" onclick={() => dlg?.close()}><svg class="icon" aria-hidden="true"><use href="#i-x" /></svg></button>
    </header>

    <div class="paper">
      <svg
        bind:this={pad}
        viewBox="0 0 {PAD_WIDTH} {PAD_HEIGHT}"
        role="img"
        aria-label="Zone de signature"
        onpointerdown={handlePointerDown}
        onpointermove={handlePointerMove}
        onpointerup={handlePointerUp}
        onpointercancel={handlePointerCancel}
      >
        <line class="baseline" x1="40" y1="150" x2="460" y2="150" />
        <path d={pathData} stroke-width={strokeWidth * PAD_STROKE_SCALE} />
      </svg>
      {#if !strokes.length && !current.length}<span class="placeholder" aria-hidden="true">Signez ici</span>{/if}
    </div>

    <div class="thickness" role="radiogroup" aria-label="Épaisseur du trait">
      <span aria-hidden="true">Trait</span>
      {#each SIGNATURE_STROKE_WIDTHS as option}
        <button
          role="radio"
          aria-checked={strokeWidth === option.value}
          aria-label={option.label}
          title={option.label}
          class:selected={strokeWidth === option.value}
          onclick={() => { strokeWidth = option.value }}
        >
          <span class="sample" style={`height:${option.value * PAD_STROKE_SCALE}px`}></span>
        </button>
      {/each}
    </div>

    <footer>
      <small>Conservée sur cet appareil uniquement.</small>
      <span class="spacer"></span>
      <button class="secondary" disabled={!strokes.length} onclick={() => { strokes = [] }}>Effacer</button>
      <button class="primary" disabled={!signature || saving} onclick={() => void save()}>Enregistrer</button>
    </footer>
  </div>
</dialog>

<style>
  .sigpad {
    width: min(620px, calc(100vw - 32px));
    max-width: none;
    margin: auto;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--ink);
    overflow: visible;
  }
  .sigpad::backdrop {
    background: var(--scrim);
    animation: doku-fade-in var(--duration-dialog) var(--ease-enter-snappy);
  }
  .window {
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border-radius: var(--radius-2xl);
    box-shadow: var(--shadow-dialog);
    overflow: hidden;
    animation: doku-dialog-in var(--duration-dialog) var(--ease-enter-snappy);
  }
  header { min-height: 60px; display: flex; align-items: center; gap: 12px; padding: 12px 12px 12px 16px; }
  .title-icon {
    width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center;
    border-radius: var(--radius-xl); background: var(--accent-soft); color: var(--ink); font-size: 18px;
  }
  .title h2 { margin: 0; font-size: var(--text-lg); line-height: var(--leading-tight); font-weight: var(--weight-strong); letter-spacing: var(--tracking-tight); }
  .title p { margin: 2px 0 0; font-size: var(--text-xs); line-height: 1.3; color: var(--ink-3); }
  .spacer { flex: 1 1 auto; }
  .close {
    width: var(--control-md); height: var(--control-md); display: inline-flex; align-items: center; justify-content: center;
    border: 0; border-radius: var(--radius-lg); background: transparent; color: var(--ink-4); font-size: 16px; cursor: pointer;
    transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease;
  }
  .close:hover { background: var(--fill-hover); color: var(--ink); }

  /* Papier BLANC et encre noire dans les deux thèmes : c'est ce que la signature sera
     une fois posée sur une page, pas un élément d'interface à assombrir. */
  .paper { position: relative; margin: 0 16px; border-radius: var(--radius-xl); background: #fff; box-shadow: inset 0 0 0 1px var(--elevation-ring); }
  .paper svg {
    display: block; width: 100%; aspect-ratio: 5 / 2;
    cursor: crosshair;
    /* Sans ceci, le doigt fait défiler ou zoomer au lieu de tracer. */
    touch-action: none;
    user-select: none;
  }
  .paper path { fill: none; stroke: #000; stroke-linecap: round; stroke-linejoin: round; }
  .baseline { stroke: #c9c9c9; stroke-width: 1; stroke-dasharray: 4 5; }
  .placeholder {
    position: absolute; left: 0; right: 0; top: 34%;
    text-align: center; font-size: var(--text-lg); color: #b5b5b5; pointer-events: none;
  }

  .thickness { display: flex; align-items: center; gap: 4px; padding: 10px 16px 0; font-size: var(--text-xs); color: var(--ink-3); }
  .thickness > span { margin-right: 6px; }
  .thickness button {
    width: 44px; height: var(--control-md); display: inline-flex; align-items: center; justify-content: center;
    border: 0; border-radius: var(--radius-lg); background: transparent; cursor: pointer;
    transition: background-color var(--duration-basic) ease;
  }
  .thickness button:hover { background: var(--fill-hover); }
  .thickness button.selected { background: var(--accent-soft); }
  .thickness .sample { width: 24px; border-radius: var(--radius-full); background: var(--ink); }

  footer { display: flex; align-items: center; gap: 8px; padding: 12px 16px; }
  footer small { font-size: var(--text-xs); color: var(--ink-3); }
  footer button {
    display: inline-flex; align-items: center; justify-content: center;
    height: var(--control-md); padding: 0 12px; border: 0; border-radius: var(--radius-lg);
    font: inherit; font-size: var(--text-sm); font-weight: var(--weight-control); cursor: pointer;
    transition: background-color var(--duration-basic) ease, transform var(--duration-basic) var(--ease-enter-snappy);
  }
  footer button:disabled { opacity: var(--opacity-disabled); cursor: default; }
  footer button:not(:disabled):active { transform: scale(0.97); }
  footer .primary { background: var(--ink); color: var(--cream-content); }
  footer .primary:hover:not(:disabled) { background: var(--ink-2); }
  footer .secondary { background: var(--accent-soft); color: var(--ink); }
  footer .secondary:hover:not(:disabled) { background: var(--fill-pressed); }
</style>
