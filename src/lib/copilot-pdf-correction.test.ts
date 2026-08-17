// @vitest-environment jsdom
// jsdom obligatoire : `stores.svelte.ts` applique le thème au chargement du module, donc
// touche `document` avant qu'aucun test ne tourne.
//
// Tests d'ORCHESTRATION de la correction de PDF. Le module pur (`pdf-correction.ts`) a les
// siens ; ici on éprouve ce qui vit dans le store et qu'aucun test ne touchait : les gardes
// d'entrée, la machine de phases, le jeton porté par le run, et le fait que le contrôleur
// PARTAGÉ soit rendu quoi qu'il arrive.
//
// Motif repris de `copilot-memory-state.test.ts` : `$state` shimé en identité, dépendances
// de plateforme et de moteur mockées. Rien d'un vrai fournisseur cloud n'est joint.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const moteur = vi.hoisted(() => ({
  reponse: '' as string | (() => Promise<string>),
  appels: 0,
  dernierPrompt: '',
}))

vi.hoisted(() => {
  Object.defineProperty(globalThis, '$state', {
    configurable: true,
    value: <T>(value: T) => value,
  })
})

// Mock PARTIEL : `stores.svelte` appelle bien d'autres exports de `./tauri` au chargement
// (thème système, session…). Ne remplacer que ce qui doit l'être.
vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
  isTauri: false,
  createFileWithContent: async () => null,
}))
vi.mock('./editor/rephrase-preview', () => ({ setRephrasePreview: { of: () => ({}) } }))
vi.mock('./rag-index.svelte', () => ({
  cancelRagIndexing: () => {},
  ragState: {},
  searchDocEphemeral: async () => [],
  searchRag: async () => [],
}))
vi.mock('./ollama', () => ({
  chat: async () => '',
  deleteModel: async () => {},
  generate: async () => '',
  listModels: async () => [],
  pull: async () => {},
  startOllama: async () => null,
  waitReady: async () => false,
}))
vi.mock('./openai', () => ({
  OPENAI_MODEL: 'gpt-test',
  openAiAuthStatus: async () => ({ authenticated: true, preferredAvailable: true }),
  openAiChat: async () => '',
  openAiGenerate: async (prompt: string) => {
    moteur.appels++
    moteur.dernierPrompt = prompt
    return typeof moteur.reponse === 'function' ? moteur.reponse() : moteur.reponse
  },
  beginOpenAiAuth: async () => {},
  cancelOpenAiAuth: async () => {},
  signOutOpenAi: async () => {},
}))

import { app } from './stores.svelte'
import { cancelPdfCorrection, copilot, correctPdfPage, pdfCorrection } from './copilot.svelte'
import type { CorrectableLine } from './pdf-correction'

const ligne = (text: string, left = 0.1, width = 0.3): CorrectableLine =>
  ({ text, left, width, top: 0.2, height: 0.02 })

const LIGNES = [ligne("Le chiffre d'affaire du trimestre"), ligne('Rapport 2025')]
const CIBLES = LIGNES.map((l, i) => ({ page: 5, occurrence: i, text: l.text }))

const demande = (instruction = 'corrige les fautes') => ({
  path: 'C:\\doc.pdf',
  page: 5,
  revision: 0,
  instruction,
  lines: LIGNES,
  // Tableau DISTINCT, comme le composant le construit : passer la même référence des deux
  // côtés rendrait ce câblage indétectable — on pourrait supprimer `geometry` de l'appel
  // sans qu'aucun test ne bronche.
  geometry: LIGNES.map((l) => ({ ...l })),
  targets: CIBLES,
})

beforeEach(() => {
  pdfCorrection.current = null
  copilot.generating = false
  moteur.appels = 0
  moteur.dernierPrompt = ''
  moteur.reponse = '{"edits":[]}'
  app.copilotProvider = 'openai'
  // Compte cloud réputé connecté : sans cela `resolveRuntime` rend `null` et tous les
  // chemins finissent en phase `config`, ce qui masquerait ce qu'on veut éprouver.
  copilot.openAiAuthenticated = true
  copilot.openAiPreferredAvailable = true
})

