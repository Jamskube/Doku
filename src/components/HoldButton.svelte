<script lang="ts">
  // Action destructive à confirmer en MAINTENANT l'appui (motif hold-to-confirm) : un
  // clic égaré ne suffit plus. Le remplissage avance en ligne droite pendant `duration`,
  // recule vite au relâchement. Pointeur capturé ; s'éloigner de plus de 8 px annule.
  // Au clavier : maintenir Entrée ou Espace. Mouvement réduit : l'appui reste exigé, le
  // remplissage se fond au lieu de balayer.
  let { label, holdLabel, actionName, icon, duration = 1200, role, onconfirm }: {
    /** Libellé visible au repos : il dit le geste (« Maintenir pour… »). */
    label: string
    holdLabel: string
    /** Nom de l'action pour les lecteurs d'écran (« Oublier ma signature »). */
    actionName: string
    icon: string
    duration?: number
    role?: 'menuitem'
    onconfirm: () => void
  } = $props()

  const CANCEL_DISTANCE = 8

  let holding = $state(false)
  let feedback = $state('')
  let timer: ReturnType<typeof setTimeout> | undefined
  let origin: { x: number; y: number } | null = null

  function start() {
    if (holding) return
    holding = true
    feedback = 'Maintenez…'
    timer = setTimeout(() => {
      holding = false
      origin = null
      feedback = ''
      onconfirm()
    }, duration)
  }

  function cancel() {
    if (!holding) return
    clearTimeout(timer)
    holding = false
    origin = null
    feedback = 'Relâché trop tôt : rien n’a été effacé.'
  }

  $effect(() => () => clearTimeout(timer))
</script>

<button
  class="hold"
  class:holding
  type="button"
  {role}
  style:--hold-ms="{duration}ms"
  aria-label="{actionName}, maintenir pour confirmer"
  onpointerdown={(event) => {
    if (event.button !== 0) return
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* capture refusée hors geste natif */ }
    origin = { x: event.clientX, y: event.clientY }
    start()
  }}
  onpointermove={(event) => {
    if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > CANCEL_DISTANCE) cancel()
  }}
  onpointerup={cancel}
  onpointercancel={cancel}
  onlostpointercapture={cancel}
  onkeydown={(event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    // Sans ceci, Entrée déclencherait un clic, et l'appui long répéterait la touche.
    event.preventDefault()
    if (!event.repeat) start()
  }}
  onkeyup={(event) => { if (event.key === 'Enter' || event.key === ' ') cancel() }}
  onblur={cancel}
  oncontextmenu={(event) => event.preventDefault()}
>
  <svg class="icon" aria-hidden="true"><use href="#i-{icon}" /></svg>
  <span>{holding ? holdLabel : label}</span>
  <span class="fill" aria-hidden="true"></span>
  <span class="sr" aria-live="polite">{feedback}</span>
</button>

<style>
  .hold {
    position: relative;
    width: 100%;
    height: var(--control-md);
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 8px;
    overflow: hidden;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--danger-action-text);
    font: var(--weight-control) var(--text-sm) / 1 var(--font-sans);
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
    user-select: none;
    /* Au doigt ou au stylet, l'appui long ouvrirait sinon le menu de WebView2. */
    -webkit-touch-callout: none;
    touch-action: none;
  }
  .hold:hover { background: var(--menu-row-hover); }
  .hold:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
  .hold .icon { flex: none; font-size: 16px; }
  .hold > span:nth-of-type(1) { flex: 1; }
  /* Recul rapide au relâchement, avance LINÉAIRE pendant l'appui : la barre dit le temps
     qui reste, une courbe le fausserait. */
  .fill {
    position: absolute;
    inset: 0;
    background: color-mix(in srgb, var(--danger-action) 16%, transparent);
    clip-path: inset(0 100% 0 0);
    pointer-events: none;
    transition: clip-path 180ms var(--ease-enter-snappy);
  }
  .holding .fill {
    clip-path: inset(0);
    transition: clip-path var(--hold-ms) linear;
  }
  /* La règle globale coupe `clip-path` mais garde `opacity` : le remplissage se fond
     alors sur la même durée, sans balayage. */
  @media (prefers-reduced-motion: reduce) {
    .fill { clip-path: inset(0); opacity: 0; transition: opacity 180ms ease; }
    .holding .fill { clip-path: inset(0); opacity: 1; transition: opacity var(--hold-ms) linear; }
  }
  :global(:where(:root[data-input='touch'])) .hold { height: 44px; }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
