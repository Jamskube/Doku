import { describe, expect, it } from 'vitest'
import {
  clampCopilotWidth,
  COPILOT_DEFAULT_WIDTH,
  COPILOT_MAX_WIDTH,
  COPILOT_MIN_DOCUMENT_WIDTH,
  COPILOT_MIN_WIDTH,
  copilotMaxWidthCss,
  copilotWidthCss,
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

describe('copilotWidthCss', () => {
  // Elle porte la flex-basis animée : une unité liée à la fenêtre relancerait le rideau à
  // chaque image d'un redimensionnement de fenêtre.
  it('ne rend que des pixels, sans unité liée à la fenêtre', () => {
    expect(copilotWidthCss(400)).toBe('400px')
    expect(copilotWidthCss(512.6)).toBe('513px')
  })
})

describe('copilotMaxWidthCss', () => {
  // La préférence persistée peut dépasser la fenêtre courante : la borne CSS doit réserver
  // le document (et la barre latérale ouverte), avec un plancher pour le panneau.
  // Évalue l'expression CSS pour une largeur de fenêtre donnée (vw → px, min/max/calc).
  function maxAt(sidebarOpen: boolean, viewport: number): number {
    const js = copilotMaxWidthCss(sidebarOpen)
      .replace(/calc/g, '')
      .replace(/([\d.]+)vw/g, (_, n: string) => String((Number(n) * viewport) / 100))
      .replace(/px/g, '')
    return new Function('min', 'max', `return ${js}`)(Math.min, Math.max) as number
  }

  it('réserve le document, et la barre latérale quand elle est ouverte', () => {
    expect(maxAt(false, 1600)).toBe(1600 - 320)
    expect(maxAt(true, 1600)).toBe(1600 - 616)
  })

  it('borne à 38 % de la fenêtre sous 1000 px', () => {
    expect(maxAt(false, 900)).toBeCloseTo(342)
    expect(maxAt(true, 1000)).toBeCloseTo(380)
  })

  it('rend la règle d’avant aux grandes fenêtres, sans marche entre les deux', () => {
    expect(maxAt(false, 1300)).toBe(980)
    expect(maxAt(false, 1400)).toBe(1080)
    expect(maxAt(false, 1150)).toBeGreaterThan(437)
    expect(maxAt(false, 1150)).toBeLessThan(830)
  })

  it('garde le plancher du panneau sur une fenêtre minuscule', () => {
    expect(maxAt(true, 500)).toBe(240)
  })
})
