import { tick } from 'svelte'

type TransitionDocument = Document & {
  startViewTransition?: (update: () => Promise<void>) => { ready: Promise<void> }
}

/**
 * Applique un changement de thème en le révélant en cercle depuis `origin` (centre du
 * contrôle cliqué ; à défaut, centre de la fenêtre). Sans View Transitions ou en
 * mouvement réduit : application immédiate. Le fondu croisé par défaut est coupé dans
 * app.css ; seul le nouvel instantané est animé, par clip-path.
 */
export function revealTheme(apply: () => void, origin?: { x: number; y: number } | null): void {
  const doc = document as TransitionDocument
  if (!doc.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    apply()
    return
  }
  const x = origin?.x ?? innerWidth / 2
  const y = origin?.y ?? innerHeight / 2
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
  // `tick` : l'instantané « après » doit inclure le DOM que Svelte met à jour (contrôle actif).
  const transition = doc.startViewTransition(async () => {
    apply()
    await tick()
  })
  transition.ready
    .then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 400, easing: 'cubic-bezier(.2, 0, 0, 1)', pseudoElement: '::view-transition-new(root)' },
      )
    })
    .catch(() => {})
}

/** Centre d'un élément cliqué ; null au clavier (`detail === 0`), la révélation part alors du centre. */
export function revealOrigin(event: MouseEvent): { x: number; y: number } | null {
  if (event.detail === 0) return null
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}
