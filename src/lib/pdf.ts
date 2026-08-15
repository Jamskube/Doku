// Pipeline de rendu PDF (11.1, ADR-0011). PDF.js — pur JS/WASM, 100 % offline. Le worker
// est chargé via l'import `?worker` de Vite (asset local hashé, aucun CDN). Lecture seule :
// - Rendu canvas seul, AUCUNE couche scripting/annotation montée → le JS embarqué du PDF
//   n'est jamais exécuté, aucun vecteur `/URI` phone-home (pdfjs v6 n'exécute le scripting
//   que si on câble le ScriptingManager, ce qu'on ne fait pas).
// - `disableFontFace:true` → glyphes en tracés canvas → aucune modif CSP `font-src`.
// - La CSP n'a pas de `script-src` → l'app n'exige pas `unsafe-eval` (rendu canvas OK) ;
//   si `script-src` est durci un jour, revalider le rendu des polices (v6 a retiré `isEvalSupported`).
// LIMITE (spike) : les CMaps (CJK) et décodeurs WASM (JPEG2000/JBIG2) ne sont PAS bundlés →
// ces PDF dégradent (glyphes/images vides). Bundling cmap/standardfont/wasm = reste de 11.1.
import * as pdfjs from 'pdfjs-dist'
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { assemblePageItems, buildPdfExtraction, matchPassageRange, type PdfExtraction, type PdfTextItem } from './pdf-text'
import { locateOffset } from './citations'
import { readFileBytes } from './tauri'

pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker()

export type PdfDoc = PDFDocumentProxy

export interface LoadedPdf {
  doc: PdfDoc
  destroy: () => Promise<void>
}

// ATTENTION : PDF.js **transfère** le tableau passé en `data` à son worker — le
// buffer de l'appelant est DÉTACHÉ (`byteLength` tombe à 0) dès le chargement. Tout
// appelant qui garde ses octets pour plus tard (écrire une copie, calculer une
// empreinte) récupérerait un tableau vide, sans la moindre erreur. On lui en donne
// donc une copie : le coût d'une duplication vaut mieux qu'un piège invisible posé
// pour chaque futur appelant.
export async function loadPdf(bytes: Uint8Array): Promise<LoadedPdf> {
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    disableFontFace: true,
    enableXfa: false,
  })
  const doc = await task.promise
  // La destruction passe par la loadingTask (libère le worker) — évite les fuites au changement d'onglet.
  return { doc, destroy: () => task.destroy() }
}

// Dimensions d'une page à une échelle donnée (sans rendu) — pour dimensionner le canvas
// placeholder avant rendu paresseux.
export async function pageSize(pdf: PdfDoc, pageNumber: number, scale: number): Promise<{ width: number; height: number }> {
  const page = await pdf.getPage(pageNumber)
  const vp = page.getViewport({ scale })
  page.cleanup()
  return { width: vp.width, height: vp.height }
}

export async function renderPage(pdf: PdfDoc, pageNumber: number, canvas: HTMLCanvasElement, scale: number): Promise<void> {
  const page = await pdf.getPage(pageNumber)
  const viewport = page.getViewport({ scale })
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  canvas.width = viewport.width
  canvas.height = viewport.height
  const task = page.render({ canvas, canvasContext: ctx, viewport })
  try {
    await task.promise
  } finally {
    page.cleanup()
  }
}

