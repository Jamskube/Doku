// Bulle d'aide partagée (Kube Tooltip) : remplace le `title` natif des boutons à icône seule,
// qui arrive après ~500 ms dans le style de l'OS, jamais au clavier, et met le raccourci entre
// parenthèses. Une seule bulle pour toute la fenêtre : 200 ms de délai au survol, puis ouverture
// immédiate pendant 300 ms après la fermeture d'une autre (on balaie une barre libellé par
// libellé), immédiate aussi au focus clavier, jamais au doigt ni au stylet.
import type { ActionReturn } from 'svelte/action'

export interface TooltipOptions {
  label: string
  /** Raccourci affiché dans une puce, écrit « Ctrl+Maj+E ». */
  kbd?: string
}
export type TooltipParam = string | TooltipOptions | null | undefined

export const OPEN_DELAY = 200
export const SKIP_WINDOW = 300

export interface Box { left: number; top: number; width: number; height: number }

/** Au-dessus du déclencheur, centrée ; dessous si la place manque en haut ; toujours à `pad` des bords. */
export function placeTooltip(
  anchor: Box,
  bubble: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 5,
  pad = 8,
): { left: number; top: number; side: 'top' | 'bottom' } {
  const roomAbove = anchor.top - gap - pad
  const roomBelow = viewport.height - anchor.top - anchor.height - gap - pad
  const side = bubble.height <= roomAbove || roomAbove >= roomBelow ? 'top' : 'bottom'
  const rawTop = side === 'top' ? anchor.top - gap - bubble.height : anchor.top + anchor.height + gap
  const top = Math.max(pad, Math.min(rawTop, viewport.height - pad - bubble.height))
  const centered = anchor.left + anchor.width / 2 - bubble.width / 2
  const left = Math.max(pad, Math.min(centered, viewport.width - pad - bubble.width))
  return { left, top, side }
}

const STYLE = `
.doku-tooltip {
  position: fixed; inset: auto; margin: 0; z-index: 90;
  box-sizing: border-box; width: max-content; max-width: min(320px, 100vw - 16px);
  padding: 4px 8px; border: 0; border-radius: var(--radius-md);
  background: var(--tooltip-bg); color: var(--on-tooltip); box-shadow: var(--shadow-lg);
  font: var(--weight-control) var(--text-xs)/16px var(--font-sans);
  text-align: center; overflow-wrap: break-word; overflow: visible; pointer-events: none;
}
.doku-tooltip[data-fade] { animation: doku-fade-in 120ms var(--ease-enter-snappy); }
.doku-tooltip-row { display: flex; align-items: center; gap: 6px; }
.doku-tooltip-kbd {
  flex: none; margin-right: -4px; padding: 0 5px; border-radius: var(--radius-xs);
  background: color-mix(in srgb, var(--on-tooltip) 25%, transparent);
  font: inherit; white-space: nowrap;
}`

interface Entry { node: HTMLElement; opts: TooltipOptions }

let bubble: HTMLElement | null = null
let current: Entry | null = null
let timer: ReturnType<typeof setTimeout> | undefined
// Nœud dont `timer` porte l'ouverture : un départ ailleurs ne doit pas l'annuler.
let pending: HTMLElement | null = null
let lastClose = -Infinity
// Déclencheur cliqué : sa bulle reste fermée jusqu'au départ du pointeur.
let suppressed: HTMLElement | null = null
let listening = false

function ensureBubble(): HTMLElement {
  if (bubble?.isConnected) return bubble
  if (!document.getElementById('doku-tooltip-style')) {
    const style = document.createElement('style')
    style.id = 'doku-tooltip-style'
    style.textContent = STYLE
    document.head.appendChild(style)
  }
  bubble = document.createElement('div')
  bubble.id = 'doku-tooltip'
  bubble.className = 'doku-tooltip'
  bubble.setAttribute('role', 'tooltip')
  bubble.hidden = true
  // Couche supérieure : échappe aux conteneurs qui rognent et passe au-dessus des dialogues.
  if (typeof bubble.showPopover === 'function') bubble.setAttribute('popover', 'manual')
  document.body.appendChild(bubble)
  return bubble
}

