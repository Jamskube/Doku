// Révélation du flux de Doku-San : seul le texte NOUVEAU sort d'un léger flou, lettre par lettre.
// Le texte déjà posé redevient un nœud texte nu dès la fin de son entrée — rien n'est ré-animé,
// et le flux reste du texte brut (le Markdown n'est rendu qu'à la fin, un parse par jeton sort
// du budget).

/** Texte à ajouter à l'écran ; `null` quand le contenu n'est plus un prolongement. */
export function revealDelta(shown: string, next: string): string | null {
  return next.startsWith(shown) ? next.slice(shown.length) : null
}

export const REVEAL_CLASS = 'cop-reveal'

// Cadence (façon Kube, qui découple l'arrivée réseau de l'écriture) : le modèle livre par paquets
// irréguliers, l'écran écrit au moins MIN_CPS caractères/s, et accélère pour que le retard sur le
// flux reste sous LAG_MS — un long paquet s'écoule plus vite, jamais d'un bloc.
const MIN_CPS = 60
const LAG_MS = 700

/** Caractères à poser pour `dt` ms écoulées avec `pending` en attente (`carry` = reliquat). */
export function revealBudget(pending: number, dt: number, carry = 0): { count: number; carry: number } {
  if (pending <= 0) return { count: 0, carry: 0 }
  const cps = Math.max(MIN_CPS, (pending * 1000) / LAG_MS)
  const exact = carry + (cps * dt) / 1000
  const count = Math.min(pending, Math.floor(exact))
  return { count, carry: count === pending ? 0 : exact - count }
}

/**
 * Action Svelte : `use:streamReveal={content}`. L'élément lui appartient (pas d'enfant Svelte).
 * Le contenu présent au montage s'affiche sans animation : rouvrir une vue en plein flux ne
 * rejoue rien. Le texte nouveau entre en file ; chaque image pose ses quelques lettres dans un
 * span `REVEAL_CLASS` (animé par le CSS de l'hôte), rendu au texte nu à la fin de son entrée.
 * L'élément émet `revealstart` quand l'écriture reprend et `revealend` quand elle a rattrapé le flux.
 */
export function streamReveal(node: HTMLElement, content: string) {
  let target = content
  let shown = content
  let carry = 0
  let frame = 0
  let last = 0
  node.textContent = content

  const settle = (event: Event) => {
    const span = event.target
    if (!(span instanceof HTMLElement) || span.parentNode !== node) return
    span.replaceWith(span.textContent ?? '')
    if (!node.querySelector(`.${REVEAL_CLASS}`)) node.normalize()
  }
  node.addEventListener('animationend', settle)
  node.addEventListener('animationcancel', settle)

  const tick = (now: number) => {
    frame = 0
    const dt = last ? Math.min(now - last, 100) : 16
    last = now
    const budget = revealBudget(target.length - shown.length, dt, carry)
    carry = budget.carry
    if (budget.count) {
      let end = shown.length + budget.count
      // Jamais de coupure au milieu d'une paire de substitution (emoji).
      const code = target.charCodeAt(end - 1)
      if (code >= 0xd800 && code <= 0xdbff && end < target.length) end++
      const span = node.ownerDocument.createElement('span')
      span.className = REVEAL_CLASS
      span.textContent = target.slice(shown.length, end)
      node.append(span)
      shown = target.slice(0, end)
    }
    if (shown.length < target.length) frame = requestAnimationFrame(tick)
    else {
      last = 0
      node.dispatchEvent(new Event('revealend'))
    }
  }

  return {
    update(next: string) {
      if (revealDelta(target, next) === null) {
        if (frame) cancelAnimationFrame(frame)
        frame = last = carry = 0
        target = shown = next
        node.textContent = next
        node.dispatchEvent(new Event('revealend'))
        return
      }
      target = next
      // Repartir d'une file vide : la première lettre sort dès l'image suivante.
      if (!frame && shown.length < target.length) {
        carry = Math.max(carry, 1)
        node.dispatchEvent(new Event('revealstart'))
        frame = requestAnimationFrame(tick)
      }
    },
    destroy() {
      if (frame) cancelAnimationFrame(frame)
      node.removeEventListener('animationend', settle)
      node.removeEventListener('animationcancel', settle)
    },
  }
}

// Projection « texte propre » d'un Markdown en cours d'écriture : ni `**`, ni `#`, ni backticks à
// l'écran pendant le flux ; le rendu Markdown complet ne vient qu'à la fin. Elle reste un
// PROLONGEMENT d'une écriture à l'autre (sinon streamReveal repartirait d'un bloc) : un début de
// ligne encore ambigu (« * » : puce ou gras ? « ## » : titre ?) est retenu jusqu'au caractère suivant.
const HELD_LINE_START = /^\s*(?:[-*+]|#{1,6}|>)$/
const FENCE = /^\s*`{3,}/
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/

export function plainMarkdown(md: string): string {
  const lines = md.split('\n')
  return lines
    .map((line, i) => {
      if (i === lines.length - 1 && HELD_LINE_START.test(line)) return line.match(/^\s*/)![0]
      if (FENCE.test(line) || RULE.test(line)) return ''
      return line
        .replace(/^(\s*)#{1,6}\s+/, '$1')
        .replace(/^(\s*)>\s?/, '$1')
        .replace(/^(\s*)[-*+]\s+/, '$1• ')
        .replace(/\*+|`+/g, '')
    })
    .join('\n')
}
