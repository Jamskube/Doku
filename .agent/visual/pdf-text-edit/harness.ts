// Banc de « Modifier le texte » : la vraie modale, sur un vrai document, avec des
// ports servis par le serveur de dev.
import { mount } from 'svelte'
import '../../../src/app.css'
import PdfTextEditDialog from '../../../src/components/PdfTextEditDialog.svelte'
import { app } from '../../../src/lib/stores.svelte'

document.documentElement.dataset.theme = 'light'

const written: { name: string; bytes: Uint8Array }[] = []
;(globalThis as unknown as { __written: typeof written }).__written = written

mount(PdfTextEditDialog, {
  target: document.querySelector('#app')!,
  props: {
    readBytes: async (path: string) => {
      const r = await fetch(path)
      return r.ok ? new Uint8Array(await r.arrayBuffer()) : null
    },
    writeCopy: async (name: string, bytes: Uint8Array) => {
      written.push({ name, bytes })
      return true
    },
  },
})

// Déposer un PDF nommé `doc.pdf` dans ce dossier pour rejouer le banc.
app.pdfTextEditPath = './doc.pdf'
