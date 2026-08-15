// Banc de la boucle complète : PDF → conversion → édition SuperDoc → PDF.
// Le composant lit ses octets par `readFileBytes` (no-op au navigateur) : on le monte
// donc avec un `path` bidon et on lui injecte les octets par un service worker de
// fortune — ici, plus simple, on remplace la lecture en exposant la conversion
// directement et en montant SuperDoc dessus, ce que fait DocxView en interne.
import { convertPdfToDocx } from '../../../src/lib/export/pdf-to-docx'

const app = document.querySelector<HTMLElement>('#app')!
const log: string[] = []
const say = (text: string) => {
  log.push(text)
  ;(globalThis as unknown as { __log: string[] }).__log = log
}

try {
  const response = await fetch('../pdf-burn/source-0.pdf')
  const pdfBytes = new Uint8Array(await response.arrayBuffer())
  const converted = await convertPdfToDocx(pdfBytes)
  say(`conversion OK — ${converted.paragraphs} paragraphes, ${converted.bytes.length} octets`)

  const [{ SuperDoc }] = await Promise.all([import('superdoc'), import('superdoc/style.css')])
  const file = new File([converted.bytes as BlobPart], 'converti.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
  const editor = new SuperDoc({
    selector: app,
    document: file,
    documentMode: 'editing',
    role: 'editor',
    onReady: () => {
      say('éditeur prêt')
      document.body.dataset.ready = 'true'
    },
  })
  ;(globalThis as unknown as { __editor: unknown }).__editor = editor
} catch (error) {
  say(`ÉCHEC — ${String(error)}`)
  say(String((error as Error)?.stack ?? '').slice(0, 800))
  document.body.dataset.ready = 'false'
}
