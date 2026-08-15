import { describe, expect, it } from 'vitest'
import {
  MAX_PDF_DRAWING_POINTS,
  MAX_PDF_TEXT_RECTS,
  PDF_HIGHLIGHT_COLOR,
  appendPdfStroke,
  appendPdfTextHighlightRects,
  PDF_HIGHLIGHT_STROKE_WIDTH,
  createPdfEllipseDrawing,
  createPdfHighlightDrawing,
  createPdfInkDrawing,
  createPdfRectangleDrawing,
  createPdfTextHighlightDrawing,
  extendPdfDrawingPoints,
  fitPdfDrawingPoints,
  isPdfStrokeDrawing,
  mergePdfLineRects,
  pdfDrawingBox,
  pdfDrawingTop,
  pdfStrokePathData,
  simplifyPdfDrawingPoints,
  smoothPdfDrawingStroke,
  translatePdfDrawing,
} from './pdf-drawing'

describe('pdf drawing', () => {
  it('simplifie un tracé tout en gardant ses extrémités', () => {
    const points = simplifyPdfDrawingPoints([
      { x: 0.1, y: 0.1 },
      { x: 0.1001, y: 0.1001 },
      { x: 0.4, y: 0.5 },
    ])
    expect(points).toEqual([{ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.5 }])
  })

  it('normalise un rectangle dessiné dans les deux directions', () => {
    const drawing = createPdfRectangleDrawing(2, { x: 0.8, y: 0.7 }, { x: 0.2, y: 0.3 }, { id: 'rect-1' })
    expect(drawing).toMatchObject({ id: 'rect-1', page: 2, left: 0.2, top: 0.3 })
    expect(drawing.width).toBeCloseTo(0.6)
    expect(drawing.height).toBeCloseTo(0.4)
  })

  it('borne le déplacement d’un tracé aux limites de la page', () => {
    const drawing = createPdfInkDrawing(1, [[{ x: 0.8, y: 0.8 }, { x: 0.9, y: 0.9 }]], { id: 'ink-1' })
    const moved = translatePdfDrawing(drawing, { x: 0.5, y: 0.5 })
    expect(moved.kind).toBe('ink')
    if (moved.kind === 'ink') expect(moved.strokes[0]).toEqual([{ x: 0.9, y: 0.9 }, { x: 1, y: 1 }])
  })

  it('n’accumule que les échantillons assez éloignés pendant le geste', () => {
    // Lissage neutralisé pour n'éprouver ici que le filtre de distance.
    const points = extendPdfDrawingPoints(
      [{ x: 0.1, y: 0.1 }],
      [{ x: 0.1002, y: 0.1 }, { x: 0.2, y: 0.2 }, { x: 0.2001, y: 0.2 }, { x: 1.4, y: -0.3 }],
      undefined,
      1,
    )
    expect(points).toEqual([{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }, { x: 1, y: 0 }])
  })

  it('absorbe le tremblement de la main au lieu de l’épouser', () => {
    // Une main qui suit une horizontale en tremblant de ±0,01 verticalement.
    const secousses = Array.from({ length: 60 }, (_, index) => ({
      x: 0.1 + index * 0.008,
      y: 0.5 + (index % 2 ? 0.01 : -0.01),
    }))
    const brut = extendPdfDrawingPoints([{ x: 0.1, y: 0.5 }], secousses, undefined, 1)
    const lisse = extendPdfDrawingPoints([{ x: 0.1, y: 0.5 }], secousses)
    const amplitude = (points: { y: number }[]) => Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y))
    expect(amplitude(brut)).toBeCloseTo(0.02)
    // Le tremblement résiduel doit être une fraction de celui de l'entrée…
    expect(amplitude(lisse)).toBeLessThan(amplitude(brut) / 2)
    // …sans que le trait cesse d'aller là où la main l'emmène.
    expect(lisse.at(-1)!.x).toBeGreaterThan(0.5)
  })

  it('efface le tremblement au commit sans déplacer les extrémités ni retarder le trait', () => {
    const tremble = Array.from({ length: 40 }, (_, index) => ({
      x: index / 40,
      y: 0.5 + (index % 2 ? 0.01 : -0.01),
    }))
    const propre = smoothPdfDrawingStroke(tremble)
    const amplitude = (points: { y: number }[]) => Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y))
    // Une oscillation d'un point sur deux est annulée par le noyau [1 2 1]. Les
    // extrémités étant épinglées, un résidu subsiste sur les deux ou trois points qui
    // les jouxtent — d'où la mesure sur le cœur du tracé.
    expect(amplitude(tremble)).toBeCloseTo(0.02)
    expect(amplitude(propre.slice(4, -4))).toBeLessThan(0.0005)
    // Les extrémités restent où la main les a posées, et le nombre de points ne bouge pas
    // (donc aucun retard : le trait couvre exactement la même course).
    expect(propre[0]).toEqual(tremble[0])
    expect(propre.at(-1)).toEqual(tremble.at(-1))
    expect(propre).toHaveLength(tremble.length)
    // Un trait de deux points n'a rien à lisser.
    expect(smoothPdfDrawingStroke([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }])
  })

  it('rend un tracé en courbes, et une simple droite quand il n’y a que deux points', () => {
    const droite = pdfStrokePathData([[{ x: 0, y: 0 }, { x: 1, y: 1 }]], 100, 100)
    expect(droite).toBe('M 0 0 L 100 100')

    const courbe = pdfStrokePathData([[{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 0 }]], 100, 100)
    expect(courbe.startsWith('M 0 0 C ')).toBe(true)
    // Aucun segment droit : c'est ce qui faisait apparaître les points de rupture.
    expect(courbe).not.toContain(' L ')

    // Chaque passe d'un bloc reste un sous-chemin distinct.
    const bloc = pdfStrokePathData([
      [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }],
    ], 100, 100)
    expect(bloc.match(/M /g)).toHaveLength(2)
    expect(pdfStrokePathData([[{ x: 0, y: 0 }]], 100, 100)).toBe('')
  })

  it('fait tenir un tracé très long sous le plafond de persistance', () => {
    const dense = Array.from({ length: 20_000 }, (_, index) => ({ x: index / 20_000, y: (index % 2) / 2 }))
    const fitted = fitPdfDrawingPoints(dense)
    expect(fitted.length).toBeLessThanOrEqual(MAX_PDF_DRAWING_POINTS)
    expect(fitted.at(-1)).toEqual({ x: dense.at(-1)!.x, y: dense.at(-1)!.y })
  })

  it('ne persiste pas un tracé que la relecture amputerait', () => {
    // Zigzag : chaque point est déjà au-delà du pas de simplification, donc seul le
    // repli progressif de `fitPdfDrawingPoints` peut faire tenir le tracé.
    const dense = Array.from({ length: 12_000 }, (_, index) => ({ x: index / 12_000, y: (index % 2) / 2 }))
    const drawing = createPdfInkDrawing(1, [dense], { id: 'ink-long' })
    expect(drawing.strokes[0].length).toBeLessThanOrEqual(MAX_PDF_DRAWING_POINTS)
  })

  it('donne au surligneur ses propres couleur et épaisseur par défaut', () => {
    const highlight = createPdfHighlightDrawing(1, [[{ x: 0.1, y: 0.5 }, { x: 0.7, y: 0.5 }]], { id: 'hl-1' })
    expect(highlight).toMatchObject({
      kind: 'highlight',
      color: PDF_HIGHLIGHT_COLOR,
      strokeWidth: PDF_HIGHLIGHT_STROKE_WIDTH,
      quote: '',
      comment: '',
    })
    expect(createPdfInkDrawing(1, [[{ x: 0.1, y: 0.5 }, { x: 0.7, y: 0.5 }]]).color).not.toBe(PDF_HIGHLIGHT_COLOR)
    expect(isPdfStrokeDrawing(highlight)).toBe(true)
  })

  it('déplace un surlignage comme un tracé, en bornant à la page', () => {
    const highlight = createPdfHighlightDrawing(1, [[{ x: 0.8, y: 0.8 }, { x: 0.9, y: 0.9 }]], { id: 'hl-1', quote: 'texte' })
    const moved = translatePdfDrawing(highlight, { x: 0.5, y: 0.5 })
    expect(moved.kind).toBe('highlight')
    if (isPdfStrokeDrawing(moved)) expect(moved.strokes[0]).toEqual([{ x: 0.9, y: 0.9 }, { x: 1, y: 1 }])
  })

  it('fusionne les rectangles d’une même ligne sans souder deux colonnes', () => {
    const merged = mergePdfLineRects([
      // Une ligne renvoyée en deux morceaux jointifs par le navigateur
      { left: 0.10, top: 0.20, width: 0.20, height: 0.03 },
      { left: 0.30, top: 0.201, width: 0.15, height: 0.029 },
      // Doublon exact sur la même ligne
      { left: 0.10, top: 0.20, width: 0.20, height: 0.03 },
      // Seconde colonne : même ligne, mais loin -> reste distincte
      { left: 0.60, top: 0.20, width: 0.25, height: 0.03 },
      // Ligne suivante
      { left: 0.10, top: 0.26, width: 0.30, height: 0.03 },
    ])
    expect(merged).toHaveLength(3)
    expect(merged[0].left).toBeCloseTo(0.10)
    expect(merged[0].width).toBeCloseTo(0.35)
    expect(merged[1]).toMatchObject({ left: 0.60, width: 0.25 })
    expect(merged[2]).toMatchObject({ top: 0.26, width: 0.30 })
  })

  it('assemble plusieurs passes en un seul bloc de surlignage', () => {
    const first = createPdfHighlightDrawing(1, [[{ x: 0.1, y: 0.2 }, { x: 0.7, y: 0.2 }]], { id: 'hl-1' })
    const block = appendPdfStroke(first, [{ x: 0.1, y: 0.26 }, { x: 0.5, y: 0.26 }], '2026-08-14T12:00:00.000Z')
    expect(block.strokes).toHaveLength(2)
    expect(block.id).toBe('hl-1')
    expect(block.updatedAt).toBe('2026-08-14T12:00:00.000Z')
    // Un bloc se déplace d'un seul tenant : les deux passes gardent leur écart.
    const moved = translatePdfDrawing(block, { x: 0.1, y: 0 })
    if (isPdfStrokeDrawing(moved)) {
      expect(moved.strokes[0][0].x).toBeCloseTo(0.2)
      expect(moved.strokes[1][0].x).toBeCloseTo(0.2)
    }
  })

  it('ajoute des lignes à un bloc de surlignage de texte, citation comprise', () => {
    const first = createPdfTextHighlightDrawing(1, [{ left: 0.1, top: 0.2, width: 0.5, height: 0.03 }], {
      id: 'txt-1',
      quote: 'premiere ligne',
    })
    const block = appendPdfTextHighlightRects(first, [{ left: 0.1, top: 0.25, width: 0.3, height: 0.03 }], 'seconde ligne')
    expect(block.rects).toHaveLength(2)
    expect(block.quote).toBe('premiere ligne seconde ligne')
  })

  it('borne un bloc de surlignage à l’écriture, pas seulement à la relecture', () => {
    const ligne = (index: number) => ({ left: 0.1, top: index * 0.004, width: 0.5, height: 0.003 })
    let block = createPdfTextHighlightDrawing(1, [ligne(0)], { id: 'txt-1', quote: 'debut' })
    for (let index = 1; index < MAX_PDF_TEXT_RECTS + 40; index++) {
      block = appendPdfTextHighlightRects(block, [ligne(index)], `l${index}`)
    }
    // Sans borne à l'ajout, la relecture aurait amputé le bloc au redémarrage.
    expect(block.rects.length).toBe(MAX_PDF_TEXT_RECTS)
  })

  it('partage le plafond de points entre les passes d’un bloc', () => {
    const zigzag = (offset: number) => Array.from({ length: 6_000 }, (_, index) => ({ x: index / 6_000, y: offset + (index % 2) / 4 }))
    const block = createPdfHighlightDrawing(1, [zigzag(0.1), zigzag(0.5)], { id: 'hl-long' })
    expect(block.strokes).toHaveLength(2)
    expect(block.strokes.flat().length).toBeLessThanOrEqual(MAX_PDF_DRAWING_POINTS)
  })

  it('calcule l’emprise d’une annotation pour y ancrer sa bulle', () => {
    const stroke = createPdfInkDrawing(1, [[{ x: 0.2, y: 0.7 }, { x: 0.6, y: 0.35 }]], { id: 'ink-1' })
    expect(pdfDrawingBox(stroke)).toMatchObject({ left: 0.2, top: 0.35 })
    expect(pdfDrawingBox(stroke).width).toBeCloseTo(0.4)
    expect(pdfDrawingBox(stroke).height).toBeCloseTo(0.35)

    const highlight = createPdfTextHighlightDrawing(1, [
      { left: 0.1, top: 0.2, width: 0.5, height: 0.03 },
      { left: 0.1, top: 0.25, width: 0.3, height: 0.03 },
    ], { id: 'txt-1' })
    const box = pdfDrawingBox(highlight)
    expect(box).toMatchObject({ left: 0.1, top: 0.2 })
    expect(box.width).toBeCloseTo(0.5)
    // La bulle se pose sous la DERNIÈRE ligne, pas sous la première.
    expect(box.top + box.height).toBeCloseTo(0.28)

    expect(pdfDrawingBox(createPdfRectangleDrawing(1, { x: 0.2, y: 0.6 }, { x: 0.5, y: 0.25 }, { id: 'r' })))
      .toMatchObject({ left: 0.2, top: 0.25 })
  })

  it('situe une note au sommet du tracé et au bord haut d’une forme', () => {
    const stroke = createPdfInkDrawing(1, [[{ x: 0.2, y: 0.7 }, { x: 0.4, y: 0.35 }, { x: 0.6, y: 0.9 }]], { id: 'ink-1' })
    expect(pdfDrawingTop(stroke)).toBeCloseTo(0.35)
    expect(pdfDrawingTop(createPdfRectangleDrawing(1, { x: 0.2, y: 0.6 }, { x: 0.5, y: 0.25 }, { id: 'r' }))).toBeCloseTo(0.25)
  })

  it('déplace un surlignage de texte en bloc, borné à la page', () => {
    const highlight = createPdfTextHighlightDrawing(1, [
      { left: 0.6, top: 0.7, width: 0.3, height: 0.04 },
      { left: 0.6, top: 0.76, width: 0.2, height: 0.04 },
    ], { id: 'txt-1' })
    const moved = translatePdfDrawing(highlight, { x: 0.5, y: 0.5 })
    expect(moved.kind).toBe('text')
    if (moved.kind === 'text') {
      // Le décalage est rogné sur l'emprise complète : rien ne sort de la page,
      // et l'écart entre les deux lignes est conservé.
      expect(moved.rects[0].left).toBeCloseTo(0.7)
      expect(moved.rects[0].top).toBeCloseTo(0.9)
      expect(moved.rects[1].left).toBeCloseTo(0.7)
      expect(moved.rects[1].top).toBeCloseTo(0.96)
    }
    expect(pdfDrawingTop(highlight)).toBeCloseTo(0.7)
  })

  it('refuse un surlignage de texte sans rectangle exploitable', () => {
    expect(() => createPdfTextHighlightDrawing(1, [{ left: 0.2, top: 0.2, width: 0, height: 0.04 }], { id: 'x' }))
      .toThrow('Surlignage PDF invalide.')
  })

  it('crée une ellipse dans une boîte normalisée', () => {
    const drawing = createPdfEllipseDrawing(3, { x: 0.75, y: 0.8 }, { x: 0.25, y: 0.2 }, {
      id: 'ellipse-1',
      strokeWidth: 8,
    })
    expect(drawing).toMatchObject({
      id: 'ellipse-1', kind: 'ellipse', page: 3, left: 0.25, top: 0.2, width: 0.5, strokeWidth: 8,
    })
    expect(drawing.height).toBeCloseTo(0.6)
  })
})
