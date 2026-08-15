// Banc de la BOUCLE COMPLÈTE : PDF → DOCX → SuperDoc → DOCX → PDF.
// Chaque maillon est mesuré séparément pour qu'un échec désigne son coupable.
import { convertPdfToDocx } from '../../../src/lib/export/pdf-to-docx'

const app = document.querySelector<HTMLElement>('#app')!
const etapes: Record<string, unknown> = {}
;(globalThis as unknown as { __etapes: typeof etapes }).__etapes = etapes

try {
  const response = await fetch('../pdf-burn/source-0.pdf')
  const pdfDepart = new Uint8Array(await response.arrayBuffer())
  etapes['1-pdf-depart'] = `${pdfDepart.length} octets`

  const converti = await convertPdfToDocx(pdfDepart)
  etapes['2-pdf-vers-docx'] = `${converti.paragraphs} paragraphes, ${converti.bytes.length} octets`

  const [{ SuperDoc }] = await Promise.all([import('superdoc'), import('superdoc/style.css')])
  const file = new File([converti.bytes as BlobPart], 'converti.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
  const editor = new SuperDoc({
    selector: app,
    document: file,
    documentMode: 'editing',
    role: 'editor',
    onReady: () => {
      etapes['3-superdoc-pret'] = true
      document.body.dataset.ready = 'true'
    },
  })
  ;(globalThis as unknown as { __editor: unknown }).__editor = editor
} catch (error) {
  etapes['echec'] = `${String(error)}\n${String((error as Error)?.stack ?? '').slice(0, 600)}`
  document.body.dataset.ready = 'false'
}
