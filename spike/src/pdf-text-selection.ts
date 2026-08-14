import * as pdfjs from 'pdfjs-dist'
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker'
import 'pdfjs-dist/web/pdf_viewer.css'
import './pdf-text-selection.css'

pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker()

interface NormalizedRect { left: number; top: number; width: number; height: number }
interface SelectionResult { page: number; text: string; rects: NormalizedRect[] }
interface PageAlignment {
  page: number
  cssDelta: number
  backingScaleX: number
  backingScaleY: number
  pass: boolean
}
interface SpikeResult {
  dpr: number
  pages: number
  alignments: PageAlignment[]
  selections: Array<{
    page: number
    textLength: number
    rectCount: number
    rectsInsidePage: boolean
    rects: NormalizedRect[]
  }>
  pass: boolean
}

declare global {
  interface Window {
    __dokuPdfAnnotationSpike?: { run: () => Promise<SpikeResult> }
  }
}

const viewer = document.querySelector<HTMLElement>('#viewer')!
const fileInput = document.querySelector<HTMLInputElement>('#pdf-file')!
const verdict = document.querySelector<HTMLElement>('#verdict')!
const log = document.querySelector<HTMLElement>('#log')!
const pageOut = document.querySelector<HTMLElement>('#selection-page')!
const textOut = document.querySelector<HTMLElement>('#selection-text')!
const rectsOut = document.querySelector<HTMLElement>('#selection-rects')!

let loadingTask: ReturnType<typeof pdfjs.getDocument> | null = null

function requestedDpr() {
  const override = Number(new URLSearchParams(window.location.search).get('dpr'))
  return Math.min(Number.isFinite(override) && override > 0 ? override : window.devicePixelRatio || 1, 3)
}

function selectionForWrap(wrap: HTMLElement): SelectionResult | null {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!wrap.contains(range.commonAncestorContainer)) return null
  const pageRect = wrap.getBoundingClientRect()
  if (!pageRect.width || !pageRect.height) return null
  const rects = Array.from(range.getClientRects())
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map((rect) => ({
      left: (rect.left - pageRect.left) / pageRect.width,
      top: (rect.top - pageRect.top) / pageRect.height,
      width: rect.width / pageRect.width,
      height: rect.height / pageRect.height,
    }))
  const text = selection.toString().replace(/\s+/g, ' ').trim()
  if (!text || !rects.length) return null
  return { page: Number(wrap.dataset.page), text, rects }
}

function publishSelection(result: SelectionResult | null) {
  pageOut.textContent = result ? String(result.page) : '—'
  textOut.textContent = result?.text ?? '—'
  rectsOut.textContent = result ? JSON.stringify(result.rects, null, 2) : '—'
}

async function render(bytes: Uint8Array) {
  await loadingTask?.destroy()
  viewer.replaceChildren()
  verdict.textContent = 'rendu…'
  const task = pdfjs.getDocument({ data: bytes, disableFontFace: true, enableXfa: false })
  loadingTask = task
  const pdf = await task.promise
  const dpr = requestedDpr()

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber)
    const natural = page.getViewport({ scale: 1 })
    const cssScale = Math.min(1.35, Math.max(0.5, (viewer.clientWidth - 40) / natural.width))
    const cssViewport = page.getViewport({ scale: cssScale })
    const renderViewport = page.getViewport({ scale: cssScale * dpr })
    const wrap = document.createElement('article')
    wrap.className = 'pdf-spike-page'
    wrap.dataset.page = String(pageNumber)
    wrap.style.width = `${cssViewport.width}px`
    wrap.style.height = `${cssViewport.height}px`
    wrap.style.setProperty('--scale-factor', String(cssViewport.scale))
    wrap.style.setProperty('--user-unit', String(cssViewport.userUnit))

    const canvas = document.createElement('canvas')
    canvas.width = renderViewport.width
    canvas.height = renderViewport.height
    canvas.style.width = `${cssViewport.width}px`
    canvas.style.height = `${cssViewport.height}px`
    const context = canvas.getContext('2d')!

    const textLayer = document.createElement('div')
    textLayer.className = 'textLayer'
    wrap.append(canvas, textLayer)
    viewer.append(wrap)

    await page.render({ canvas, canvasContext: context, viewport: renderViewport }).promise
    const layer = new pdfjs.TextLayer({
      textContentSource: await page.getTextContent(),
      container: textLayer,
      viewport: cssViewport,
    })
    await layer.render()
    wrap.addEventListener('mouseup', () => publishSelection(selectionForWrap(wrap)))
  }
  verdict.textContent = `${pdf.numPages} pages prêtes`
}

