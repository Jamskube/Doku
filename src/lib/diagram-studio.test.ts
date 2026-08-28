import { describe, expect, it } from 'vitest'
import {
  DIAGRAM_GENRES,
  buildDiagramCriticPrompt,
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
    // Le catalogue soumis couvre bien plusieurs familles — mais plus les genres
    // retirés, voir « offered genre catalogue ».
    expect(prompt).toContain('treeview:')
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

describe('critic prompt', () => {
  const plan = {
    version: 1 as const,
    brief: {
      objective: 'o', keyQuestion: 'q', desiredInsight: 'i',
      facts: [], entities: [], relations: [], measures: [], events: [],
    },
    candidates: [],
  }
  const candidate = (id: string, genre: string, defects?: string[]) => ({
    id, genre, kind: 'architecture' as const, label: 'L', thesis: 't',
    keeps: [], omits: [], layout: 'l', source: 's', width: 800, height: 500, aspectRatio: 1.6,
    ...(defects ? { defects } : {}),
  })

  it('tells the critic which views are actually messy', () => {
    const prompt = buildDiagramCriticPrompt(plan, [
      candidate('block-1', 'block', ['overlapping-boxes', 'overlapping-labels']),
      candidate('sequence-2', 'sequence'),
    ])
    expect(prompt).toContain('overlapping-boxes')
    expect(prompt).toContain('choisis TOUJOURS la vue sans défaut')
  })

  it('stays silent when nothing was measured', () => {
    // Sans défaut mesuré, la consigne n'a pas lieu d'être : elle ferait douter le
    // critique de vues qui vont bien.
    const prompt = buildDiagramCriticPrompt(plan, [candidate('a', 'block'), candidate('b', 'sequence')])
    expect(prompt).not.toContain('choisis TOUJOURS la vue sans défaut')
  })
})

describe('offered genre catalogue', () => {
  it('keeps every engine genre parsable while offering only the documentary ones', () => {
    expect(DIAGRAM_GENRES).toHaveLength(30)
    const withheld = DIAGRAM_GENRES.filter((profile) => !profile.offered).map((profile) => profile.genre)
    // Matériel et outillage de développement : un copilote documentaire n'a
    // pratiquement aucune chance de les employer à bon escient.
    expect(withheld.sort()).toEqual(['bytefield', 'gitgraph', 'harness', 'packet', 'rack', 'wave'])
  })

  it('does not show a withheld genre to the model', () => {
    const prompt = buildDiagramStudioPlannerPrompt('Explique le protocole')
    expect(prompt).toContain('- block:')
    expect(prompt).not.toContain('- bytefield:')
    expect(prompt).not.toContain('- rack:')
  })

  it('refuses a withheld genre in a fresh plan but restores one from an archive', () => {
    const withheldPlan = `<diagram-plan>{
      "brief": {"objective":"o","keyQuestion":"q","desiredInsight":"i"},
      "candidates": [
        {"genre":"rack","thesis":"t","keeps":[],"omits":[],"layout":"l"},
        {"genre":"block","thesis":"t","keeps":[],"omits":[],"layout":"l"},
        {"genre":"sequence","thesis":"t","keeps":[],"omits":[],"layout":"l"}
      ]
    }</diagram-plan>`
    expect(parseDiagramStudioPlan(withheldPlan)?.candidates.map((c) => c.genre)).toEqual(['block', 'sequence'])

    // Une discussion antérieure au retrait doit encore s'ouvrir.
    const archived = parsePersistedDiagramStudio({
      version: 1,
      brief: { objective: 'o', keyQuestion: 'q', desiredInsight: 'i' },
      candidates: [{ id: 'rack-1', genre: 'rack', thesis: 't', layout: 'l', source: 'type rack {}', width: 100, height: 80 }],
      selectedCandidateId: 'rack-1',
      rationale: 'r',
    })
    expect(archived?.candidates[0].genre).toBe('rack')
  })
})
