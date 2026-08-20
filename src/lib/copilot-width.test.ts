import { describe, expect, it } from 'vitest'
import {
  clampCopilotWidth,
  COPILOT_DEFAULT_WIDTH,
  COPILOT_MAX_WIDTH,
  COPILOT_MIN_DOCUMENT_WIDTH,
  COPILOT_MIN_WIDTH,
} from './copilot-width'

describe('clampCopilotWidth', () => {
  it('laisse passer une largeur ordinaire, arrondie au pixel', () => {
    expect(clampCopilotWidth(512.4)).toBe(512)
    expect(clampCopilotWidth(512.6)).toBe(513)
  })

  it('retombe sur le défaut pour une valeur inexploitable', () => {
    // Un settings corrompu ne doit pas produire un `flex-basis: NaNpx` (panneau à zéro).
    expect(clampCopilotWidth(Number.NaN)).toBe(COPILOT_DEFAULT_WIDTH)
    expect(clampCopilotWidth(Number.POSITIVE_INFINITY)).toBe(COPILOT_DEFAULT_WIDTH)
  })

  it('borne des deux côtés en l’absence de mesure', () => {
    expect(clampCopilotWidth(10)).toBe(COPILOT_MIN_WIDTH)
    expect(clampCopilotWidth(99_999)).toBe(COPILOT_MAX_WIDTH)
  })

  it('garde de la place à la zone document', () => {
    const available = 1200
    expect(clampCopilotWidth(1100, available)).toBe(available - COPILOT_MIN_DOCUMENT_WIDTH)
    expect(clampCopilotWidth(500, available)).toBe(500)
  })

  // Sans plancher, `available - 320` passerait SOUS le minimum du panneau et les deux
  // bornes s'inverseraient : `Math.min` l'emporterait et rendrait une largeur négative
  // sur une fenêtre étroite — le panneau disparaîtrait au premier glissement.
  it('préfère un panneau lisible à un document préservé sur fenêtre étroite', () => {
    expect(clampCopilotWidth(400, 500)).toBe(COPILOT_MIN_WIDTH)
    expect(clampCopilotWidth(50, 200)).toBe(COPILOT_MIN_WIDTH)
  })
})
