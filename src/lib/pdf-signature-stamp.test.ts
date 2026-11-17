import { describe, expect, it } from 'vitest'
import {
  SIGNATURE_DEFAULT_HEIGHT,
  SIGNATURE_DEFAULT_WIDTH,
  SIGNATURE_STROKE_WIDTH,
  captureSignature,
  parseSavedSignature,
  signatureStrokes,
  signatureTargetBox,
  stampSignature,
} from './pdf-signature-stamp'

// Pavé 5:2 ; tracé occupant x 0.2..0.8 et y 0.25..0.75 → boîte de 0.6 × 0.5 du pavé,
// soit un rapport réel de (0.6 × 2.5) / 0.5 = 3.
const PAD = 2.5
const drawn = [
  [{ x: 0.2, y: 0.75 }, { x: 0.5, y: 0.25 }, { x: 0.8, y: 0.75 }],
  [{ x: 0.3, y: 0.5 }, { x: 0.7, y: 0.5 }],
]
const A4 = 210 / 297

describe('captureSignature', () => {
  it('ramène le tracé dans sa boîte englobante et garde son rapport réel', () => {
    const signature = captureSignature(drawn, PAD)!
    expect(signature.aspect).toBeCloseTo(3)
    expect(signature.strokes[0][0]).toEqual({ x: 0, y: 1 })
    expect(signature.strokes[0][1].x).toBeCloseTo(0.5)
    expect(signature.strokes[0][1].y).toBe(0)
    expect(signature.strokes[0][2]).toEqual({ x: 1, y: 1 })
  })

  it('refuse un point, un tracé vide et un pavé dégénéré', () => {
    expect(captureSignature([], PAD)).toBeNull()
    expect(captureSignature([[{ x: 0.5, y: 0.5 }]], PAD)).toBeNull()
    expect(captureSignature([[{ x: 0.5, y: 0.5 }, { x: 0.51, y: 0.5 }]], PAD)).toBeNull()
    expect(captureSignature(drawn, 0)).toBeNull()
  })

  it('survit à un trait parfaitement horizontal (hauteur nulle)', () => {
    const signature = captureSignature([[{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }]], PAD)!
    expect(Number.isFinite(signature.aspect)).toBe(true)
    expect(signature.strokes.flat().every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true)
  })
})

describe('parseSavedSignature', () => {
  it('relit ce que captureSignature a produit', () => {
    const signature = captureSignature(drawn, PAD)!
    expect(parseSavedSignature(JSON.stringify(signature))).toEqual(signature)
  })

  it('garde l’épaisseur choisie, et rend le trait fin à une signature d’avant ce réglage', () => {
    const thick = captureSignature(drawn, PAD, 4.5)!
    expect(parseSavedSignature(JSON.stringify(thick))!.strokeWidth).toBe(4.5)
    const { strokeWidth: _, ...legacy } = thick
    expect(parseSavedSignature(JSON.stringify(legacy))!.strokeWidth).toBe(SIGNATURE_STROKE_WIDTH)
    expect(parseSavedSignature(JSON.stringify({ ...thick, strokeWidth: 400 }))!.strokeWidth).toBeLessThanOrEqual(8)
  })

  it('rend null sur tout ce qui n’est pas une signature', () => {
    expect(parseSavedSignature(null)).toBeNull()
    expect(parseSavedSignature('{')).toBeNull()
    expect(parseSavedSignature('[]')).toBeNull()
    expect(parseSavedSignature(JSON.stringify({ version: 2, strokes: drawn, aspect: 3 }))).toBeNull()
    expect(parseSavedSignature(JSON.stringify({ version: 1, strokes: drawn, aspect: 0 }))).toBeNull()
    expect(parseSavedSignature(JSON.stringify({ version: 1, strokes: [[{ x: 'a', y: 0 }]], aspect: 3 }))).toBeNull()
  })

  it('borne les coordonnées hors de la boîte', () => {
    const parsed = parseSavedSignature(JSON.stringify({ version: 1, strokes: [[{ x: -4, y: 0 }, { x: 9, y: 1 }]], aspect: 3 }))!
    expect(parsed.strokes[0]).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }])
  })
})

