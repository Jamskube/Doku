// Banc de la correction de PDF par consigne : la VRAIE modale, sur un vrai document, avec
// une réponse de modèle simulée mais passée par le VRAI parseur.
//
// Le moteur cloud n'est pas joignable en mode navigateur : `correctPdfPage` s'arrêterait à
// `resolveRuntime`. On pose donc le run à la main — mais les propositions affichées sont
// bien celles que `parsePdfCorrections` rend à partir d'une réponse JSON brute, contre les
// lignes réelles de la page. C'est le contrat qu'on regarde, pas une maquette.
import { mount } from 'svelte'
import '../../../src/app.css'
import PdfTextEditDialog from '../../../src/components/PdfTextEditDialog.svelte'
import { app } from '../../../src/lib/stores.svelte'
import { pdfCorrection } from '../../../src/lib/copilot.svelte'
import { lineLabel, parsePdfCorrections, type CorrectableLine } from '../../../src/lib/pdf-correction'
import { readEditableLines } from '../../../src/lib/export/pdf-edit-text'

document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') ?? 'light'

// Fournisseur cloud : sans lui la barre de consigne affiche sa raison d'indisponibilité,
// et le chemin qu'on veut voir n'existe pas.
app.copilotProvider = 'openai'

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

app.pdfTextEditPath = './doc.pdf'

/**
 * Pose un run « prêt » comme si le modèle avait répondu.
 *
 * `reponse` est la réponse JSON BRUTE : elle traverse `parsePdfCorrections`, donc toutes
 * les gardes (étiquette inconnue, passage ambigu, colonne, largeur…) s'appliquent — le banc
 * montre ce que l'utilisateur verrait vraiment.
 */
async function poser(page: number, reponse: string) {
  const octets = new Uint8Array(await (await fetch('./doc.pdf')).arrayBuffer())
  const lignes = (await readEditableLines(octets)).filter((l) => l.page === page && l.editable)
  const fermees: CorrectableLine[] = lignes.map((l) => ({
    text: l.text,
    left: l.left,
    width: l.width,
    top: l.top,
    height: l.height,
  }))
  const { edits, dropped } = parsePdfCorrections(reponse, fermees)
  pdfCorrection.current = {
    id: 1,
    path: './doc.pdf',
    page,
    revision: 0,
    instruction: 'corrige les fautes de cette page',
    targets: lignes.map((l) => ({ page: l.page, occurrence: l.occurrence, text: l.text })),
    edits,
    dropped,
    phase: 'ready',
    error: '',
  }
  return { lignes: fermees.map((l, i) => `${lineLabel(i)} ${l.text}`), edits, dropped }
}

;(globalThis as unknown as { __poser: typeof poser }).__poser = poser
;(globalThis as unknown as { __pdfCorrection: typeof pdfCorrection }).__pdfCorrection = pdfCorrection