describe('correctPdfPage', () => {
  it('refuse un fournisseur LOCAL en le disant, sans appeler le moteur', async () => {
    // Le modèle local retenu ne tient pas une sortie structurée sur cent lignes : le dire
    // vaut mieux que laisser découvrir une réponse illisible.
    app.copilotProvider = 'ollama'
    await correctPdfPage(demande())
    expect(pdfCorrection.current?.phase).toBe('config')
    expect(pdfCorrection.current?.error).toMatch(/cloud/i)
    expect(moteur.appels).toBe(0)
  })

  it('ne démarre pas sur une consigne vide, ni sur une page sans ligne', async () => {
    await correctPdfPage({ ...demande(), instruction: '   ' })
    expect(pdfCorrection.current).toBeNull()
    await correctPdfPage({ ...demande(), lines: [] })
    expect(pdfCorrection.current).toBeNull()
    expect(moteur.appels).toBe(0)
  })

  it('ne démarre pas si une génération est déjà en cours — le contrôleur est PARTAGÉ', async () => {
    copilot.generating = true
    await correctPdfPage(demande())
    expect(pdfCorrection.current).toBeNull()
    expect(moteur.appels).toBe(0)
  })

  it('porte le jeton et la liste soumise DANS le run', async () => {
    // Un index n'a de sens que par rapport à la liste qui l'a produit : les deux doivent
    // voyager ensemble, sinon un remontage de la modale le fait planter.
    await correctPdfPage(demande())
    expect(pdfCorrection.current?.path).toBe('C:\\doc.pdf')
    expect(pdfCorrection.current?.page).toBe(5)
    expect(pdfCorrection.current?.revision).toBe(0)
    expect(pdfCorrection.current?.targets).toEqual(CIBLES)
  })

  it('rend les corrections validées, et RELÂCHE le drapeau de génération', async () => {
    moteur.reponse = '{"edits":[{"i":"L2","find":"2025","to":"2026"}]}'
    await correctPdfPage(demande())
    expect(pdfCorrection.current?.phase).toBe('ready')
    expect(pdfCorrection.current?.edits).toHaveLength(1)
    expect(pdfCorrection.current?.edits[0].lineAfter).toBe('Rapport 2026')
    // Sans cela, le chat et la reformulation resteraient bloqués pour toute la session.
    expect(copilot.generating).toBe(false)
  })

  it('TRANSMET la géométrie complète au parseur — une voisine non soumise borne quand même', async () => {
    // Le correctif central de la deuxième revue : la place libre se mesure contre TOUTES
    // les lignes de la page, y compris celles qu'on ne peut pas modifier et qui ne sont
    // donc jamais soumises au modèle. Sans ce câblage, la borne repart à la marge de page
    // et l'élargissement passe.
    const cellule = ligne('Matériel', 0.1, 0.15)
    const voisineNonSoumise = ligne('Total HT', 0.32, 0.2)
    const reponse = '{"edits":[{"i":"L1","find":"Matériel","to":"Matériel informatique complet"}]}'

    moteur.reponse = reponse
    await correctPdfPage({
      ...demande(),
      lines: [cellule],
      geometry: [{ ...cellule }, voisineNonSoumise],
      targets: [{ page: 5, occurrence: 0, text: cellule.text }],
    })
    expect(pdfCorrection.current?.edits).toEqual([])
    expect(pdfCorrection.current?.dropped[0].reason).toBe('trop large pour la place disponible sur la ligne')

    // Sans la voisine, la même proposition passe — c'est bien la géométrie qui décide.
    cancelPdfCorrection()
    moteur.reponse = reponse
    await correctPdfPage({
      ...demande(),
      lines: [cellule],
      geometry: [{ ...cellule }],
      targets: [{ page: 5, occurrence: 0, text: cellule.text }],
    })
    expect(pdfCorrection.current?.edits).toHaveLength(1)
  })

  it('envoie la consigne NORMALISÉE et les lignes numérotées au modèle', async () => {
    await correctPdfPage(demande('  corrige   les \n fautes  '))
    expect(moteur.dernierPrompt).toContain('corrige les fautes')
    expect(moteur.dernierPrompt).toContain('L1 "Le chiffre d\'affaire du trimestre"')
  })

  it('une réponse illisible donne un run PRÊT et vide, jamais une erreur', async () => {
    // Le contrat du parseur remonte jusqu'ici : rien ne casse sur une réponse malformée.
    moteur.reponse = 'désolé, je ne peux pas'
    await correctPdfPage(demande())
    expect(pdfCorrection.current?.phase).toBe('ready')
    expect(pdfCorrection.current?.edits).toEqual([])
    expect(copilot.generating).toBe(false)
  })

  it('une génération qui échoue laisse une erreur lisible et rend la main', async () => {
    moteur.reponse = () => Promise.reject(new Error('réseau'))
    await correctPdfPage(demande())
    expect(pdfCorrection.current?.phase).toBe('error')
    expect(pdfCorrection.current?.error).toBeTruthy()
    expect(copilot.generating).toBe(false)
  })
})

describe('cancelPdfCorrection', () => {
  it('écarte le run — sans elle, une proposition survivrait à la fermeture de la modale', async () => {
    await correctPdfPage(demande())
    expect(pdfCorrection.current).not.toBeNull()
    cancelPdfCorrection()
    expect(pdfCorrection.current).toBeNull()
  })

  it('ne fait rien quand il n’y a rien à écarter', () => {
    pdfCorrection.current = null
    expect(() => cancelPdfCorrection()).not.toThrow()
  })
})
