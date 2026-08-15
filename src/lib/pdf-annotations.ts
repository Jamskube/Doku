import { canonicalPathKey } from './save-as'
import {
  MAX_PDF_DRAWING_STROKES,
  MAX_PDF_TEXT_RECTS,
  MAX_PDF_STROKE_WIDTH,
  PDF_DRAWING_COLOR,
  PDF_DRAWING_STROKE_WIDTH,
  PDF_HIGHLIGHT_COLOR,
  fitPdfDrawingStrokes,
  normalizePdfDrawingPoint,
  normalizePdfDrawingRect,
  pdfDrawingTop,
  type PdfDrawing,
  type PdfDrawingPoint,
  type PdfDrawingRect,
} from './pdf-drawing'

export type PdfAnnotationStatus = 'active' | 'orphaned'

export interface PdfAnnotationIdentity {
  key: string
  fingerprint: string
}

// v5 : tout est un tracé. Les surlignages des manifestes v1..v3 vivaient dans un
// tableau `annotations` séparé, avec leur propre chemin de rendu et d'édition ; ils
// sont migrés à la lecture en tracés `kind: 'text'`, strictement équivalents mais
// qui héritent de la gomme, des couleurs, des notes et de l'historique.
export interface PdfAnnotationManifest {
  version: 5
  document: PdfAnnotationIdentity
  drawings: PdfDrawing[]
}

// Vue unifiée pour le carnet et les épingles de gouttière.
export interface PdfNote {
  id: string
  page: number
  kind: PdfDrawing['kind']
  quote: string
  comment: string
  top: number
  status: PdfAnnotationStatus
  createdAt: string
}

const MAX_QUOTE = 4_000
const MAX_COMMENT = 8_000
const MAX_DRAWINGS = 2_000

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return bytesToHex(new Uint8Array(digest))
}

export async function pdfAnnotationIdentity(path: string, bytes: Uint8Array): Promise<PdfAnnotationIdentity> {
  const pathBytes = new TextEncoder().encode(canonicalPathKey(path))
  return { key: await sha256(pathBytes), fingerprint: await sha256(bytes) }
}

export function emptyPdfAnnotationManifest(document: PdfAnnotationIdentity): PdfAnnotationManifest {
  return { version: 5, document, drawings: [] }
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function normalizeRect(value: unknown): PdfDrawingRect | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (![raw.left, raw.top, raw.width, raw.height].every(finite)) return null
  return normalizePdfDrawingRect({
    left: raw.left as number,
    top: raw.top as number,
    width: raw.width as number,
    height: raw.height as number,
  })
}

function normalizeDrawingPoint(value: unknown): PdfDrawingPoint | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (!finite(raw.x) || !finite(raw.y)) return null
  return normalizePdfDrawingPoint({ x: raw.x, y: raw.y })
}

function drawingBase(raw: Record<string, unknown>, stale: boolean) {
  const color = typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : PDF_DRAWING_COLOR
  const strokeWidth = finite(raw.strokeWidth)
    ? Math.min(Math.max(raw.strokeWidth, 1), MAX_PDF_STROKE_WIDTH)
    : PDF_DRAWING_STROKE_WIDTH
  const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : new Date(0).toISOString()
  return {
    id: (raw.id as string).slice(0, 120),
    page: Math.floor(raw.page as number),
    color,
    strokeWidth,
    comment: text(raw.comment, MAX_COMMENT),
    createdAt,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : createdAt,
    status: stale || raw.status === 'orphaned' ? 'orphaned' as const : 'active' as const,
  }
}