// --- Extraction de texte (18.1, Epic 18) ------------------------------------------------
// Couche texte des PDF, séparée du rendu canvas : `getTextContent()` par page (options par
// défaut → texte normalisé, pas de marked-content). L'assemblage et la détection « scanné »
// vivent dans pdf-text.ts (pur, testé) ; ici seulement l'appel pdfjs. 0 réseau : aucune URL
// cMap/font n'est passée (ADR-0011), l'extraction reste locale comme le rendu.
export async function extractPdfText(bytes: Uint8Array, signal?: AbortSignal): Promise<PdfExtraction> {
  const { doc, destroy } = await loadPdf(bytes)
  try {
    const pages: PdfTextItem[][] = []
    for (let n = 1; n <= doc.numPages; n++) {
      // Annulable entre pages (Stop pendant l'extraction d'un gros PDF) : granularité page,
      // suffisante sur ARM. Le catch appelant traite `aborted` comme une annulation propre.
      if (signal?.aborted) throw new DOMException('extraction annulée', 'AbortError')
      const page = await doc.getPage(n)
      try {
        const tc = await page.getTextContent()
        pages.push(tc.items.map((it) => ({ str: (it as { str?: string }).str ?? '', hasEOL: (it as { hasEOL?: boolean }).hasEOL ?? false })))
      } finally {
        page.cleanup() // libère les ressources worker de la page (comme le rendu)
      }
    }
    return buildPdfExtraction(pages)
  } finally {
    await destroy()
  }
}

// --- Surlignage d'un passage cité (citations ancrées, 21.x) -----------------------------
// Rectangles des items de texte couverts par un passage sur UNE page, en FRACTIONS de la
// page (0..1) : l'overlay se positionne en % du canvas, insensible à l'échelle/DPR. Pas de
// couche texte pdf.js montée (le viewer reste canvas-only, cf. en-tête) : on ne fait que
// lire les coordonnées des items. Liste vide si le passage n'est pas retrouvé — l'appelant
// retombe sur le halo de page, jamais de faux surlignage.
export interface CitedRect { left: number; top: number; width: number; height: number }

export async function getCitedRects(pdf: PdfDoc, pageNumber: number, passage: string): Promise<CitedRect[]> {
  const page = await pdf.getPage(pageNumber)
  try {
    const viewport = page.getViewport({ scale: 1 })
    if (!viewport.width || !viewport.height) return []
    const tc = await page.getTextContent()
    const items = tc.items as { str?: string; hasEOL?: boolean; transform?: number[]; width?: number }[]
    const { text, ranges } = assemblePageItems(
      items.map((it) => ({ str: it.str ?? '', hasEOL: it.hasEOL ?? false })),
    )
    const anchor = locateOffset(text, passage)
    if (!anchor) return []
    const span = matchPassageRange(text, passage, anchor)
    const rects: CitedRect[] = []
    for (let i = 0; i < items.length && rects.length < 300; i++) {
      const r = ranges[i]
      if (r.end <= span.start || r.start >= span.end) continue
      const it = items[i]
      if (!it.transform || !it.str?.trim()) continue
      // Position device de l'item : transform de page × transform d'item ; la hauteur de
      // ligne vient de la matrice (hypot des composantes verticales — gère la rotation).
      const tx = pdfjs.Util.transform(viewport.transform, it.transform)
      const h = Math.hypot(tx[2], tx[3])
      const w = it.width ?? 0
      if (w <= 0 || h <= 0) continue
      rects.push({
        left: tx[4] / viewport.width,
        top: (tx[5] - h) / viewport.height,
        width: w / viewport.width,
        height: h / viewport.height,
      })
    }
    return rects
  } finally {
    page.cleanup()
  }
}

// Service caché par chemin : le copilote (18.2) et l'index (18.3) demandent le texte d'un
// PDF de façon répétée sans le ré-extraire. Cache mono-emplacement (motif docCache 15.3) :
// le doc ACTIF est le cas courant. Invalidé si la TAILLE d'octets change (fichier remplacé
// sur disque) — mtime indisponible à moindre coût, la taille capte le cas courant.
// null en navigateur / si illisible.
let pdfTextCache: { path: string; size: number; result: PdfExtraction } | null = null

export async function getPdfText(path: string, signal?: AbortSignal): Promise<PdfExtraction | null> {
  const bytes = await readFileBytes(path)
  if (!bytes) return null
  if (pdfTextCache && pdfTextCache.path === path && pdfTextCache.size === bytes.length) {
    return pdfTextCache.result
  }
  const result = await extractPdfText(bytes, signal)
  pdfTextCache = { path, size: bytes.length, result }
  return result
}
