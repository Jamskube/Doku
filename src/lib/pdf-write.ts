// Gravure des annotations dans le PDF (ADR-0022). Le manifeste reste la source de
// vérité : graver est un EXPORT à sens unique, jamais une synchronisation, et le
// fichier source n'est jamais touché.
//
// Toute la difficulté est le changement de repère. Le manifeste stocke des fractions
// `0..1` de la page TELLE QU'AFFICHÉE (origine en haut à gauche, y vers le bas), parce
// que pdf.js applique le `/Rotate` de la page à son viewport. Un PDF, lui, se dessine
// dans le repère de la page NON tournée, origine en bas à gauche, y vers le haut. Une
// page à 90° a donc ses axes échangés entre ce qu'on a mesuré et ce qu'on écrit — c'est
// exactement le défaut qui avait fait échouer le spike de sélection.
import {
  isPdfShapeDrawing,
  isPdfStrokeDrawing,
  isPdfTextHighlight,
  pdfBezierPathData,
  pdfDrawingBox,
  type PdfDrawing,
  type PdfDrawingPoint,
  type PdfDrawingRect,
} from './pdf-drawing'
import { normalizePdfTurn, type PdfPagePlan } from './pdf-pages'

// Opacités du rendu écran, reproduites à l'identique (`.pdf-highlight-stroke` et
// `.pdf-text-fill` dans PdfView) : l'export doit ressembler à ce qu'on voyait.
export const PDF_BURN_HIGHLIGHT_OPACITY = 0.58
export const PDF_BURN_TEXT_OPACITY = 0.6
// Plancher d'épaisseur en points. L'écran plafonne à 1,6 px CSS ; en points un trait
// plus fin qu'un demi-point disparaît à l'impression.
export const PDF_BURN_MIN_STROKE = 0.5
// Côté et écart du repère de commentaire, en points. 18 pt est la taille à laquelle les
// lecteurs PDF dessinent l'icône « pense-bête ».
export const PDF_BURN_NOTE_SIZE = 18
export const PDF_BURN_NOTE_GAP = 5

export interface PdfBurnPage {
  // Boîte de RECADRAGE, pas la MediaBox : c'est elle que pdf.js prend pour viewport,
  // donc c'est elle qui définit le repère dans lequel les fractions ont été mesurées.
  // Les deux coïncident sur la plupart des documents, et divergent sur ceux qui portent
  // des repères d'impression — ceux-là seraient décalés si on prenait la MediaBox.
  x: number
  y: number
  width: number
  height: number
  rotation: number
}

export interface PdfBurnBox {
  x: number
  y: number
  width: number
  height: number
}

export function normalizePdfRotation(angle: number): 0 | 90 | 180 | 270 {
  const turns = ((Math.round(angle / 90) % 4) + 4) % 4
  return (turns * 90) as 0 | 90 | 180 | 270
}

// Fraction de la page affichée → point du repère PDF (origine en bas à gauche).
// Les quatre cas viennent des matrices de viewport de pdf.js, inversées.
export function pdfBurnPoint(point: PdfDrawingPoint, page: PdfBurnPage): PdfDrawingPoint {
  const { x, y, width: w, height: h } = page
  switch (normalizePdfRotation(page.rotation)) {
    case 90:
      return { x: x + point.y * w, y: y + point.x * h }
    case 180:
      return { x: x + w - point.x * w, y: y + point.y * h }
    case 270:
      return { x: x + w - point.y * w, y: y + h - point.x * h }
    default:
      return { x: x + point.x * w, y: y + h - point.y * h }
  }
}

// `drawSvgPath` ancre le chemin en un point et retourne l'axe vertical : un point SVG
// `(px, py)` atterrit en `(ancre.x + px, ancre.y - py)`. En ancrant au coin haut gauche
// de la boîte de recadrage, il suffit donc de fournir des coordonnées déjà projetées,
// exprimées en descendant depuis ce coin — la rotation est absorbée en amont.
export function pdfBurnAnchor(page: PdfBurnPage): PdfDrawingPoint {
  return { x: page.x, y: page.y + page.height }
}