function normalizeDrawing(value: unknown, stale: boolean): PdfDrawing | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== 'string' || !raw.id || !finite(raw.page) || raw.page < 1) return null
  const kind = raw.kind
  if (kind !== 'ink' && kind !== 'highlight' && kind !== 'text' && kind !== 'rectangle' && kind !== 'ellipse') return null
  const base = drawingBase(raw, stale)
  if (kind === 'ink' || kind === 'highlight') {
    // v4 et avant : un tracé = une passe (`points`). v5 : un tracé = un bloc de
    // passes (`strokes`). L'ancien champ devient donc une passe unique.
    const source: unknown[] = Array.isArray(raw.strokes)
      ? raw.strokes
      : Array.isArray(raw.points) ? [raw.points] : []
    const strokes = source
      .map((stroke) => (Array.isArray(stroke)
        ? stroke.map(normalizeDrawingPoint).filter((point): point is PdfDrawingPoint => Boolean(point))
        : []))
      .filter((stroke) => stroke.length >= 2)
      // Un bloc = un tracé en plusieurs passes ; c'est bien un nombre de PASSES qu'on
      // borne ici, le plafond de points étant appliqué juste après par `fit`.
      .slice(0, MAX_PDF_DRAWING_STROKES)
    if (!strokes.length) return null
    const trimmed = fitPdfDrawingStrokes(strokes)
    return kind === 'highlight'
      ? { ...base, kind: 'highlight', strokes: trimmed, quote: text(raw.quote, MAX_QUOTE) }
      : { ...base, kind: 'ink', strokes: trimmed }
  }
  if (kind === 'text') {
    if (!Array.isArray(raw.rects)) return null
    const rects = raw.rects
      .slice(0, MAX_PDF_TEXT_RECTS)
      .map(normalizeRect)
      .filter((rect): rect is PdfDrawingRect => Boolean(rect))
    return rects.length ? { ...base, kind: 'text', rects, quote: text(raw.quote, MAX_QUOTE) } : null
  }
  if (![raw.left, raw.top, raw.width, raw.height].every(finite)) return null
  const box = normalizePdfDrawingRect({
    left: raw.left as number,
    top: raw.top as number,
    width: raw.width as number,
    height: raw.height as number,
  })
  return box && box.width >= 0.002 && box.height >= 0.002 ? { ...base, kind, ...box } : null
}

// Surlignage d'un manifeste v1..v3 : même contenu, autre emballage. La couleur ambre
// d'alors devient la couleur par défaut du surligneur, donc l'aspect ne bouge pas.
function migrateLegacyAnnotation(value: unknown, stale: boolean): PdfDrawing | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== 'string' || !raw.id || !finite(raw.page) || (raw.page as number) < 1) return null
  if (!Array.isArray(raw.rects)) return null
  const rects = raw.rects
    .slice(0, MAX_PDF_TEXT_RECTS)
    .map(normalizeRect)
    .filter((rect): rect is PdfDrawingRect => Boolean(rect))
  if (!rects.length) return null
  return {
    ...drawingBase({ ...raw, color: PDF_HIGHLIGHT_COLOR }, stale),
    kind: 'text',
    rects,
    quote: text(raw.quote, MAX_QUOTE),
  }
}

export interface ParsedPdfAnnotationManifest {
  manifest: PdfAnnotationManifest
  stale: boolean
  // Un fichier présent mais incompréhensible (JSON cassé, version postérieure à cette
  // build) n'est PAS un carnet vide : l'écraser détruirait le travail de l'utilisateur.
  // L'appelant doit le préserver avant toute écriture.
  unreadable: boolean
}

function unreadableManifest(document: PdfAnnotationIdentity): ParsedPdfAnnotationManifest {
  return { manifest: emptyPdfAnnotationManifest(document), stale: false, unreadable: true }
}

export function parsePdfAnnotationManifest(
  json: string | null,
  document: PdfAnnotationIdentity,
): ParsedPdfAnnotationManifest {
  if (!json) return { manifest: emptyPdfAnnotationManifest(document), stale: false, unreadable: false }
  try {
    const raw = JSON.parse(json) as Record<string, unknown>
    const version = raw.version
    if (typeof version !== 'number' || version < 1 || version > 5) return unreadableManifest(document)
    if (!raw.document || typeof raw.document !== 'object') return unreadableManifest(document)
    const stored = raw.document as Record<string, unknown>
    // Clé étrangère = collision de nom de fichier, pas une corruption : le carnet de
    // CE document est simplement vide.
    if (stored.key !== document.key) return { manifest: emptyPdfAnnotationManifest(document), stale: false, unreadable: false }
    const stale = stored.fingerprint !== document.fingerprint
    const migrated = Array.isArray(raw.annotations)
      ? raw.annotations.map((annotation) => migrateLegacyAnnotation(annotation, stale))
      : []
    const kept = Array.isArray(raw.drawings)
      ? raw.drawings.map((drawing) => normalizeDrawing(drawing, stale))
      : []
    const drawings = [...migrated, ...kept]
      .filter((drawing): drawing is PdfDrawing => Boolean(drawing))
      .slice(0, MAX_DRAWINGS)
    return { manifest: { version: 5, document, drawings }, stale, unreadable: false }
  } catch {
    return unreadableManifest(document)
  }
}

