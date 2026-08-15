export interface PdfDrawingPoint {
  x: number
  y: number
}

export interface PdfDrawingRect {
  left: number
  top: number
  width: number
  height: number
}

interface PdfDrawingBase {
  id: string
  page: number
  color: string
  strokeWidth: number
  // Toute annotation graphique peut porter une note : le commentaire n'est plus
  // réservé au surlignage de texte (l'ancien modèle par sélection).
  comment: string
  createdAt: string
  updatedAt: string
  status: 'active' | 'orphaned'
}

// `strokes` et non `points` : un surlignage se construit souvent en plusieurs passes
// (une par ligne d'un paragraphe). Les traits consécutifs forment alors UN objet —
// un bloc — qu'on commente et supprime d'un seul geste.
export interface PdfInkDrawing extends PdfDrawingBase {
  kind: 'ink'
  strokes: PdfDrawingPoint[][]
}

// Même géométrie que le crayon — c'en est un mode, pas un outil à part. Ce qui
// change : le rendu (trait épais, translucide, en multiply) et la citation lue
// sous le trait au moment du commit.
export interface PdfHighlightDrawing extends PdfDrawingBase {
  kind: 'highlight'
  strokes: PdfDrawingPoint[][]
  quote: string
}

// Le surligneur de texte : le geste sélectionne du texte, le résultat épouse les
// lignes (un rectangle par ligne) et cite exactement les mots couverts. C'est un
// tracé comme les autres — donc gomme, couleur, note et historique gratuits.
export interface PdfTextHighlightDrawing extends PdfDrawingBase {
  kind: 'text'
  rects: PdfDrawingRect[]
  quote: string
}

export interface PdfRectangleDrawing extends PdfDrawingBase {
  kind: 'rectangle'
  left: number
  top: number
  width: number
  height: number
}

export interface PdfEllipseDrawing extends PdfDrawingBase {
  kind: 'ellipse'
  left: number
  top: number
  width: number
  height: number
}

export type PdfShapeKind = 'rectangle' | 'ellipse'
export type PdfStrokeKind = 'ink' | 'highlight'
// Ce que produit le crayon selon son mode : trait, trait de surligneur, ou
// surlignage calé sur le texte.
export type PdfInkMode = PdfStrokeKind | 'text'
export type PdfShapeDrawing = PdfRectangleDrawing | PdfEllipseDrawing
export type PdfStrokeDrawing = PdfInkDrawing | PdfHighlightDrawing
export type PdfDrawing = PdfStrokeDrawing | PdfTextHighlightDrawing | PdfShapeDrawing

export const PDF_DRAWING_COLOR = '#000000'
export const PDF_DRAWING_STROKE_WIDTH = 4
export const PDF_HIGHLIGHT_COLOR = '#FFD400'
export const PDF_HIGHLIGHT_STROKE_WIDTH = 20
// Le surligneur doit couvrir une ligne de texte : il lui faut bien plus que les
// 20 du crayon (l'épaisseur est relative à la page, cf. renderPdfDrawingsForPage).
export const MAX_PDF_STROKE_WIDTH = 60
export const PDF_DRAWING_MIN_STEP = 0.0015
// Poids du lissage d'entrée (0 = brut, 1 = aucun lissage).
export const PDF_DRAWING_SMOOTHING = 0.45
// Plafond de points d'un tracé persisté. Le manifeste tronque au-delà : un tracé
// commité plus dense reviendrait AMPUTÉ au rechargement (forme différente au
// redémarrage). `fitPdfDrawingPoints` le fait donc tenir par simplification.
export const MAX_PDF_DRAWING_POINTS = 4_096
// Plafond de lignes d'un surlignage de texte, appliqué à l'écriture ET à la relecture.
export const MAX_PDF_TEXT_RECTS = 160
// Passes maximales d un bloc de tracé (le plafond de POINTS, lui, est partagé).
export const MAX_PDF_DRAWING_STROKES = 256

export function isPdfStrokeDrawing(drawing: PdfDrawing): drawing is PdfStrokeDrawing {
  return drawing.kind === 'ink' || drawing.kind === 'highlight'
}

export function isPdfTextHighlight(drawing: PdfDrawing): drawing is PdfTextHighlightDrawing {
  return drawing.kind === 'text'
}

export function isPdfShapeDrawing(drawing: PdfDrawing): drawing is PdfShapeDrawing {
  return drawing.kind === 'rectangle' || drawing.kind === 'ellipse'
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1)
}

