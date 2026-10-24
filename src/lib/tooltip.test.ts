// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hideTooltip, OPEN_DELAY, placeTooltip, SKIP_WINDOW, tooltip } from './tooltip'

function pointer(type: string, init: { pointerType?: string; buttons?: number } = {}) {
  const e = new MouseEvent(type, { bubbles: false, buttons: init.buttons ?? 0 })
  Object.defineProperty(e, 'pointerType', { value: init.pointerType ?? 'mouse' })
  return e
}

function button(label: string, ariaLabel = label) {
  const b = document.createElement('button')
  b.setAttribute('aria-label', ariaLabel)
  document.body.appendChild(b)
  return b
}

const bubble = () => document.getElementById('doku-tooltip')
const shown = () => !!bubble() && !bubble()!.hidden

describe('tooltip', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    hideTooltip()
    vi.advanceTimersByTime(SKIP_WINDOW + 1)
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('s’ouvre après 200 ms de survol à la souris et se ferme au départ du pointeur', () => {
    const b = button('Fermer')
    tooltip(b, 'Fermer')
    b.dispatchEvent(pointer('pointerenter'))
    vi.advanceTimersByTime(OPEN_DELAY - 1)
    expect(shown()).toBe(false)
    vi.advanceTimersByTime(1)
    expect(shown()).toBe(true)
    expect(bubble()!.textContent).toBe('Fermer')
    expect(bubble()!.hasAttribute('data-fade')).toBe(true)
    b.dispatchEvent(pointer('pointerleave'))
    expect(shown()).toBe(false)
  })

  it('ouvre la suivante sans délai ni fondu dans la fenêtre de 300 ms, avec délai après', () => {
    const a = button('A'), b = button('B'), c = button('C')
    tooltip(a, 'A'); tooltip(b, 'B'); tooltip(c, 'C')
    a.dispatchEvent(pointer('pointerenter'))
    vi.advanceTimersByTime(OPEN_DELAY)
    a.dispatchEvent(pointer('pointerleave'))
    b.dispatchEvent(pointer('pointerenter'))
    expect(shown()).toBe(true)
    expect(bubble()!.textContent).toBe('B')
    expect(bubble()!.hasAttribute('data-fade')).toBe(false)
    b.dispatchEvent(pointer('pointerleave'))
    vi.advanceTimersByTime(SKIP_WINDOW)
    c.dispatchEvent(pointer('pointerenter'))
    expect(shown()).toBe(false)
    vi.advanceTimersByTime(OPEN_DELAY)
    expect(bubble()!.textContent).toBe('C')
  })

  it('n’ouvre rien au doigt, au stylet ni pendant un glisser', () => {
    const b = button('X')
    tooltip(b, 'X')
    b.dispatchEvent(pointer('pointerenter', { pointerType: 'touch' }))
    b.dispatchEvent(pointer('pointerenter', { pointerType: 'pen' }))
    b.dispatchEvent(pointer('pointerenter', { buttons: 1 }))
    vi.advanceTimersByTime(OPEN_DELAY * 2)
    expect(shown()).toBe(false)
  })

  it('un clic ferme et garde fermé jusqu’au départ du pointeur', () => {
    const b = button('X')
    tooltip(b, 'X')
    b.dispatchEvent(pointer('pointerenter'))
    vi.advanceTimersByTime(OPEN_DELAY)
    b.dispatchEvent(pointer('pointerdown'))
    expect(shown()).toBe(false)
    b.dispatchEvent(pointer('pointerenter'))
    vi.advanceTimersByTime(OPEN_DELAY)
    expect(shown()).toBe(false)
    b.dispatchEvent(pointer('pointerleave'))
    vi.advanceTimersByTime(SKIP_WINDOW)
    b.dispatchEvent(pointer('pointerenter'))
    vi.advanceTimersByTime(OPEN_DELAY)
    expect(shown()).toBe(true)
  })

  it('Échap ferme ; rien ne s’ouvre sur un menu déjà déplié', () => {
    const b = button('X')
    tooltip(b, 'X')
    b.dispatchEvent(pointer('pointerenter'))
    vi.advanceTimersByTime(OPEN_DELAY)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(shown()).toBe(false)
    b.dispatchEvent(pointer('pointerleave'))
    b.setAttribute('aria-expanded', 'true')
    b.dispatchEvent(pointer('pointerenter'))
    vi.advanceTimersByTime(OPEN_DELAY)
    expect(shown()).toBe(false)
  })

  it('se ferme au défilement qui emporte le déclencheur, pas à celui d’un autre fil', () => {
    const elsewhere = document.createElement('div')
    document.body.appendChild(elsewhere)
    const b = button('X')
    tooltip(b, 'X')
    b.dispatchEvent(pointer('pointerenter'))
    vi.advanceTimersByTime(OPEN_DELAY)
    elsewhere.dispatchEvent(new Event('scroll'))
    expect(shown()).toBe(true)
    document.dispatchEvent(new Event('scroll'))
    expect(shown()).toBe(false)
  })

  it('ne décrit le bouton que par ce que son nom ne dit pas déjà', () => {
    const same = button('Rechercher'), other = button('Zoom', '100 %'), part = button('Noir', 'Couleur du texte : Noir')
    tooltip(same, { label: 'Rechercher', kbd: 'Ctrl+Maj+F' })
    tooltip(other, 'Revenir à 100 %')
    tooltip(part, 'noir')
    part.dispatchEvent(pointer('pointerenter'))
    vi.advanceTimersByTime(OPEN_DELAY)
    expect(part.hasAttribute('aria-describedby')).toBe(false)
    part.dispatchEvent(pointer('pointerleave'))
    vi.advanceTimersByTime(SKIP_WINDOW)
    same.dispatchEvent(pointer('pointerenter'))
    vi.advanceTimersByTime(OPEN_DELAY)
    expect(same.getAttribute('aria-describedby')).toBe('doku-tooltip-kbd')
    same.dispatchEvent(pointer('pointerleave'))
    expect(same.hasAttribute('aria-describedby')).toBe(false)
    other.dispatchEvent(pointer('pointerenter'))
    expect(other.getAttribute('aria-describedby')).toBe('doku-tooltip')
  })

  it('le départ d’un autre déclencheur n’annule pas l’ouverture en attente', () => {
    const a = button('A'), b = button('B')
    tooltip(a, 'A'); tooltip(b, 'B')
    // Hors de la fenêtre de 300 ms laissée par le test précédent (horloge factice relancée).
    vi.setSystemTime(Date.now() + 60_000)
    b.dispatchEvent(pointer('pointerenter'))
    expect(shown()).toBe(false)
    a.dispatchEvent(new FocusEvent('focusout'))
    a.dispatchEvent(pointer('pointerleave'))
    vi.advanceTimersByTime(OPEN_DELAY)
    expect(shown()).toBe(true)
    expect(bubble()!.textContent).toBe('B')
  })

  it('suit un libellé qui change pendant l’affichage', () => {
    const b = button('Replier')
    const action = tooltip(b, 'Replier')
    b.dispatchEvent(pointer('pointerenter'))
    vi.advanceTimersByTime(OPEN_DELAY)
    action.update?.('Déplier')
    expect(bubble()!.textContent).toBe('Déplier')
    action.destroy?.()
    expect(shown()).toBe(false)
  })
})

describe('placeTooltip', () => {
  const viewport = { width: 1000, height: 800 }
  const tip = { width: 100, height: 24 }

  it('se centre au-dessus du déclencheur', () => {
    expect(placeTooltip({ left: 200, top: 300, width: 40, height: 32 }, tip, viewport)).toEqual({ left: 170, top: 271, side: 'top' })
  })

  it('passe dessous quand le haut manque (barre de titre)', () => {
    const out = placeTooltip({ left: 200, top: 2, width: 40, height: 32 }, tip, viewport)
    expect(out).toEqual({ left: 170, top: 39, side: 'bottom' })
  })

  it('reste dans la fenêtre au bord droit', () => {
    expect(placeTooltip({ left: 970, top: 300, width: 30, height: 32 }, tip, viewport).left).toBe(1000 - 8 - 100)
  })
})
