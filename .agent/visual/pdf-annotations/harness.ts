import { mount } from 'svelte'
import '../../../src/app.css'
import PdfView from '../../../src/components/PdfView.svelte'

const params = new URLSearchParams(location.search)
document.documentElement.dataset.theme = params.get('theme') ?? 'dark'
const harnessWidth = Number(params.get('width'))
if (Number.isFinite(harnessWidth) && harnessWidth > 0) document.querySelector<HTMLElement>('#app')!.style.width = `${harnessWidth}px`
const response = await fetch('/spike/fixtures/pdf-annotation-test.pdf')
const sourceBytes = new Uint8Array(await response.arrayBuffer())
mount(PdfView, {
  target: document.querySelector('#app')!,
  props: { path: 'C:\\Doku-fixtures\\pdf-annotation-test.pdf', sourceBytes },
})

const trigger = document.createElement('button')
trigger.textContent = 'Sélection test'
trigger.style.cssText = 'position:fixed;z-index:200;left:12px;top:12px;height:30px;border:0;border-radius:999px;padding:0 12px;background:#202024;color:#fff'
trigger.addEventListener('click', () => {
  const spans = document.querySelectorAll<HTMLElement>('.textLayer span')
  if (spans.length < 3) return
  const range = document.createRange()
  range.setStart(spans[1].firstChild ?? spans[1], 5)
  range.setEnd(spans[2].firstChild ?? spans[2], Math.min(24, spans[2].textContent?.length ?? 0))
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  spans[2].dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
})
document.body.appendChild(trigger)

const drawTrigger = document.createElement('button')
drawTrigger.textContent = 'Tracé test'
drawTrigger.style.cssText = 'position:fixed;z-index:200;left:126px;top:12px;height:30px;border:0;border-radius:999px;padding:0 12px;background:#202024;color:#fff'
drawTrigger.addEventListener('click', () => {
  const layer = document.querySelector<SVGSVGElement>('.pdf-drawing-layer')
  if (!layer) return
  const rect = layer.getBoundingClientRect()
  const event = (type: string, x: number, y: number) => layer.dispatchEvent(new PointerEvent(type, {
    bubbles: true,
    button: 0,
    pointerId: 7,
    clientX: rect.left + rect.width * x,
    clientY: rect.top + rect.height * y,
  }))
  event('pointerdown', 0.2, 0.22)
  event('pointermove', 0.32, 0.28)
  event('pointermove', 0.42, 0.24)
  event('pointerup', 0.54, 0.31)
})
document.body.appendChild(drawTrigger)
