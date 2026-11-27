// Démo de l'îlot (développement seulement, palette « Démo : notifications de l'îlot ») : fait
// passer, l'un après l'autre, chaque type de notification et d'activité qu'il sait montrer, avec
// de fausses données. Aucune action réelle : le « Recharger » vise un onglet qui n'existe pas.
import { app } from './stores.svelte'
import { copilot } from './copilot.svelte'
import { ragState } from './rag-index.svelte'
import { reportExportProgress, trackExport } from './export/progress'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
let running = false

/** Fait monter une progression de 0 à `total` en `ms`, tant que `alive()` reste vrai. */
async function ramp(total: number, ms: number, step: (done: number) => void, alive: () => boolean = () => true) {
  for (let done = 0; done <= total && alive(); done++) {
    step(done)
    await wait(ms / total)
  }
}

export async function runIslandDemo(): Promise<void> {
  if (running) return
  running = true
  try {
    // 1. Notifications : carte, puis pastille de rappel (succès, attention).
    app.banner = { tone: 'success', title: 'Markdown portable enregistré', message: '3 image(s) intégrée(s) dans la copie.' }
    await wait(7_000)
    app.banner = { tone: 'success', title: 'Dossier indexé', message: '42 notes prêtes pour les questions de Doku-San.' }
    await wait(7_000)
    app.banner = { tone: 'warning', title: 'Fichier volumineux', message: 'Au-delà de 5 Mo, l’aperçu en direct est désactivé.' }
    await wait(9_000)
    // 2. File d'attente : deux notifications coup sur coup, la seconde attend son tour.
    app.banner = { tone: 'success', title: 'Copie enregistrée', message: 'notes (copie).md' }
    await wait(400)
    app.banner = { tone: 'success', title: 'Thème appliqué', message: 'Sombre' }
    await wait(12_000)
    // 3. Erreur : la carte reste, puis devient une pastille à point qui attend qu'on la ferme.
    app.banner = { tone: 'error', title: 'Export impossible', message: 'Le dossier de destination est en lecture seule.' }
    await wait(10_000)
    // 4. « Enregistré » (Ctrl+S), deux fois.
    app.savedPulse++
    await wait(2_500)
    app.savedPulse++
    await wait(2_500)
    // 5. Doku-San écrit (panneau fermé).
    copilot.generating = true
    await wait(5_000)
    copilot.generating = false
    await wait(1_500)
    // 6. Téléchargement d'un modèle, avec l'indexation en même temps : la seconde bourgeonne.
    copilot.pulling = { name: 'lfm3-omni-2b', pct: 0, done: 0, total: 0 }
    await wait(1_200)
    const total = 1_049_617_920
    const pulling = ramp(100, 9_000, (pct) => {
      if (copilot.pulling) copilot.pulling = { ...copilot.pulling, pct, done: (total * pct) / 100, total }
    }, () => !!copilot.pulling)
    await wait(2_500)
    ragState.dir = 'C:/Notes'
    ragState.phase = 'indexing'
    await ramp(40, 5_000, (done) => {
      ragState.done = done
      ragState.total = 40
    }, () => ragState.phase === 'indexing')
    if (ragState.phase === 'indexing') ragState.phase = 'idle'
    await pulling
    copilot.pulling = null
    await wait(1_500)
    // 7. Export page à page.
    await trackExport('Impression en PDF', () => ramp(8, 4_500, (done) => reportExportProgress(done, 8)))
    await wait(1_500)
    // 8. Fichier modifié ailleurs : carte, puis pastille ; « Recharger » ne vise aucun onglet.
    app.reloadPrompt = { tabId: -1, name: 'notes.md' }
  } finally {
    running = false
  }
}
