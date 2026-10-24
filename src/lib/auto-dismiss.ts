// Auto-effacement des notifications. Une notification transitoire qui attend un clic
// n'est plus une notification : c'est une tâche de plus pour l'utilisateur. Doku en
// affiche à trois endroits (bandeau de l'app, mémoire mise à jour, mémoire
// indisponible) et aucun ne s'effaçait seul.
//
// Le compte à rebours se SUSPEND au survol, au focus clavier, et tant que la fenêtre n'a
// pas le focus ou est masquée (mode veille, autre application devant) : sans ça, un
// message disparaît pendant qu'on le lit, ou avant même d'avoir été vu.
import type { NoticeTone } from './stores.svelte'

// Durées par ton. Un succès n'a qu'à confirmer. Une erreur ne part JAMAIS seule (0) :
// elle attend d'être fermée, comme le Toast de Kube — une cause effacée avant d'être lue
// coûte un aller-retour avec l'utilisateur.
export const NOTICE_DELAY: Record<NoticeTone, number> = {
  success: 5_000,
  warning: 8_000,
  error: 0,
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

/** Un délai nul ou négatif veut dire « persistante » : le minuteur ne s'arme jamais. */
export function startDismissTimer(
  delay: number,
  onDismiss: () => void,
  clock: DismissClock = CLOCK_PAR_DEFAUT,
): DismissTimer {
  const persistante = delay <= 0
  let restant = Math.max(0, delay)
  let debut = clock.now()
  let id: number | null = null
  let fini = false

  const armer = () => {
    if (persistante || fini || id !== null) return
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
    remaining: () => (persistante && !fini ? Infinity : fini ? 0 : id === null ? restant : Math.max(0, restant - (clock.now() - debut))),
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
 *
 * Pendant la suspension, l'élément porte `data-paused` : c'est l'UNIQUE signal que le CSS
 * doit suivre pour figer son filet de vie. Un `:hover` CSS divergerait au doigt, où le
 * survol reste collé après le toucher alors que le compte à rebours a repris.
 */
export function autoDismiss(
  node: HTMLElement,
  params: AutoDismissParams,
): { update(p: AutoDismissParams): void; destroy(): void } {
  let courant = params
  let timer = startDismissTimer(courant.delay, () => courant.onDismiss())

  // Survol, focus et fenêtre absente suspendent : lever l'un ne reprend pas tant
  // qu'un autre tient.
  let hovered = false
  let focused = false
  const away = () => document.visibilityState === 'hidden' || !document.hasFocus()
  const sync = () => {
    if (hovered || focused || away()) {
      timer.pause()
      node.dataset.paused = ''
    } else {
      timer.resume()
      delete node.dataset.paused
    }
  }
  const pointerEnter = () => { hovered = true; sync() }
  const pointerLeave = () => { hovered = false; sync() }
  const focusIn = () => { focused = true; sync() }
  const focusOut = (e: FocusEvent) => {
    // Le focus qui passe d'un bouton à l'autre DANS la notification ne la relâche pas.
    focused = node.contains(e.relatedTarget as Node | null)
    sync()
  }
  node.addEventListener('pointerenter', pointerEnter)
  node.addEventListener('pointerleave', pointerLeave)
  node.addEventListener('focusin', focusIn)
  node.addEventListener('focusout', focusOut)
  window.addEventListener('blur', sync)
  window.addEventListener('focus', sync)
  document.addEventListener('visibilitychange', sync)
  // Une notification née fenêtre masquée part suspendue.
  sync()

  return {
    update(p) {
      const nouvelle = p.key !== courant.key || p.delay !== courant.delay
      courant = p
      // Un simple changement de rappel ne doit pas rallonger la vie de la notification
      // affichée ; une notification NEUVE, si.
      if (nouvelle) {
        timer.stop()
        timer = startDismissTimer(p.delay, () => courant.onDismiss())
        sync()
      }
    },
    destroy() {
      timer.stop()
      node.removeEventListener('pointerenter', pointerEnter)
      node.removeEventListener('pointerleave', pointerLeave)
      node.removeEventListener('focusin', focusIn)
      node.removeEventListener('focusout', focusOut)
      window.removeEventListener('blur', sync)
      window.removeEventListener('focus', sync)
      document.removeEventListener('visibilitychange', sync)
    },
  }
}
