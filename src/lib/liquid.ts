// Matière « liquide » (refonte v2, façon flow tab bar / Dynamic Island) sans WebGL : une pastille
// qui change d'option ne glisse pas d'un bloc, son bord AVANT part d'abord (elle s'étire en
// goutte et s'affine), puis le bord arrière la rattrape sur un ressort qui dépasse un peu.
// Animation par WAAPI sur `translate`/`width`/`scale` d'un élément absolu : la mise en page ne
// touche que lui. Mouvement réduit = pose sèche.

export type Span = { x: number; w: number }

export const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

const SPRING = 'linear(0, 0.052, 0.173, 0.328, 0.49, 0.642, 0.774, 0.88, 0.96, 1.016, 1.051, 1.069, 1.074, 1.071, 1.062, 1.051, 1.039, 1.027, 1.017, 1.009, 1.003, 0.999, 0.996, 0.995, 1)'

// Images clés d'un trajet : 0 → étirement (le bord avant est arrivé, la goutte s'affine) → cible.
export function stretchKeyframes(from: Span, to: Span, axis: 'x' | 'y' = 'x'): Keyframe[] {
  // À l'étirement, le bord avant a fait 85 % de son trajet (la goutte a encore de l'élan), le
  // bord arrière 10 % seulement.
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t
  const forward = to.x >= from.x
  const left = lerp(from.x, to.x, forward ? 0.1 : 0.85)
  const right = lerp(from.x + from.w, to.x + to.w, forward ? 0.85 : 0.1)
  const midX = left
  const span = right - left
  const move = (x: number) => (axis === 'x' ? `${x}px 0` : `0 ${x}px`)
  const size = axis === 'x' ? 'width' : 'height'
  const thin = axis === 'x' ? '1 0.84' : '0.84 1'
  return [
    { translate: move(from.x), [size]: `${from.w}px`, scale: '1 1', easing: 'cubic-bezier(.35, 0, .25, 1)' },
    { offset: 0.38, translate: move(midX), [size]: `${span}px`, scale: thin, easing: SPRING },
    { translate: move(to.x), [size]: `${to.w}px`, scale: '1 1' },
  ]
}

// Pose (ou anime) une pastille absolue vers une option. `current` permet d'interrompre un trajet
// en cours sans saut : on repart de là où la pastille EST, pas d'où elle partait.
export function moveLiquid(
  thumb: HTMLElement,
  to: Span,
  options: { animate?: boolean; axis?: 'x' | 'y'; duration?: number } = {},
): void {
  const axis = options.axis ?? 'x'
  const size = axis === 'x' ? 'width' : 'height'
  const running = thumb.getAnimations().filter((animation) => animation.id === 'liquid')
  const rect = thumb.getBoundingClientRect()
  const parent = thumb.offsetParent?.getBoundingClientRect()
  const from: Span | null = parent && rect.width > 0
    ? axis === 'x'
      ? { x: rect.left - parent.left - (thumb.offsetParent as HTMLElement).clientLeft + (thumb.offsetParent as HTMLElement).scrollLeft, w: rect.width }
      : { x: rect.top - parent.top - (thumb.offsetParent as HTMLElement).clientTop + (thumb.offsetParent as HTMLElement).scrollTop, w: rect.height }
    : null
  for (const animation of running) animation.cancel()
  thumb.style.translate = axis === 'x' ? `${to.x}px 0` : `0 ${to.x}px`
  thumb.style[size] = `${to.w}px`
  const still = !from || Math.abs(from.x - to.x) < 0.5 && Math.abs(from.w - to.w) < 0.5
  if (still || options.animate === false || prefersReducedMotion()) return
  const animation = thumb.animate(stretchKeyframes(from, to, axis), {
    duration: options.duration ?? 520,
    easing: 'linear',
  })
  animation.id = 'liquid'
}

const ACTIVE = '[aria-pressed="true"], [aria-selected="true"], [aria-checked="true"]'

// Action Svelte : `use:liquidThumb` sur un conteneur POSITIONNÉ qui porte une pastille
// `[data-liquid-thumb]` (position absolue, left/top 0) et des options marquées par
// aria-pressed / aria-selected / aria-checked. La première pose est sèche.
// `instant()` rendu vrai (navigation clavier, par ex.) coupe l'animation au coup par coup.
export function liquidThumb(
  node: HTMLElement,
  params: { axis?: 'x' | 'y'; instant?: () => boolean } = {},
) {
  let settings = params
  let ready = false
  const place = () => {
    const thumb = node.querySelector<HTMLElement>('[data-liquid-thumb]')
    const active = node.querySelector<HTMLElement>(ACTIVE)
    if (!thumb) return
    if (!active) {
      thumb.style.opacity = '0'
      return
    }
    thumb.style.opacity = ''
    const axis = settings.axis ?? 'x'
    const to = axis === 'x'
      ? { x: active.offsetLeft, w: active.offsetWidth }
      : { x: active.offsetTop, w: active.offsetHeight }
    moveLiquid(thumb, to, { axis, animate: ready && !settings.instant?.() })
  }
  place()
  const frame = requestAnimationFrame(() => (ready = true))
  // Redimensionnement : pose sèche (une goutte qui ondule quand on tire la fenêtre fatigue).
  const resize = new ResizeObserver(() => {
    const was = ready
    ready = false
    place()
    ready = was
  })
  resize.observe(node)
  // Jamais la pastille elle-même : son étirement relancerait une pose sèche qui annule le trajet.
  for (const child of node.children) if (!child.hasAttribute('data-liquid-thumb')) resize.observe(child)
  const mutation = new MutationObserver(place)
  mutation.observe(node, { subtree: true, attributes: true, attributeFilter: ['aria-pressed', 'aria-selected', 'aria-checked'] })
  return {
    update(next: typeof params) { settings = next },
    destroy() {
      cancelAnimationFrame(frame)
      resize.disconnect()
      mutation.disconnect()
    },
  }
}