export function upsertPdfDrawing(manifest: PdfAnnotationManifest, drawing: PdfDrawing): PdfAnnotationManifest {
  const replacing = manifest.drawings.some((item) => item.id === drawing.id)
  if (!replacing && manifest.drawings.length >= MAX_DRAWINGS) throw new Error('Limite d’annotations atteinte.')
  return { ...manifest, drawings: [...manifest.drawings.filter((item) => item.id !== drawing.id), drawing] }
}

export function removePdfDrawing(manifest: PdfAnnotationManifest, id: string): PdfAnnotationManifest {
  return { ...manifest, drawings: manifest.drawings.filter((drawing) => drawing.id !== id) }
}

// Un tracé orphelin (PDF modifié sous les pieds du carnet) n'est plus affiché : ses
// coordonnées ne veulent plus rien dire sur la nouvelle mise en page. Il reste donc
// conservé mais invisible — d'où cette purge explicite, seule sortie offerte à
// l'utilisateur pour ne pas le laisser avec des données inatteignables.
export function removeOrphanedPdfDrawings(manifest: PdfAnnotationManifest): PdfAnnotationManifest {
  return { ...manifest, drawings: manifest.drawings.filter((drawing) => drawing.status !== 'orphaned') }
}

export function updatePdfDrawingComment(
  manifest: PdfAnnotationManifest,
  id: string,
  comment: string,
  now = new Date().toISOString(),
): PdfAnnotationManifest {
  const nextComment = comment.trim().slice(0, MAX_COMMENT)
  return {
    ...manifest,
    drawings: manifest.drawings.map((drawing) => drawing.id === id
      ? { ...drawing, comment: nextComment, updatedAt: now }
      : drawing),
  }
}

export function pdfNoteFromDrawing(drawing: PdfDrawing): PdfNote {
  return {
    id: drawing.id,
    page: drawing.page,
    kind: drawing.kind,
    quote: drawing.kind === 'highlight' || drawing.kind === 'text' ? drawing.quote : '',
    comment: drawing.comment,
    top: pdfDrawingTop(drawing),
    status: drawing.status,
    createdAt: drawing.createdAt,
  }
}

// Ce qui mérite une ligne au carnet : tout surlignage (il porte une citation) et
// tout tracé commenté. Un simple trait de crayon sans note n'y figure pas — ce
// serait du bruit, et il reste sélectionnable sur la page.
export function pdfNotes(manifest: PdfAnnotationManifest): PdfNote[] {
  return manifest.drawings
    .map(pdfNoteFromDrawing)
    .filter((note) => note.comment || note.quote)
    .sort((left, right) => left.page - right.page || left.top - right.top)
}

// Regroupe les épingles trop proches pour rester lisibles dans la gouttière.
export function clusterPdfNotePins(notes: PdfNote[], pageHeight: number, minimumGap = 34): PdfNote[][] {
  const ordered = notes
    .filter((note) => note.status === 'active' && Boolean(note.comment))
    .sort((left, right) => left.top - right.top)
  const clusters: PdfNote[][] = []
  const safeHeight = Math.max(pageHeight, 1)
  for (const note of ordered) {
    const previous = clusters.at(-1)?.at(-1)
    if (previous && (note.top - previous.top) * safeHeight < minimumGap) {
      clusters.at(-1)!.push(note)
    } else {
      clusters.push([note])
    }
  }
  return clusters
}