function describedBy(node: HTMLElement, add: string | null) {
  const ids = (node.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((id) => id && !id.startsWith('doku-tooltip'))
  if (add) ids.push(add)
  if (ids.length) node.setAttribute('aria-describedby', ids.join(' '))
  else node.removeAttribute('aria-describedby')
}

function render(entry: Entry, el: HTMLElement) {
  el.textContent = ''
  const { label, kbd } = entry.opts
  if (kbd) {
    const row = document.createElement('span')
    row.className = 'doku-tooltip-row'
    const text = document.createElement('span')
    text.textContent = label
    const chip = document.createElement('kbd')
    chip.id = 'doku-tooltip-kbd'
    chip.className = 'doku-tooltip-kbd'
    chip.textContent = kbd
    row.append(text, chip)
    el.appendChild(row)
  } else {
    el.textContent = label
  }
  // Le lecteur d'écran lit déjà le nom du bouton : la bulle ne le décrit que si elle apporte
  // autre chose (libellé absent du nom, ou la seule puce de raccourci).
  const name = (entry.node.getAttribute('aria-label') ?? entry.node.textContent ?? '').toLocaleLowerCase()
  describedBy(entry.node, !name.includes(label.toLocaleLowerCase()) ? el.id : kbd ? 'doku-tooltip-kbd' : null)
}

function show(entry: Entry, instant: boolean) {
  clearTimeout(timer)
  const { node } = entry
  if (!node.isConnected || node.getAttribute('aria-expanded') === 'true' || node.matches(':disabled')) return
  if (current && current.node !== node) hide(true)
  const el = ensureBubble()
  current = entry
  render(entry, el)
  el.toggleAttribute('data-fade', !instant)
  el.hidden = false
  if (el.hasAttribute('popover') && !el.matches(':popover-open')) el.showPopover()
  const pos = placeTooltip(node.getBoundingClientRect(), el.getBoundingClientRect(), { width: innerWidth, height: innerHeight })
  el.style.left = `${pos.left}px`
  el.style.top = `${pos.top}px`
}

/** Ferme la bulle ouverte, s'il y en a une. `switching` : une autre prend sa place, sans fenêtre de 300 ms. */
export function hideTooltip(switching = false) {
  clearTimeout(timer)
  if (!current) return
  describedBy(current.node, null)
  current = null
  if (!switching) lastClose = Date.now()
  if (!bubble) return
  if (bubble.hasAttribute('popover') && bubble.matches(':popover-open')) bubble.hidePopover()
  bubble.hidden = true
}
const hide = hideTooltip

function schedule(entry: Entry, delay: number) {
  clearTimeout(timer)
  if (current?.node === entry.node) return
  if (delay <= 0 || current || Date.now() - lastClose < SKIP_WINDOW) show(entry, true)
  else {
    pending = entry.node
    timer = setTimeout(() => show(entry, false), delay)
  }
}

function listenGlobally() {
  if (listening) return
  listening = true
  const close = () => hide()
  // Échap ferme sans être consommé : un dialogue ou un mode derrière la bulle reçoit la touche.
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close() }, true)
  // Seul le défilement qui emporte le déclencheur ferme : un fil qui défile seul ailleurs
  // (réponse du copilote en cours) ne doit pas éteindre chaque bulle à peine ouverte.
  window.addEventListener('scroll', (e) => {
    const target = e.target
    if (current && (target === document || (target instanceof Node && target.contains(current.node)))) close()
  }, { capture: true, passive: true })
  window.addEventListener('blur', close)
}

function normalize(param: TooltipParam): TooltipOptions {
  if (!param) return { label: '' }
  return typeof param === 'string' ? { label: param } : param
}

/** `use:tooltip={'Fermer'}` ou `use:tooltip={{ label: 'Rechercher', kbd: 'Ctrl+Maj+F' }}`. */
export function tooltip(node: HTMLElement, param: TooltipParam): ActionReturn<TooltipParam> {
  listenGlobally()
  const entry: Entry = { node, opts: normalize(param) }
  const active = () => entry.opts.label !== ''
  const cancel = () => { if (pending === node) clearTimeout(timer); if (current?.node === node) hide() }

  const onEnter = (e: PointerEvent) => {
    // Rien au doigt ni au stylet, ni pendant un glisser (bouton tenu).
    if (e.pointerType !== 'mouse' || e.buttons !== 0 || suppressed === node || !active()) return
    schedule(entry, OPEN_DELAY)
  }
  const onLeave = () => { if (suppressed === node) suppressed = null; cancel() }
  const onFocus = () => {
    let keyboard = false
    try { keyboard = node.matches(':focus-visible') } catch { /* moteur sans :focus-visible */ }
    if (keyboard && active()) schedule(entry, 0)
  }
  const onBlur = () => { if (suppressed === node) suppressed = null; cancel() }
  const onPress = () => { suppressed = node; cancel() }

  node.addEventListener('pointerenter', onEnter)
  node.addEventListener('pointerleave', onLeave)
  node.addEventListener('focusin', onFocus)
  node.addEventListener('focusout', onBlur)
  node.addEventListener('pointerdown', onPress)
  node.addEventListener('click', onPress)
  node.addEventListener('contextmenu', cancel)

  return {
    update(next) {
      entry.opts = normalize(next)
      if (current?.node !== node || !bubble) return
      if (active()) render(entry, bubble)
      else hide()
    },
    destroy() {
      cancel()
      if (suppressed === node) suppressed = null
      node.removeEventListener('pointerenter', onEnter)
      node.removeEventListener('pointerleave', onLeave)
      node.removeEventListener('focusin', onFocus)
      node.removeEventListener('focusout', onBlur)
      node.removeEventListener('pointerdown', onPress)
      node.removeEventListener('click', onPress)
      node.removeEventListener('contextmenu', cancel)
    },
  }
}
