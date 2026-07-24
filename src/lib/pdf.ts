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
import { buildPdfExtraction, type PdfExtraction, type PdfTextItem } from './pdf-text'
import { readFileBytes } from './tauri'

pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker()

export type PdfDoc = PDFDocumentProxy

export interface LoadedPdf {
  doc: PdfDoc
  destroy: () => Promise<void>
}

export async function loadPdf(bytes: Uint8Array): Promise<LoadedPdf> {
  const task = pdfjs.getDocument({
    data: bytes,
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