export function normalizePdfDrawingPoint(point: PdfDrawingPoint): PdfDrawingPoint {
  return { x: clamp01(point.x), y: clamp01(point.y) }
}

// Filtrage à la volée pendant le geste : sans lui, un pointeur à 240 Hz (échantillons
// coalescés) fait enfler le tableau, et chaque frame re-sérialise un `d` de plus en
// plus long — le crayon ralentit à mesure qu'on dessine.
//
// Chaque échantillon est aussi TIRÉ vers le précédent (moyenne mobile) : la main
// tremble, le pointeur aussi, et d'autant plus que le geste est lent. Le trait suit
// alors la trajectoire voulue au lieu d'en épouser les secousses. Le poids est un
// compromis — trop haut, le trait retarde sur le pointeur et coupe les angles.
export function extendPdfDrawingPoints(
  points: PdfDrawingPoint[],
  samples: PdfDrawingPoint[],
  minimumDistance = PDF_DRAWING_MIN_STEP,
  smoothing = PDF_DRAWING_SMOOTHING,
): PdfDrawingPoint[] {
  const minimumSquared = minimumDistance * minimumDistance
  const weight = Math.min(Math.max(smoothing, 0), 1)
  const next = points.slice()
  for (const sample of samples) {
    const raw = normalizePdfDrawingPoint(sample)
    const previous = next.at(-1)
    if (!previous) {
      next.push(raw)
      continue
    }
    const point = {
      x: previous.x + (raw.x - previous.x) * weight,
      y: previous.y + (raw.y - previous.y) * weight,
    }
    const dx = point.x - previous.x
    const dy = point.y - previous.y
    if (dx * dx + dy * dy >= minimumSquared) next.push(point)
  }
  return next
}

// Lissage SYMÉTRIQUE, appliqué une fois le geste terminé : chaque point est moyenné
// avec ses deux voisins ([1 2 1] / 4). Contrairement au lissage d'entrée, il regarde
// aussi vers l'avant — il n'introduit donc aucun retard, et annule complètement une
// oscillation d'un échantillon sur deux (le tremblement typique de la main). Les
// extrémités ne bougent pas : le trait commence et finit là où on l'a posé.
//
// À NE PAS appliquer à la relecture du manifeste : re-lisser à chaque ouverture
// déformerait un peu plus le tracé à chaque fois.
export function smoothPdfDrawingStroke(points: PdfDrawingPoint[], passes = 2): PdfDrawingPoint[] {
  let current = points.map(normalizePdfDrawingPoint)
  if (current.length < 3) return current
  for (let pass = 0; pass < passes; pass++) {
    const next = current.slice()
    for (let index = 1; index < current.length - 1; index++) {
      next[index] = {
        x: (current[index - 1].x + current[index].x * 2 + current[index + 1].x) / 4,
        y: (current[index - 1].y + current[index].y * 2 + current[index + 1].y) / 4,
      }
    }
    current = next
  }
  return current
}

// Catmull-Rom converti en Béziers cubiques : la courbe passe par TOUS les points, mais
// le contour cesse d'être polygonal. C'est ce qui manque à un tracé à main levée une
// fois simplifié — les segments droits rendent visibles les points de rupture.
//
// La projection est un paramètre : le même tracé se peint à l'écran (fractions × taille
// du wrap) et se grave dans le PDF (fractions → repère de la page, rotation comprise).
// Une seule courbe pour les deux, donc aucune divergence possible entre l'aperçu et
// l'export.
export function pdfBezierPathData(
  strokes: PdfDrawingPoint[][],
  project: (point: PdfDrawingPoint) => PdfDrawingPoint,
): string {
  const round = (value: number) => Math.round(value * 100) / 100
  const parts: string[] = []
  for (const stroke of strokes) {
    const points = stroke.map(project)
    if (points.length < 2) continue
    parts.push(`M ${round(points[0].x)} ${round(points[0].y)}`)
    if (points.length === 2) {
      parts.push(`L ${round(points[1].x)} ${round(points[1].y)}`)
      continue
    }
    for (let index = 0; index < points.length - 1; index++) {
      const before = points[index - 1] ?? points[index]
      const from = points[index]
      const to = points[index + 1]
      const after = points[index + 2] ?? to
      const c1x = from.x + (to.x - before.x) / 6
      const c1y = from.y + (to.y - before.y) / 6
      const c2x = to.x - (after.x - from.x) / 6
      const c2y = to.y - (after.y - from.y) / 6
      parts.push(`C ${round(c1x)} ${round(c1y)} ${round(c2x)} ${round(c2y)} ${round(to.x)} ${round(to.y)}`)
    }
  }
  return parts.join(' ')
}

