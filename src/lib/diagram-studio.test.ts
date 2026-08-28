import { describe, expect, it } from 'vitest'
import {
  DIAGRAM_GENRES,
  buildDiagramStudioPlannerPrompt,
  parseDiagramCriticVerdict,
  parseDiagramStudioPlan,
  parsePersistedDiagramStudio,
} from './diagram-studio'

const planOutput = `<diagram-plan>{
  "brief": {
    "objective": "Expliquer l'architecture de licence",
    "keyQuestion": "Qui porte quelle responsabilité ?",
    "desiredInsight": "Rendre visible la chaîne de confiance",
    "facts": ["Le Registry est la source de vérité"],
    "entities": ["Console", "Registry", "Issuer", "Product"],
    "relations": ["Console administre Registry", "Issuer signe pour Product"],
    "measures": [],
    "events": []
  },
  "candidates": [
    {"genre":"block","thesis":"Responsabilités et dépendances","keeps":["composants"],"omits":["chronologie"],"layout":"services groupés"},
    {"genre":"sequence","thesis":"Circulation d'une licence","keeps":["échanges"],"omits":["stockage détaillé"],"layout":"acteurs de gauche à droite"}
  ]
}</diagram-plan>`

describe('diagram studio planning', () => {
  it('covers every embedded bgraph genre with a human profile', () => {
    expect(DIAGRAM_GENRES).toHaveLength(30)
    expect(new Set(DIAGRAM_GENRES.map((profile) => profile.genre)).size).toBe(30)
  })

  it('parses a bounded plan and derives trusted labels and kinds', () => {
    const plan = parseDiagramStudioPlan(planOutput)
    expect(plan?.candidates).toHaveLength(2)
    expect(plan?.candidates[0]).toMatchObject({ genre: 'block', kind: 'architecture', label: 'Architecture des composants' })
    expect(plan?.candidates[1]).toMatchObject({ genre: 'sequence', kind: 'sequence', label: 'Échanges entre acteurs' })
  })

  it('refuses unknown genres and invalid critic selections', () => {
    expect(parseDiagramStudioPlan(planOutput.replace('"block"', '"unknown"'))).toBeNull()
    expect(parseDiagramCriticVerdict(
      '<diagram-verdict>{"selectedCandidateId":"other","rationale":"Bien","refine":false,"feedback":""}</diagram-verdict>',
      ['block-1'],
    )).toBeNull()
  })

  it('keeps model-facing confidence out of the contract', () => {
    const prompt = buildDiagramStudioPlannerPrompt('Montre la licence')
    expect(prompt).not.toContain('confidence')
    expect(prompt).toContain('block:')
    expect(prompt).toContain('bytefield:')
  })

  it('anchors a modification to the selected persisted view', () => {
    const plan = parseDiagramStudioPlan(planOutput)!
    const previous = {
      version: 1 as const,
      brief: plan.brief,
      candidates: plan.candidates.map((candidate) => ({
        ...candidate,
        source: 'node a "A" at (0, 0)',
        width: 320,
        height: 180,
        aspectRatio: 320 / 180,
      })),
      selectedCandidateId: plan.candidates[1].id,
      rationale: 'Cette vue suit les échanges.',
    }
    const prompt = buildDiagramStudioPlannerPrompt('Ajoute le client', previous)
    expect(prompt).toContain('DIAGRAMME À MODIFIER')
    expect(prompt).toContain('sequence-2')
    expect(prompt).toContain('conserve sa thèse et son genre')
  })

  it('round-trips a persisted studio artifact', () => {
    const plan = parseDiagramStudioPlan(planOutput)!
    const studio = {
      version: 1 as const,
      brief: plan.brief,
      candidates: plan.candidates.map((candidate) => ({
        ...candidate,
        source: 'node a "A" at (0, 0)',
        width: 320,
        height: 180,
        aspectRatio: 320 / 180,
      })),
      selectedCandidateId: plan.candidates[0].id,
      rationale: 'Cette vue montre les responsabilités.',
    }
    expect(parsePersistedDiagramStudio(JSON.parse(JSON.stringify(studio)))).toEqual(studio)
  })
})