async function run(): Promise<SpikeResult> {
  const pages = Array.from(viewer.querySelectorAll<HTMLElement>('.pdf-spike-page'))
  const dpr = requestedDpr()
  const alignments = pages.map((page): PageAlignment => {
    const canvas = page.querySelector<HTMLCanvasElement>('canvas')!
    const textLayer = page.querySelector<HTMLElement>('.textLayer')!
    const pageRect = page.getBoundingClientRect()
    const canvasRect = canvas.getBoundingClientRect()
    const layerRect = textLayer.getBoundingClientRect()
    const cssDelta = Math.max(
      Math.abs(canvasRect.left - pageRect.left),
      Math.abs(canvasRect.top - pageRect.top),
      Math.abs(canvasRect.width - pageRect.width),
      Math.abs(canvasRect.height - pageRect.height),
      Math.abs(layerRect.left - pageRect.left),
      Math.abs(layerRect.top - pageRect.top),
      Math.abs(layerRect.width - pageRect.width),
      Math.abs(layerRect.height - pageRect.height),
    )
    const backingScaleX = canvas.width / canvasRect.width
    const backingScaleY = canvas.height / canvasRect.height
    return {
      page: Number(page.dataset.page),
      cssDelta,
      backingScaleX,
      backingScaleY,
      pass: cssDelta <= 2 && Math.abs(backingScaleX - dpr) <= 0.02 && Math.abs(backingScaleY - dpr) <= 0.02,
    }
  })
  const selections: SpikeResult['selections'] = []
  for (const page of pages) {
    const spans = Array.from(page.querySelectorAll<HTMLElement>('.textLayer span')).filter((span) => span.textContent?.trim())
    if (!spans.length) {
      selections.push({
        page: Number(page.dataset.page),
        textLength: 0,
        rectCount: 0,
        rectsInsidePage: false,
        rects: [],
      })
      continue
    }
    const range = document.createRange()
    range.setStart(spans[0].firstChild ?? spans[0], 0)
    const end = spans[Math.min(spans.length - 1, 3)]
    range.setEnd(end.firstChild ?? end, end.textContent?.length ?? 0)
    const domSelection = window.getSelection()!
    domSelection.removeAllRanges()
    domSelection.addRange(range)
    const result = selectionForWrap(page)
    const rectsInsidePage = Boolean(result?.rects.every((rect) =>
      rect.left >= -0.01 && rect.top >= -0.01 && rect.left + rect.width <= 1.01 && rect.top + rect.height <= 1.01,
    ))
    selections.push({
      page: Number(page.dataset.page),
      textLength: result?.text.length ?? 0,
      rectCount: result?.rects.length ?? 0,
      rectsInsidePage,
      rects: result?.rects ?? [],
    })
  }
  window.getSelection()?.removeAllRanges()
  const pass = selections.length > 0
    && selections.every((item) => item.textLength > 0 && item.rectCount > 0 && item.rectsInsidePage)
    && alignments.every((item) => item.pass)
  const result = { dpr, pages: pages.length, alignments, selections, pass }
  verdict.textContent = pass ? 'PASS' : 'FAIL'
  verdict.className = pass ? 'pass' : 'fail'
  log.textContent = JSON.stringify(result, null, 2)
  return result
}

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0]
  if (file) await render(new Uint8Array(await file.arrayBuffer()))
})
document.querySelector('#btn-run')!.addEventListener('click', () => void run())
window.__dokuPdfAnnotationSpike = { run }

void fetch(new URL('./fixtures/pdf-annotation-test.pdf', window.location.href))
  .then((response) => response.arrayBuffer())
  .then((buffer) => render(new Uint8Array(buffer)))
  .catch((error) => {
    verdict.textContent = 'fixture indisponible'
    log.textContent = String(error)
  })