describe('signatureTargetBox', () => {
  it('pose la taille par défaut, centrée sur un simple appui', () => {
    const at = { x: 0.5, y: 0.5 }
    const box = signatureTargetBox(at, at, 3, A4)
    expect(box.width).toBeCloseTo(SIGNATURE_DEFAULT_WIDTH)
    expect(box.height).toBeCloseTo(SIGNATURE_DEFAULT_WIDTH * A4 / 3)
    expect(box.left + box.width / 2).toBeCloseTo(0.5)
    expect(box.top + box.height / 2).toBeCloseTo(0.5)
  })

  it('borne aussi la HAUTEUR : une signature haute ne sort pas énorme', () => {
    const at = { x: 0.5, y: 0.5 }
    for (const aspect of [0.4, 1, 1.5]) {
      const box = signatureTargetBox(at, at, aspect, A4)
      expect(box.height).toBeCloseTo(SIGNATURE_DEFAULT_HEIGHT)
      expect(box.width).toBeLessThan(SIGNATURE_DEFAULT_WIDTH)
    }
  })

  it('ramène dans la page un appui dans un coin', () => {
    const corner = { x: 0.99, y: 0.995 }
    const box = signatureTargetBox(corner, corner, 3, A4)
    expect(box.left + box.width).toBeLessThanOrEqual(1)
    expect(box.top + box.height).toBeLessThanOrEqual(1)
    expect(box.left).toBeGreaterThanOrEqual(0)
  })

  it('prend tel quel un cadre tracé, dans les deux sens du geste', () => {
    const box = signatureTargetBox({ x: 0.6, y: 0.8 }, { x: 0.2, y: 0.7 }, 3, A4)
    expect(box.left).toBeCloseTo(0.2)
    expect(box.top).toBeCloseTo(0.7)
    expect(box.width).toBeCloseTo(0.4)
    expect(box.height).toBeCloseTo(0.1)
  })
})

describe('signatureStrokes', () => {
  const signature = captureSignature(drawn, PAD)!
  const extent = (strokes: { x: number; y: number }[][]) => {
    const points = strokes.flat()
    const xs = points.map((point) => point.x)
    const ys = points.map((point) => point.y)
    return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) }
  }

  it('garde le rapport réel de la signature quel que soit le cadre', () => {
    for (const box of [
      { left: 0.1, top: 0.1, width: 0.8, height: 0.1 }, // cadre trop large
      { left: 0.1, top: 0.1, width: 0.2, height: 0.6 }, // cadre trop haut
    ]) {
      const placed = extent(signatureStrokes(signature, box, A4))
      const realWidth = (placed.right - placed.left) * A4
      expect(realWidth / (placed.bottom - placed.top)).toBeCloseTo(3)
      // … sans jamais déborder du cadre.
      expect(placed.left).toBeGreaterThanOrEqual(box.left - 1e-9)
      expect(placed.right).toBeLessThanOrEqual(box.left + box.width + 1e-9)
      expect(placed.top).toBeGreaterThanOrEqual(box.top - 1e-9)
      expect(placed.bottom).toBeLessThanOrEqual(box.top + box.height + 1e-9)
    }
  })

  it('centre la signature dans le cadre', () => {
    const box = { left: 0.1, top: 0.1, width: 0.8, height: 0.1 }
    const placed = extent(signatureStrokes(signature, box, A4))
    expect((placed.left + placed.right) / 2).toBeCloseTo(0.5)
  })
})

describe('stampSignature', () => {
  it('produit un tracé ordinaire du carnet, toutes passes comprises', () => {
    const signature = captureSignature(drawn, PAD)!
    const at = { x: 0.5, y: 0.8 }
    const drawing = stampSignature(signature, 3, signatureTargetBox(at, at, signature.aspect, A4), A4, { id: 'sig' })
    expect(drawing.kind).toBe('ink')
    expect(drawing.page).toBe(3)
    expect(drawing.id).toBe('sig')
    expect(drawing.strokes).toHaveLength(2)
    expect(drawing.status).toBe('active')
    expect(drawing.strokeWidth).toBe(SIGNATURE_STROKE_WIDTH)
  })

  it('pose le trait à l’épaisseur choisie dans le pavé', () => {
    const signature = captureSignature(drawn, PAD, 4.5)!
    const at = { x: 0.5, y: 0.8 }
    expect(stampSignature(signature, 1, signatureTargetBox(at, at, signature.aspect, A4), A4).strokeWidth).toBe(4.5)
  })
})