export function pdfStrokePathData(strokes: PdfDrawingPoint[][], width: number, height: number): string {
  return pdfBezierPathData(strokes, (point) => ({ x: point.x * width, y: point.y * height }))
}

export function simplifyPdfDrawingPoints(points: PdfDrawingPoint[], minimumDistance = PDF_DRAWING_MIN_STEP): PdfDrawingPoint[] {
  if (points.length <= 2) return points.map(normalizePdfDrawingPoint)
  const minimumSquared = minimumDistance * minimumDistance
  const simplified = [normalizePdfDrawingPoint(points[0])]
  for (let index = 1; index < points.length - 1; index++) {
    const point = normalizePdfDrawingPoint(points[index])
    const previous = simplified.at(-1)!
    const dx = point.x - previous.x
    const dy = point.y - previous.y
    if (dx * dx + dy * dy >= minimumSquared) simplified.push(point)
  }
  const last = normalizePdfDrawingPoint(points.at(-1)!)
  const previous = simplified.at(-1)!
  if (last.x !== previous.x || last.y !== previous.y) simplified.push(last)
  return simplified
}

// Simplification progressive jusqu'à tenir sous le plafond de persistance : le pas
// double à chaque passe (borné), et les extrémités du tracé sont toujours conservées.
export function fitPdfDrawingPoints(points: PdfDrawingPoint[], limit = MAX_PDF_DRAWING_POINTS): PdfDrawingPoint[] {
  let step = PDF_DRAWING_MIN_STEP
  let simplified = simplifyPdfDrawingPoints(points, step)
  while (simplified.length > limit && step < 0.5) {
    step *= 2
    simplified = simplifyPdfDrawingPoints(points, step)
  }
  return simplified.length > limit
    ? [...simplified.slice(0, limit - 1), simplified.at(-1)!]
    : simplified
}

// Le plafond vaut pour l'objet entier : un bloc de dix passes ne doit pas peser dix
// fois plus qu'un trait, sinon la relecture le tronquerait passe par passe.
export function fitPdfDrawingStrokes(strokes: PdfDrawingPoint[][], limit = MAX_PDF_DRAWING_POINTS): PdfDrawingPoint[][] {
  const kept = strokes.filter((stroke) => stroke.length >= 2)
  if (!kept.length) return []
  const budget = Math.max(2, Math.floor(limit / kept.length))
  return kept.map((stroke) => fitPdfDrawingPoints(stroke, budget))
}

export function pdfStrokePoints(drawing: PdfStrokeDrawing): PdfDrawingPoint[] {
  return drawing.strokes.flat()
}

interface StrokeOptions {
  id?: string
  now?: string
  color?: string
  strokeWidth?: number
  comment?: string
  quote?: string
}

export function createPdfStrokeDrawing(
  page: number,
  strokes: PdfDrawingPoint[][],
  kind: PdfStrokeKind,
  options: StrokeOptions = {},
): PdfStrokeDrawing {
  const normalized = fitPdfDrawingStrokes(strokes)
  if (page < 1 || !normalized.length) throw new Error('Tracé PDF invalide.')
  const now = options.now ?? new Date().toISOString()
  const base = {
    id: options.id ?? globalThis.crypto.randomUUID(),
    page: Math.floor(page),
    strokes: normalized,
    color: options.color ?? (kind === 'highlight' ? PDF_HIGHLIGHT_COLOR : PDF_DRAWING_COLOR),
    strokeWidth: options.strokeWidth ?? (kind === 'highlight' ? PDF_HIGHLIGHT_STROKE_WIDTH : PDF_DRAWING_STROKE_WIDTH),
    comment: options.comment ?? '',
    createdAt: now,
    updatedAt: now,
    status: 'active' as const,
  }
  return kind === 'highlight'
    ? { ...base, kind: 'highlight', quote: options.quote ?? '' }
    : { ...base, kind: 'ink' }
}

export function createPdfInkDrawing(page: number, strokes: PdfDrawingPoint[][], options: StrokeOptions = {}): PdfInkDrawing {
  return createPdfStrokeDrawing(page, strokes, 'ink', options) as PdfInkDrawing
}

