// Contrôle de la conversion PDF → DOCX DANS LE NAVIGATEUR : MuPDF est un module WASM
// qui importe `node:fs` dans sa version Node, et Vite l'externalise pour le navigateur.
// Le succès sous Node (vitest) ne prouve donc rien pour la WebView — c'est ce banc qui
// le prouve.
import { convertPdfToDocx } from '../../../src/lib/export/pdf-to-docx'

const out = document.querySelector<HTMLElement>('#out')!
const say = (text: string) => { out.textContent += `\n${text}` }

try {
  out.textContent = 'conversion…'
  const response = await fetch('../pdf-burn/source-0.pdf')
  const bytes = new Uint8Array(await response.arrayBuffer())
  const report = await convertPdfToDocx(bytes)
  say(`OK — ${report.pages} page(s), ${report.paragraphs} paragraphe(s), ${report.characters} caractères, ${report.bytes.length} octets`)
  ;(globalThis as unknown as { __docx: Uint8Array }).__docx = report.bytes
  document.body.dataset.ok = 'true'
} catch (error) {
  say(`ÉCHEC — ${String(error)}`)
  say(String((error as Error)?.stack ?? '').slice(0, 900))
  document.body.dataset.ok = 'false'
}
