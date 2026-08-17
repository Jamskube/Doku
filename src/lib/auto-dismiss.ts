// Auto-effacement des notifications. Une notification transitoire qui attend un clic
// n'est plus une notification : c'est une tâche de plus pour l'utilisateur. Doku en
// affiche à trois endroits (bandeau de l'app, mémoire mise à jour, mémoire
// indisponible) et aucun ne s'effaçait seul.
//
// Le compte à rebours se SUSPEND au survol et au focus clavier : sans ça, un message
// long disparaît pendant qu'on le lit — et c'est le reproche que fait naître un
// auto-effacement mal réglé, pas l'auto-effacement lui-même.
import type { NoticeTone } from './stores.svelte'

// Durées par ton. Un succès n'a qu'à confirmer ; une erreur doit laisser le temps de
// lire une phrase entière avant de partir.
export const NOTICE_DELAY: Record<NoticeTone, number> = {
  success: 5_000,
  warning: 8_000,
  error: 10_000,
}

export interface DismissTimer {
  /** Suspend le compte à rebours (survol, focus). Idempotent. */
  pause(): void
  /** Reprend sur le temps RESTANT, pas sur le délai complet. Idempotent. */
  resume(): void
  /** Annule définitivement (notification remplacée ou fermée à la main). */
  stop(): void
  /** Millisecondes restantes — pour les tests et l'indicateur de progression. */
  remaining(): number
}

export interface DismissClock {
  setTimeout: (fn: () => void, ms: number) => number
  clearTimeout: (id: number) => void
  now: () => number
}

const CLOCK_PAR_DEFAUT: DismissClock = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms) as unknown as number,
  clearTimeout: (id) => globalThis.clearTimeout(id),
  now: () => globalThis.performance?.now?.() ?? Date.now(),
}

export function startDismissTimer(
  delay: number,
  onDismiss: () => void,
  clock: DismissClock = CLOCK_PAR_DEFAUT,
): DismissTimer {
  let restant = Math.max(0, delay)
  let debut = clock.now()
  let id: number | null = null
  let fini = false

  const armer = () => {
    if (fini || id !== null) return
    debut = clock.now()
    id = clock.setTimeout(() => {
      id = null
      fini = true
      onDismiss()
    }, restant)
  }

  const desarmer = () => {
    if (id === null) return
    clock.clearTimeout(id)
    id = null
    // Ce qui a déjà coulé ne recommence pas : c'est ce qui distingue une suspension
    // d'une remise à zéro.
    restant = Math.max(0, restant - (clock.now() - debut))
  }

  armer()

  return {
    pause: desarmer,
    resume: armer,
    stop() {
      desarmer()
      fini = true
    },
    remaining: () => (fini ? 0 : id === null ? restant : Math.max(0, restant - (clock.now() - debut))),
  }
}

export interface AutoDismissParams {
  delay: number
  onDismiss: () => void
  /**
   * Identité de la notification affichée. Svelte REMPLOIE le même élément quand une
   * notification en chasse une autre : sans cette clé, la seconde hériterait du compte
   * à rebours déjà bien entamé de la première et ne s'afficherait qu'un instant.
   * L'objet de notification lui-même fait une clé naturelle (chaque affectation en crée
   * un neuf).
   */
  key?: unknown
}

/**
 * Action Svelte : `use:autoDismiss={{ delay, key, onDismiss }}`.
 *
 * Le compte à rebours suit la VIE de l'élément — il part au montage, s'arrête au
 * démontage — donc une notification retirée ne laisse jamais un timer orphelin qui
 * viendrait effacer la suivante.
 */
export function autoDismiss(
  node: HTMLElement,
  params: AutoDismissParams,
): { update(p: AutoDismissParams): void; destroy(): void } {
  let courant = params
  let timer = startDismissTimer(courant.delay, () => courant.onDismiss())

  const pause = () => timer.pause()
  const resume = () => timer.resume()
  node.addEventListener('pointerenter', pause)
  node.addEventListener('pointerleave', resume)
  node.addEventListener('focusin', pause)
  node.addEventListener('focusout', resume)

  return {
    update(p) {
      const nouvelle = p.key !== courant.key || p.delay !== courant.delay
      courant = p
      // Un simple changement de rappel ne doit pas rallonger la vie de la notification
      // affichée ; une notification NEUVE, si.
      if (nouvelle) {
        timer.stop()
        timer = startDismissTimer(p.delay, () => courant.onDismiss())
      }
    },
    destroy() {
      timer.stop()
      node.removeEventListener('pointerenter', pause)
      node.removeEventListener('pointerleave', resume)
      node.removeEventListener('focusin', pause)
      node.removeEventListener('focusout', resume)
    },
  }
}