export function createPdfHighlightDrawing(page: number, strokes: PdfDrawingPoint[][], options: StrokeOptions = {}): PdfHighlightDrawing {
  return createPdfStrokeDrawing(page, strokes, 'highlight', options) as PdfHighlightDrawing
}

// Ajouter une passe à un bloc existant : c'est ce qui transforme « une ligne = un
// objet » en « un paragraphe = un objet ».
export function appendPdfStroke(
  drawing: PdfStrokeDrawing,
  stroke: PdfDrawingPoint[],
  now = new Date().toISOString(),
): PdfStrokeDrawing {
  return { ...drawing, strokes: fitPdfDrawingStrokes([...drawing.strokes, stroke]), updatedAt: now }
}

export function appendPdfTextHighlightRects(
  drawing: PdfTextHighlightDrawing,
  rects: PdfDrawingRect[],
  quote: string,
  now = new Date().toISOString(),
): PdfTextHighlightDrawing {
  const added = rects.map(normalizePdfDrawingRect).filter((rect): rect is PdfDrawingRect => Boolean(rect))
  return {
    ...drawing,
    // Borné À L'ÉCRITURE, comme les points d'un tracé : la relecture tronque au même
    // plafond, un bloc plus long reviendrait amputé au redémarrage.
    rects: [...drawing.rects, ...added].slice(0, MAX_PDF_TEXT_RECTS),
    quote: [drawing.quote, quote].filter(Boolean).join(' '),
    updatedAt: now,
  }
}

export function normalizePdfDrawingRect(rect: PdfDrawingRect): PdfDrawingRect | null {
  const left = clamp01(rect.left)
  const top = clamp01(rect.top)
  const width = Math.min(Math.max(rect.width, 0), 1 - left)
  const height = Math.min(Math.max(rect.height, 0), 1 - top)
  return width > 0 && height > 0 ? { left, top, width, height } : null
}

// Le navigateur renvoie plusieurs rectangles pour une même ligne (un par fragment de
// texte, parfois superposés) : les laisser tels quels double la citation et empile des
// aplats translucides. On les fusionne PAR LIGNE, mais seulement s'ils se touchent —
// deux colonnes côte à côte partagent la même ligne sans former un seul surlignage.
export function mergePdfLineRects(rects: PdfDrawingRect[], maxGap = 0.012): PdfDrawingRect[] {
  const sorted = [...rects].sort((left, right) => left.top - right.top || left.left - right.left)
  const merged: PdfDrawingRect[] = []
  for (const rect of sorted) {
    const target = merged.find((line) => {
      const overlap = Math.min(line.top + line.height, rect.top + rect.height) - Math.max(line.top, rect.top)
      if (overlap < Math.min(line.height, rect.height) * 0.5) return false
      const gap = Math.max(line.left, rect.left) - Math.min(line.left + line.width, rect.left + rect.width)
      return gap <= maxGap
    })
    if (!target) {
      merged.push({ ...rect })
      continue
    }
    const left = Math.min(target.left, rect.left)
    const top = Math.min(target.top, rect.top)
    target.width = Math.max(target.left + target.width, rect.left + rect.width) - left
    target.height = Math.max(target.top + target.height, rect.top + rect.height) - top
    target.left = left
    target.top = top
  }
  return merged
}

export function createPdfTextHighlightDrawing(
  page: number,
  rects: PdfDrawingRect[],
  options: StrokeOptions = {},
): PdfTextHighlightDrawing {
  const normalized = rects
    .map(normalizePdfDrawingRect)
    .filter((rect): rect is PdfDrawingRect => Boolean(rect))
  if (page < 1 || !normalized.length) throw new Error('Surlignage PDF invalide.')
  const now = options.now ?? new Date().toISOString()
  return {
    id: options.id ?? globalThis.crypto.randomUUID(),
    kind: 'text',
    page: Math.floor(page),
    rects: normalized,
    quote: options.quote ?? '',
    color: options.color ?? PDF_HIGHLIGHT_COLOR,
    strokeWidth: options.strokeWidth ?? PDF_HIGHLIGHT_STROKE_WIDTH,
    comment: options.comment ?? '',
    createdAt: now,
    updatedAt: now,
    status: 'active',
  }
}

