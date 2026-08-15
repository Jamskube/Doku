// Banc de contrôle de « Organiser les pages » : monte la vraie modale avec des ports
// servis par le serveur de dev, pour la piloter aux vrais gestes sans hôte natif.
import { mount } from 'svelte'
import '../../../src/app.css'
import PdfPagesDialog from '../../../src/components/PdfPagesDialog.svelte'
import { app } from '../../../src/lib/stores.svelte'

const params = new URLSearchParams(location.search)
document.documentElement.dataset.theme = params.get('theme') ?? 'light'

async function fetchBytes(path: string): Promise<Uint8Array | null> {
  const response = await fetch(path)
  if (!response.ok) return null
  return new Uint8Array(await response.arrayBuffer())
}

// Ce que le banc écrit est gardé en mémoire pour être inspecté depuis la page.
const written: { name: string; bytes: Uint8Array }[] = []
;(globalThis as unknown as { __written: typeof written }).__written = written

mount(PdfPagesDialog, {
  target: document.querySelector('#app')!,
  props: {
    readBytes: fetchBytes,
    pickPdf: async () => './inserted.pdf',
    writeCopy: async (name: string, bytes: Uint8Array) => {
      written.push({ name, bytes })
      return true
    },
  },
})

app.pdfPagesPath = './organizer.pdf'