export function pdfBurnPathData(strokes: PdfDrawingPoint[][], page: PdfBurnPage): string {
  const anchor = pdfBurnAnchor(page)
  return pdfBezierPathData(strokes, (point) => {
    const projected = pdfBurnPoint(point, page)
    return { x: projected.x - anchor.x, y: anchor.y - projected.y }
  })
}

// Une rotation d'un quart de tour envoie un rectangle aligné sur un rectangle aligné :
// projeter les deux coins opposés et renormaliser suffit, quelle que soit la rotation.
export function pdfBurnRect(rect: PdfDrawingRect, page: PdfBurnPage): PdfBurnBox {
  const first = pdfBurnPoint({ x: rect.left, y: rect.top }, page)
  const second = pdfBurnPoint({ x: rect.left + rect.width, y: rect.top + rect.height }, page)
  return {
    x: Math.min(first.x, second.x),
    y: Math.min(first.y, second.y),
    width: Math.abs(second.x - first.x),
    height: Math.abs(second.y - first.y),
  }
}

// Place le repère d'un commentaire DANS LA MARGE, jamais sur le passage annoté.
//
// Posé au coin haut-gauche de l'annotation, il recouvrait les premiers caractères de la
// ligne surlignée — le texte que le commentaire est censé éclairer devenait illisible.
// C'est aussi la convention des lecteurs PDF : le pense-bête vit à côté du texte, comme
// une note de marge.
//
// Le calcul se fait en fractions de la page AFFICHÉE, puis se projette comme le reste :
// « à gauche » doit vouloir dire à gauche POUR L'ŒIL, y compris sur une page tournée
// d'un quart de tour, où les axes du PDF sont échangés.
export function pdfNoteMarkerRect(
  box: PdfDrawingRect,
  page: PdfBurnPage,
  taken: PdfDrawingRect[] = [],
): PdfDrawingRect {
  const quart = normalizePdfRotation(page.rotation) % 180 !== 0
  // Une page tournée d'un quart de tour présente sa hauteur comme largeur.
  const largeurPt = quart ? page.height : page.width
  const hauteurPt = quart ? page.width : page.height
  const w = PDF_BURN_NOTE_SIZE / Math.max(1, largeurPt)
  const h = PDF_BURN_NOTE_SIZE / Math.max(1, hauteurPt)
  const gx = PDF_BURN_NOTE_GAP / Math.max(1, largeurPt)
  const gy = PDF_BURN_NOTE_GAP / Math.max(1, hauteurPt)

  // Le repère va contre le BORD DE LA PAGE, pas à gauche de l'annotation. Se caler sur
  // l'annotation ne met dans la marge que les surlignages commençant en début de ligne ;
  // pour un passage surligné en milieu de phrase, la place « à gauche » est occupée par
  // les mots précédents — c'est ce que le rendu de contrôle a montré. La marge de page,
  // elle, est vide sur tout document composé.
  let left = gx
  let top = box.top
  if (box.left < left + w + gx) {
    // L'annotation mord déjà dans la marge gauche : on tente la marge droite.
    const droite = 1 - gx - w
    if (box.left + box.width < droite - gx) {
      left = droite
    } else if (box.top - gy - h >= 0) {
      // Annotation pleine largeur : aucune marge latérale libre, mais l'interligne
      // au-dessus l'est presque toujours.
      left = box.left
      top = box.top - gy - h
    }
  }

  // Deux commentaires sur le même paragraphe se superposeraient en un seul repère
  // illisible : on décale vers le bas jusqu'à trouver une place, dans la même marge.
  const chevauche = (a: PdfDrawingRect, b: PdfDrawingRect) =>
    a.left < b.left + b.width && b.left < a.left + a.width &&
    a.top < b.top + b.height && b.top < a.top + a.height
  for (let essai = 0; essai < 16; essai++) {
    const candidat = { left, top, width: w, height: h }
    if (!taken.some((autre) => chevauche(candidat, autre))) break
    top += h * 1.15
    if (top + h > 1) break
  }

  return {
    left: Math.min(Math.max(left, 0), Math.max(0, 1 - w)),
    top: Math.min(Math.max(top, 0), Math.max(0, 1 - h)),
    width: w,
    height: h,
  }
}

