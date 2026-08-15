// Contrôle de la gravure : rend le PDF SOURCE et le PDF GRAVÉ côte à côte, avec le
// moteur qui sert dans l'app (pdf.js), pour comparer ce qu'on voyait à ce qui a été
// écrit. Une page droite, une page tournée à 90°.
import * as pdfjs from 'pdfjs-dist'
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker'

pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker()

const app = document.querySelector<HTMLElement>('#app')!
const only = new URLSearchParams(location.search).get('only')
const targets = (only ? [only] : ['source-0', 'burn-0', 'source-90', 'burn-90'])

for (const name of targets) {
  const response = await fetch(`./${name}.pdf`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const doc = await pdfjs.getDocument({ data: bytes, disableFontFace: true, enableXfa: false }).promise
  const page = await doc.getPage(1)
  const viewport = page.getViewport({ scale: 1.15 })
  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  const ctx = canvas.getContext('2d')!
  await page.render({ canvas, canvasContext: ctx, viewport }).promise
  const figure = document.createElement('figure')
  const caption = document.createElement('figcaption')
  caption.textContent = name
  figure.append(canvas, caption)
  app.appendChild(figure)
}

document.body.dataset.ready = 'true'
