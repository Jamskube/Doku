// Banc de l'éditeur Word de Doku : monte la VRAIE vue `DocxView` sur un vrai `.docx`,
// pour vérifier ce qu'on ne peut vérifier qu'à l'œil — que la barre d'outils de SuperDoc
// est bien là, que le document s'édite, et que les actions de Doku vivent dans la même
// rangée.
//
// Le document de départ est fabriqué ici avec la bibliothèque `docx` que Doku embarque
// déjà pour son export : le banc ne dépend d'aucun fichier posé à la main.
import { mount } from 'svelte'
import '../../../src/app.css'
import DocxView from '../../../src/components/DocxView.svelte'

document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') ?? 'light'

const etapes: Record<string, unknown> = {}
;(globalThis as unknown as { __etapes: typeof etapes }).__etapes = etapes

// Le document de départ, fabriqué avec la bibliothèque `docx` que Doku embarque déjà.
const { Document, Packer, Paragraph, HeadingLevel, TextRun } = await import('docx')
const doc = new Document({
  sections: [{
    children: [
      new Paragraph({ text: 'Rapport trimestriel', heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ children: [
        new TextRun('Le premier paragraphe mêle du '),
        new TextRun({ text: 'gras', bold: true }),
        new TextRun(', de l’'),
        new TextRun({ text: 'italique', italics: true }),
        new TextRun(' et du texte ordinaire — de quoi voir la barre d’outils réagir à la sélection.'),
      ] }),
      new Paragraph({ text: 'Section suivante', heading: HeadingLevel.HEADING_2 }),
      new Paragraph({ text: 'Un second paragraphe, pour que le document ait de la matière à éditer.' }),
    ],
  }],
})
const bytes = new Uint8Array(await (await Packer.toBlob(doc)).arrayBuffer())
etapes['1-docx-de-depart'] = `${bytes.length} octets`

const ecrits: { path: string; bytes: Uint8Array }[] = []
;(globalThis as unknown as { __ecrits: typeof ecrits }).__ecrits = ecrits

mount(DocxView, {
  target: document.querySelector('#app')!,
  props: {
    path: 'C:\\Doku-fixtures\\rapport.docx',
    tabId: 1,
    readBytes: async () => bytes,
    writeFile: async (chemin: string, octets: Uint8Array) => {
      ecrits.push({ path: chemin, bytes: octets })
      return true
    },
    savePdf: async () => true,
    onEditorReady: (instance: unknown) => {
      ;(globalThis as unknown as { __superdoc: unknown }).__superdoc = instance
      etapes['2-superdoc-pret'] = true
      document.body.dataset.ready = 'true'
    },
  },
})

// Ce que le banc observe est posé sur le document pour être lu de l'extérieur.
const observer = new MutationObserver(() => {
  const outils = document.querySelectorAll('.docx-toolbar button, .docx-toolbar [role="button"]').length
  if (outils > 0) {
    etapes['2-outils-montes'] = outils
    document.body.dataset.ready = 'true'
  }
})
observer.observe(document.body, { childList: true, subtree: true })
