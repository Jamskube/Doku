// Banc du menu de sélection Markdown : monte la VRAIE `DocumentView` sur un onglet .md, pour
// regarder ce qu'aucun test ne peut dire — l'allure du tiroir « Réécrire avec Doku-San » une
// fois la consigne libre ajoutée, et l'aplomb du champ de saisie dans la bulle.
//
// Le modèle n'est jamais appelé : le banc s'arrête à la saisie de la consigne (au-delà, c'est
// le chemin de reformulation déjà en place, identique pour les six verbes).
import { mount } from 'svelte'
import '../../../src/app.css'
import DocumentView from '../../../src/components/DocumentView.svelte'
import { activeEditorView, app, openTab } from '../../../src/lib/stores.svelte'
import { rephrase } from '../../../src/lib/copilot.svelte'

// Exposés pour le banc : sans moteur IA en mode navigateur, la phase « streaming » — donc
// l'en-tête qui rappelle la consigne — ne peut être atteinte qu'en la posant à la main, et
// l'aperçu exige des bornes qui portent VRAIMENT le texte d'origine (garde anti-TOCTOU).
;(globalThis as unknown as { __rephrase: typeof rephrase; __view: typeof activeEditorView }).__rephrase = rephrase
;(globalThis as unknown as { __view: typeof activeEditorView }).__view = activeEditorView

const params = new URLSearchParams(location.search)
document.documentElement.dataset.theme = params.get('theme') ?? 'light'

// Un modèle actif : sans lui le tiroir affiche la note « Aucun modèle actif » et le chemin
// qu'on veut voir n'existe pas.
app.activeModel = 'qwen2.5:1.5b-instruct-q4_0'
app.copilotProvider = 'ollama'

const tab = openTab(
  'rapport.md',
  'C:\\Doku-fixtures\\rapport.md',
  [
    '# Rapport trimestriel',
    '',
    'Le premier paragraphe contient assez de matière pour être sélectionné, réécrit, traduit',
    'ou mis au passé — c’est exactement ce que la consigne libre doit rendre possible.',
    '',
    '## Section suivante',
    '',
    'Un second paragraphe, pour que le document ait du corps sous le menu flottant.',
  ].join('\n'),
  'md',
)

mount(DocumentView, {
  target: document.querySelector('#app')!,
  props: { onOpen: () => {}, paneId: 'primary', tabId: tab.id },
})

document.body.dataset.ready = 'true'