export function createPdfShapeDrawing(
  page: number,
  start: PdfDrawingPoint,
  end: PdfDrawingPoint,
  kind: PdfShapeKind,
  options: StrokeOptions = {},
): PdfShapeDrawing {
  const first = normalizePdfDrawingPoint(start)
  const last = normalizePdfDrawingPoint(end)
  const left = Math.min(first.x, last.x)
  const top = Math.min(first.y, last.y)
  const width = Math.abs(first.x - last.x)
  const height = Math.abs(first.y - last.y)
  if (page < 1 || width < 0.002 || height < 0.002) throw new Error('Forme PDF invalide.')
  const now = options.now ?? new Date().toISOString()
  return {
    id: options.id ?? globalThis.crypto.randomUUID(),
    kind,
    page: Math.floor(page),
    left,
    top,
    width,
    height,
    color: options.color ?? PDF_DRAWING_COLOR,
    strokeWidth: options.strokeWidth ?? PDF_DRAWING_STROKE_WIDTH,
    comment: options.comment ?? '',
    createdAt: now,
    updatedAt: now,
    status: 'active',
  }
}

export function createPdfRectangleDrawing(
  page: number,
  start: PdfDrawingPoint,
  end: PdfDrawingPoint,
  options: StrokeOptions = {},
): PdfRectangleDrawing {
  return createPdfShapeDrawing(page, start, end, 'rectangle', options) as PdfRectangleDrawing
}

export function createPdfEllipseDrawing(
  page: number,
  start: PdfDrawingPoint,
  end: PdfDrawingPoint,
  options: StrokeOptions = {},
): PdfEllipseDrawing {
  return createPdfShapeDrawing(page, start, end, 'ellipse', options) as PdfEllipseDrawing
}

// Emprise d'une annotation, en fractions de page : sert à poser l'épingle de la
// gouttière ET à ancrer la bulle de note sous l'objet commenté.
export function pdfDrawingBox(drawing: PdfDrawing): PdfDrawingRect {
  if (isPdfShapeDrawing(drawing)) {
    return { left: drawing.left, top: drawing.top, width: drawing.width, height: drawing.height }
  }
  const corners = isPdfTextHighlight(drawing)
    ? drawing.rects.flatMap((rect) => [
      { x: rect.left, y: rect.top },
      { x: rect.left + rect.width, y: rect.top + rect.height },
    ])
    : pdfStrokePoints(drawing)
  if (!corners.length) return { left: 0, top: 0, width: 0, height: 0 }
  const xs = corners.map((point) => point.x)
  const ys = corners.map((point) => point.y)
  const left = Math.min(...xs)
  const top = Math.min(...ys)
  return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top }
}

export function pdfDrawingTop(drawing: PdfDrawing): number {
  return pdfDrawingBox(drawing).top
}

// Déplacement borné à la page, quelle que soit la géométrie : le décalage est rogné
// sur l'emprise complète de l'objet, donc aucune partie ne peut sortir.
export function translatePdfDrawing(
  drawing: PdfDrawing,
  delta: PdfDrawingPoint,
  now = new Date().toISOString(),
): PdfDrawing {
  if (isPdfShapeDrawing(drawing)) {
    const dx = Math.min(Math.max(delta.x, -drawing.left), 1 - drawing.left - drawing.width)
    const dy = Math.min(Math.max(delta.y, -drawing.top), 1 - drawing.top - drawing.height)
    return { ...drawing, left: drawing.left + dx, top: drawing.top + dy, updatedAt: now }
  }
  if (isPdfTextHighlight(drawing)) {
    const left = Math.min(...drawing.rects.map((rect) => rect.left))
    const top = Math.min(...drawing.rects.map((rect) => rect.top))
    const right = Math.max(...drawing.rects.map((rect) => rect.left + rect.width))
    const bottom = Math.max(...drawing.rects.map((rect) => rect.top + rect.height))
    const dx = Math.min(Math.max(delta.x, -left), 1 - right)
    const dy = Math.min(Math.max(delta.y, -top), 1 - bottom)
    return {
      ...drawing,
      rects: drawing.rects.map((rect) => ({ ...rect, left: rect.left + dx, top: rect.top + dy })),
      updatedAt: now,
    }
  }
  const points = pdfStrokePoints(drawing)
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const dx = Math.min(Math.max(delta.x, -Math.min(...xs)), 1 - Math.max(...xs))
  const dy = Math.min(Math.max(delta.y, -Math.min(...ys)), 1 - Math.max(...ys))
  return {
    ...drawing,
    strokes: drawing.strokes.map((stroke) => stroke.map((point) => ({ x: point.x + dx, y: point.y + dy }))),
    updatedAt: now,
  }
}
