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