// Même loi qu'à l'écran (`strokePixels`) : l'épaisseur est relative à la plus petite
// dimension de la page. Elle est donc insensible à la rotation, qui ne fait qu'échanger
// les deux dimensions.
export function pdfBurnStrokeWidth(strokeWidth: number, page: PdfBurnPage): number {
  return Math.max(PDF_BURN_MIN_STROKE, strokeWidth * Math.min(page.width, page.height) / 1_000)
}

export function pdfRgbFromHex(hex: string): { r: number; g: number; b: number } {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return { r: 0, g: 0, b: 0 }
  const value = Number.parseInt(match[1], 16)
  return {
    r: ((value >> 16) & 0xff) / 255,
    g: ((value >> 8) & 0xff) / 255,
    b: (value & 0xff) / 255,
  }
}

export interface PdfBurnOutcome {
  bytes: Uint8Array
  // Ce qui a réellement été écrit, pour pouvoir le dire à l'utilisateur plutôt que de
  // laisser croire à un export complet.
  burned: number
  notes: number
  skipped: number
}

export class PdfBurnError extends Error {}

function burnableDrawings(drawings: PdfDrawing[]): PdfDrawing[] {
  // Un tracé orphelin n'est plus affiché : ses coordonnées ne décrivent plus la mise en
  // page courante. Le graver poserait une marque à un endroit arbitraire.
  return drawings.filter((drawing) => drawing.status === 'active')
}

export async function burnPdfAnnotations(source: Uint8Array, drawings: PdfDrawing[]): Promise<PdfBurnOutcome> {
  const wanted = burnableDrawings(drawings)
  if (!wanted.length) throw new PdfBurnError('Aucune annotation à graver.')

  // Chargée à la demande (précédent ADR-0010) : la bibliothèque d'écriture reste hors
  // du bundle principal, l'ouverture d'un PDF ne la paie pas.
  const { PDFDocument, PDFHexString, rgb, BlendMode, LineCapStyle } = await import('@cantoo/pdf-lib')

  let doc: Awaited<ReturnType<typeof PDFDocument.load>>
  try {
    doc = await PDFDocument.load(source, { updateMetadata: false })
  } catch (error) {
    throw new PdfBurnError(
      error instanceof Error && /encrypt/i.test(error.message)
        ? 'Ce PDF est protégé : Doku ne peut pas y écrire.'
        : 'Ce PDF n’a pas pu être ouvert en écriture.',
    )
  }

  const pages = doc.getPages()
  let burned = 0
  let notes = 0
  let skipped = 0
  // Repères déjà posés, PAR PAGE : c'est ce qui permet à deux commentaires voisins de ne
  // pas se recouvrir.
  const placed = new Map<number, PdfDrawingRect[]>()

  for (const drawing of wanted) {
    const pageIndex = drawing.page - 1
    const page = pages[drawing.page - 1]
    if (!page) {
      skipped++
      continue
    }
    const crop = page.getCropBox()
    const target: PdfBurnPage = {
      x: crop.x,
      y: crop.y,
      width: crop.width,
      height: crop.height,
      rotation: normalizePdfRotation(page.getRotation().angle),
    }
    const { r, g, b } = pdfRgbFromHex(drawing.color)
    const color = rgb(r, g, b)
    const width = pdfBurnStrokeWidth(drawing.strokeWidth, target)

    if (isPdfStrokeDrawing(drawing)) {
      const highlight = drawing.kind === 'highlight'
      const anchor = pdfBurnAnchor(target)
      page.drawSvgPath(pdfBurnPathData(drawing.strokes, target), {
        x: anchor.x,
        y: anchor.y,
        borderColor: color,
        borderWidth: width,
        borderOpacity: highlight ? PDF_BURN_HIGHLIGHT_OPACITY : 1,
        borderLineCap: LineCapStyle.Round,
        // Le surligneur doit laisser lire le texte AU TRAVERS — c'est le `multiply` de
        // l'écran, qui existe tel quel en PDF (ExtGState /BM /Multiply).
        blendMode: highlight ? BlendMode.Multiply : undefined,
      })
    } else if (isPdfTextHighlight(drawing)) {
      for (const rect of drawing.rects) {
        const box = pdfBurnRect(rect, target)
        page.drawRectangle({
          ...box,
          color,
          opacity: PDF_BURN_TEXT_OPACITY,
          blendMode: BlendMode.Multiply,
        })
      }
    } else if (isPdfShapeDrawing(drawing)) {
      const box = pdfBurnRect(drawing, target)
      if (drawing.kind === 'rectangle') {
        page.drawRectangle({ ...box, borderColor: color, borderWidth: width, opacity: 0 })
      } else {
        page.drawEllipse({
          x: box.x + box.width / 2,
          y: box.y + box.height / 2,
          xScale: box.width / 2,
          yScale: box.height / 2,
          borderColor: color,
          borderWidth: width,
          opacity: 0,
        })
      }
    } else {
      skipped++
      continue
    }
    burned++

    // La note devient une vraie annotation PDF « pense-bête » : elle s'ouvre dans
    // Acrobat comme n'importe quel commentaire, au lieu d'être perdue ou aplatie en
    // décor illisible. Texte en hexadécimal UTF-16 — un PDFString latin-1 mutilerait
    // les accents.
    if (drawing.comment) {
      const marqueurs = placed.get(pageIndex) ?? []
      const marqueur = pdfNoteMarkerRect(pdfDrawingBox(drawing), target, marqueurs)
      marqueurs.push(marqueur)
      placed.set(pageIndex, marqueurs)
      const zone = pdfBurnRect(marqueur, target)
      const ref = doc.context.register(doc.context.obj({
        Type: 'Annot',
        Subtype: 'Text',
        Name: 'Comment',
        Rect: [zone.x, zone.y, zone.x + zone.width, zone.y + zone.height],
        Contents: PDFHexString.fromText(drawing.comment),
        T: PDFHexString.fromText('Doku'),
        C: [r, g, b],
        F: 4, // imprimable
      }))
      page.node.addAnnot(ref)
      notes++
    }
  }

  if (!burned) throw new PdfBurnError('Aucune annotation n’a pu être placée dans ce PDF.')
  const bytes = await doc.save()
  return { bytes, burned, notes, skipped }
}

// --- Recomposition des pages (ADR-0022, palier 2) ----------------------------------

export interface PdfPagesOutcome {
  bytes: Uint8Array
  pages: number
}

// Applique un plan de pages : `sources[0]` est le document ouvert, les suivants sont les
// PDF insérés. Les pages sont COPIÉES dans un document neuf — ce qui embarque au passage
// leurs polices et leurs images, et laisse derrière ce que plus aucune page n'utilise.
export async function applyPdfPagePlan(sources: Uint8Array[], plan: PdfPagePlan): Promise<PdfPagesOutcome> {
  if (!plan.length) throw new PdfBurnError('Un PDF ne peut pas être vide.')
  const { PDFDocument, degrees } = await import('@cantoo/pdf-lib')

  const loaded: Awaited<ReturnType<typeof PDFDocument.load>>[] = []
  for (const bytes of sources) {
    try {
      loaded.push(await PDFDocument.load(bytes, { updateMetadata: false }))
    } catch {
      throw new PdfBurnError('Un des documents n’a pas pu être ouvert.')
    }
  }

  const out = await PDFDocument.create()
  // Une seule copie par document d'origine : `copyPages` déduplique les ressources
  // partagées, alors qu'un appel par page rembarquerait la même police à chaque fois.
  const copied = new Map<number, Awaited<ReturnType<typeof out.copyPages>>>()
  for (const entry of plan) {
    const origin = loaded[entry.from]
    if (!origin) throw new PdfBurnError('Un des documents insérés est introuvable.')
    if (!copied.has(entry.from)) {
      copied.set(entry.from, await out.copyPages(origin, origin.getPageIndices()))
    }
    const page = copied.get(entry.from)![entry.source - 1]
    if (!page) throw new PdfBurnError('Une des pages demandées n’existe plus.')
    out.addPage(page)
  }

  // Rotation appliquée APRÈS l'ajout : elle compose avec le `/Rotate` que la page
  // portait déjà, au lieu de l'écraser.
  out.getPages().forEach((page, index) => {
    const turn = normalizePdfTurn(plan[index].turn)
    if (turn) page.setRotation(degrees(normalizePdfRotation(page.getRotation().angle + turn * 90)))
  })

  return { bytes: await out.save(), pages: plan.length }
}
