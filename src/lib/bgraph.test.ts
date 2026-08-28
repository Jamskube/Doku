// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  assertBgraphQuality,
  buildBgraphCorrectionPrompt,
  diagramTitle,
  extractBgraphSource,
  applyLabelOffsets,
  inspectBgraphGeometry,
  MAX_GEOMETRY_REPAIR_PASSES,
  planLabelOffsets,
  inspectBgraphQuality,
  sanitizeBgraphSvg,
  type BgraphLayout,
  type BgraphRect,
} from './bgraph'
import { DIAGRAM_GENRES } from './diagram-studio'

interface TestBgraphApi {
  memory: WebAssembly.Memory
  bgraph_examples(): number
  bgraph_alloc(length: number): number
  bgraph_free(pointer: number, length: number): void
  bgraph_render(pointer: number, length: number): number
  bgraph_check(pointer: number, length: number): number
  bgraph_result_len(): number
}

const decoder = new TextDecoder()
const encoder = new TextEncoder()
let embeddedApi: Promise<TestBgraphApi> | null = null

async function bgraphApi(): Promise<TestBgraphApi> {
  if (!embeddedApi) {
    embeddedApi = WebAssembly.instantiate(readFileSync('public/bgraph.wasm'), {})
      .then(({ instance }) => instance.exports as unknown as TestBgraphApi)
  }
  return embeddedApi
}

function readResult(api: TestBgraphApi, pointer: number): string {
  return decoder.decode(new Uint8Array(api.memory.buffer, pointer, api.bgraph_result_len()))
}

async function renderEmbedded(source: string): Promise<string> {
  const api = await bgraphApi()
  const bytes = encoder.encode(source)
  const pointer = api.bgraph_alloc(bytes.length)
  new Uint8Array(api.memory.buffer, pointer, bytes.length).set(bytes)
  const renderedPointer = api.bgraph_render(pointer, bytes.length)
  const svg = readResult(api, renderedPointer)
  api.bgraph_free(pointer, bytes.length)
  if (!svg.startsWith('<svg')) throw new Error(svg)
  return sanitizeBgraphSvg(svg)
}

describe('extractBgraphSource', () => {
  it('extracts the private envelope without exposing surrounding prose', () => {
    expect(extractBgraphSource('Avant\n<bgraph>\nnode a "A" at (0, 0)\n</bgraph>\nAprès'))
      .toBe('node a "A" at (0, 0)')
  })

  it('accepts a fenced fallback and refuses an unstructured answer', () => {
    expect(extractBgraphSource('```bgraph\nnode a "A" at (0, 0)\n```')).toBe('node a "A" at (0, 0)')
    expect(extractBgraphSource('Voici votre diagramme.')).toBeNull()
  })
})

describe('sanitizeBgraphSvg', () => {
  it('keeps the explicit bgraph SVG vocabulary', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" role="img" aria-label="Test"><title>Test</title><defs><marker id="arrow" markerWidth="4" markerHeight="4" refX="2" refY="2" orient="auto"><path d="M0 0 L4 2 L0 4" fill="#000"/></marker></defs><line x1="0" y1="0" x2="10" y2="10" stroke="#000" marker-end="url(#arrow)"/><text x="1" y="5">A</text></svg>'
    expect(sanitizeBgraphSvg(svg)).toContain('marker-end="url(#arrow)"')
  })

  it('rejects active content and external resources', () => {
    expect(() => sanitizeBgraphSvg('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')).toThrow('Élément SVG interdit')
    expect(() => sanitizeBgraphSvg('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0" fill="url(https://evil.test/x)"/></svg>')).toThrow('URL interdite')
  })
})

it('keeps correction diagnostics and derives a compact title', () => {
  expect(buildBgraphCorrectionPrompt('node', [{ severity: 'error', line: 2, col: 4, message: 'inconnu' }]))
    .toContain('ligne 2, colonne 4 : inconnu')
  expect(diagramTitle('Fais-moi un diagramme de l’architecture de Doku')).toBe('Un diagramme de l’architecture de Doku')
})

describe('diagram quality gate', () => {
  const licenceChain = `graph { background: #ffffff padding: 30 gap: 54 }
style node { fill: #f4f1e9 stroke: #8c877d 1.2 font: 13 #1c1a16 radius: 8 padding: 14 }
node product "Product : collecte, vérifie et installe la licence [3][5]"
node admin "Administration : gère les droits et lance les émissions offline [3]"
node registry "Registry : source de vérité des contrats, droits, allocations, clients et appareils [3][4]"
node issuer "Issuer : construit, signe et trace les licences [3][4]"
node storage "Stockage : état du Registry et historique append-only des émissions [4]"
node online "Online : renouvellement automatique [2][5][8]"
product -> online
online -> issuer
admin -> issuer
issuer -> registry
registry -> storage`

  it('rejects the real one-line architecture regression', async () => {
    const svg = await renderEmbedded(licenceChain)
    const codes = inspectBgraphQuality(licenceChain, svg).map((issue) => issue.code)
    expect(codes).toContain('implicit-horizontal-flow')
    expect(codes).toContain('extreme-aspect-ratio')
    expect(codes).toContain('overlong-labels')
    expect(codes).toContain('citation-markers')
    expect(() => assertBgraphQuality(licenceChain, svg)).toThrow('flux horizontal implicite')
  })

  it('accepts a compact grouped architecture', async () => {
    const architecture = `type block { title: "Architecture de licence" }
graph { background: #ffffff padding: 34 gap: 58 }
block console "Console" person at (0, 0) { description: "Saisit les droits et les allocations." }
group coeur "Services de licence" right-of console gap 72 {
  block registry "Registry" database at (0, 0) { description: "Conserve les droits de référence." }
  block issuer "Issuer" component below registry gap 52 { description: "Signe les fichiers de licence." }
  block stockage "Historique" database right-of registry gap 90 { description: "Trace les émissions." }
}
block produit "Product" container right-of issuer gap 72 { description: "Vérifie et installe la licence." }
console -> registry "administre"
registry -> issuer "autorise"
issuer -> produit "émet"
registry -> stockage "journalise"`
    const svg = await renderEmbedded(architecture)
    expect(inspectBgraphQuality(architecture, svg)).toEqual([])
  })
})

it('renders and sanitizes every archetype shipped by the embedded WASM', async () => {
  const api = await bgraphApi()
  const examplesPointer = api.bgraph_examples()
  const examples = JSON.parse(readResult(api, examplesPointer)) as { name: string; source: string }[]
  expect(examples).toHaveLength(30)
  expect(examples.map((example) => example.name).sort())
    .toEqual(DIAGRAM_GENRES.map((profile) => profile.genre).sort())
  for (const example of examples) {
    const source = encoder.encode(example.source)
    const pointer = api.bgraph_alloc(source.length)
    new Uint8Array(api.memory.buffer, pointer, source.length).set(source)
    const renderedPointer = api.bgraph_render(pointer, source.length)
    const svg = readResult(api, renderedPointer)
    api.bgraph_free(pointer, source.length)
    expect(svg, example.name).toMatch(/^<svg/)
    expect(() => sanitizeBgraphSvg(svg), example.name).not.toThrow()
  }
})

// Sources extraites de discussions Doku réelles à l'étape 0 du plan
// `docs/plans/diagrammes-qualite.md`. Voir leur README pour le défaut attendu
// de chacune.
const FIXTURES = [
  '1d2a8c88-block-1.bd',
  'a759fb64-block-1.bd',
  'ffc8c76b-block-1.bd',
  '1d2a8c88-state-3.bd',
  'a759fb64-bpmn-2.bd',
  '1d2a8c88-network-1.bd',
  'a759fb64-gantt-1.bd',
] as const

function fixture(name: string): string {
  return readFileSync(`src/lib/__fixtures__/diagrammes/${name}`, 'utf8')
}

async function checkEmbedded(source: string): Promise<{ severity: string; message: string }[]> {
  const api = await bgraphApi()
  const bytes = encoder.encode(source)
  const pointer = api.bgraph_alloc(bytes.length)
  new Uint8Array(api.memory.buffer, pointer, bytes.length).set(bytes)
  const raw = readResult(api, api.bgraph_check(pointer, bytes.length))
  api.bgraph_free(pointer, bytes.length)
  return JSON.parse(raw) as { severity: string; message: string }[]
}

it('renders and sanitizes every diagram taken from a real discussion', async () => {
  for (const name of FIXTURES) {
    const svg = await renderEmbedded(fixture(name))
    expect(svg, name).toMatch(/^<svg/)
    expect(() => sanitizeBgraphSvg(svg), name).not.toThrow()
  }
})

it('sees no hidden label: the WASM check stops before the geometry pass', async () => {
  // `bgraph check` en CLI signale 3, 5 et 2 libellés d'arête peints sous une
  // boîte sur ces trois vues — celles que l'utilisateur avait sélectionnées.
  // `bgraph_check` n'expose que les diagnostics d'avant la mise en page, donc il
  // n'en voit aucun. Ce test fige l'écart que l'étape 3 du plan doit fermer :
  // quand la passe géométrique sera exportée, il devra être mis à jour.
  for (const name of ['1d2a8c88-block-1.bd', 'a759fb64-block-1.bd', 'ffc8c76b-block-1.bd']) {
    expect(await checkEmbedded(fixture(name)), name).toEqual([])
  }
})

it('reports nothing on the two clean fixtures either', async () => {
  for (const name of ['1d2a8c88-network-1.bd', 'a759fb64-gantt-1.bd']) {
    const source = fixture(name)
    expect(await checkEmbedded(source), name).toEqual([])
    expect(inspectBgraphQuality(source, await renderEmbedded(source)), name).toEqual([])
  }
})

async function layoutEmbedded(source: string): Promise<BgraphLayout> {
  const api = await bgraphApi() as TestBgraphApi & { bgraph_layout(p: number, l: number): number }
  const bytes = encoder.encode(source)
  const pointer = api.bgraph_alloc(bytes.length)
  new Uint8Array(api.memory.buffer, pointer, bytes.length).set(bytes)
  // Relire `memory.buffer` APRÈS l'appel : la mise en page est plus volumineuse
  // que la source, la mémoire grandit, et l'ancien tampon se détache.
  const raw = readResult(api, api.bgraph_layout(pointer, bytes.length))
  api.bgraph_free(pointer, bytes.length)
  const parsed = JSON.parse(raw) as Record<string, unknown>
  const boxes = (value: unknown) => (value as { id: string; label: string[]; rect: BgraphRect }[])
  return {
    canvas: parsed.canvas as { width: number; height: number },
    groups: boxes(parsed.groups),
    nodes: boxes(parsed.nodes),
    edges: (parsed.edges as Record<string, unknown>[]).map((edge) => ({
      from: (edge.from ?? null) as string | null,
      to: (edge.to ?? null) as string | null,
      label: (edge.label ?? null) as string | null,
      labelRect: (edge.label_rect ?? null) as BgraphRect | null,
      points: (edge.points ?? []) as [number, number][],
    })),
    annotations: parsed.annotations as { text: string; size: number; x: number; y: number }[],
  }
}

describe('inspectBgraphGeometry', () => {
  it('names the hidden edge labels of the views the user had selected', async () => {
    // Les trois vues `block` retenues en discussion. `bgraph check` en CLI y
    // signale respectivement 3, 5 et 2 libellés peints sous une boîte.
    for (const name of ['1d2a8c88-block-1.bd', 'a759fb64-block-1.bd', 'ffc8c76b-block-1.bd']) {
      const source = fixture(name)
      const issues = inspectBgraphGeometry(source, await layoutEmbedded(source))
      const hidden = issues.find((issue) => issue.code === 'hidden-edge-label')
      expect(hidden, name).toBeDefined()
      expect(hidden?.message, name).toContain('label-offset')
    }
  })

  it('stays silent on the two clean fixtures', async () => {
    for (const name of ['1d2a8c88-network-1.bd', 'a759fb64-gantt-1.bd']) {
      const source = fixture(name)
      expect(inspectBgraphGeometry(source, await layoutEmbedded(source)), name).toEqual([])
    }
  })

  it('separates a deliberate attachment from a real superposition', () => {
    const pair = (offset: number): BgraphLayout => ({
      canvas: { width: 600, height: 400 },
      groups: [],
      nodes: [
        { id: 'a', label: ['Alpha'], rect: { x: 0, y: 0, w: 120, h: 60 } },
        { id: 'b', label: ['Bêta'], rect: { x: offset, y: 0, w: 120, h: 60 } },
      ],
      edges: [],
      annotations: [],
    })
    // Mesuré sur les recettes : l'événement attaché d'un `bpmn` mord la moitié de
    // sa tâche, motif voulu. Une boîte posée à 10 px d'une autre ne l'est pas.
    expect(inspectBgraphGeometry('type bpmn { title: "T" }', pair(60))).toEqual([])
    expect(inspectBgraphGeometry('type bpmn { title: "T" }', pair(10)).map((i) => i.code))
      .toEqual(['overlapping-boxes'])
    // Un venn se chevauche par construction : le recouvrement y est le propos.
    expect(inspectBgraphGeometry('type venn { title: "T" }', pair(10))).toEqual([])
  })

  it('estimates the width of free text, which the layout does not give', () => {
    const layout: BgraphLayout = {
      canvas: { width: 600, height: 400 },
      groups: [],
      nodes: [],
      edges: [],
      annotations: [
        { text: 'Renouvellement dû', size: 10, x: 200, y: 100 },
        { text: 'Service indisponible', size: 10, x: 210, y: 102 },
        { text: 'Ailleurs', size: 10, x: 500, y: 300 },
      ],
    }
    const issues = inspectBgraphGeometry('type bpmn { title: "T" }', layout)
    expect(issues.map((issue) => issue.code)).toEqual(['overlapping-text'])
    expect(issues[0].message).toContain('Renouvellement dû')
    expect(issues[0].message).not.toContain('Ailleurs')
  })

})

it('flags none of the 30 official recipes', async () => {
  // La garde de composition la plus dangereuse est celle qui refuse tout. Les
  // recettes du moteur sont ce que Doku donne au modèle comme modèle à suivre :
  // si elles ne passent pas, aucune génération ne passe.
  const api = await bgraphApi()
  const examples = JSON.parse(readResult(api, api.bgraph_examples())) as { name: string; source: string }[]
  for (const example of examples) {
    const issues = inspectBgraphGeometry(example.source, await layoutEmbedded(example.source))
    expect(issues.map((issue) => issue.code), example.name).toEqual([])
  }
})

it('sees the box collisions that the engine diagnostics cannot', async () => {
  // `after_layout` ne connaît que les libellés d'arête, les waypoints et les
  // routes ortho — pas le recouvrement de deux boîtes ni le débordement d'un
  // cadre de groupe. La mise en page nommée, elle, les donne.
  const source = fixture('1d2a8c88-block-1.bd')
  const codes = inspectBgraphGeometry(source, await layoutEmbedded(source)).map((issue) => issue.code)
  expect(codes).toContain('overlapping-boxes')
  expect(codes).toContain('overlapping-text')
  expect(codes).toContain('edge-crosses-box')
})

it('sees the crossings the engine reports only for ortho routes', async () => {
  // `after_layout` ignore toute arête dont le routeur n'est pas `ortho`. La route
  // étant donnée telle que dessinée, coudes compris, Doku la teste sans se soucier
  // du routeur — et l'annonce en nommant la boîte traversée.
  const source = fixture('a759fb64-bpmn-2.bd')
  const issue = inspectBgraphGeometry(source, await layoutEmbedded(source))
    .find((candidate) => candidate.code === 'edge-crosses-box')
  expect(issue).toBeDefined()
  expect(issue?.message).toContain('router: straight')
})

async function repairEmbedded(source: string): Promise<string> {
  let current = source
  for (let pass = 0; pass < MAX_GEOMETRY_REPAIR_PASSES; pass += 1) {
    const next = applyLabelOffsets(current, planLabelOffsets(await layoutEmbedded(current)))
    if (!next || next === current) break
    current = next
  }
  return current
}

async function hiddenLabelCount(source: string): Promise<number> {
  const issue = inspectBgraphGeometry(source, await layoutEmbedded(source))
    .find((candidate) => candidate.code === 'hidden-edge-label')
  return issue ? Number(issue.message.match(/^(\d+)/)?.[1] ?? 0) : 0
}

describe('deterministic label repair', () => {
  it('clears every hidden label of every real source, without asking the model', async () => {
    // Le moteur refuse de réparer — élargir un écart déplacerait une boîte, ce que
    // sa règle de conception lui interdit — mais `label-offset` ne bouge que le
    // texte, et la mise en page donne les deux rectangles. Sur les vues issues de
    // discussions réelles, cela suffit à tout dégager.
    let before = 0
    let after = 0
    for (const name of FIXTURES) {
      const source = fixture(name)
      before += await hiddenLabelCount(source)
      after += await hiddenLabelCount(await repairEmbedded(source))
    }
    expect(before).toBeGreaterThanOrEqual(15)
    expect(after).toBe(0)
  })

  it('keeps a repair from making things worse', async () => {
    // Déplacer un libellé fait suivre le canevas : une passe peut en découvrir
    // une autre, mais aucune ne doit dégrader ce qui allait bien.
    for (const name of FIXTURES) {
      const source = fixture(name)
      const before = inspectBgraphGeometry(source, await layoutEmbedded(source)).length
      const repaired = await repairEmbedded(source)
      const after = inspectBgraphGeometry(repaired, await layoutEmbedded(repaired)).length
      expect(after, name).toBeLessThanOrEqual(before)
    }
  })

  it('rewrites the edge statement without disturbing the rest', () => {
    const offsets = [{ from: 'a', to: 'b', dx: -30, dy: 12 }]
    expect(applyLabelOffsets('a -> b "vers"', offsets)).toBe('a -> b "vers" { label-offset: -30 12 }')
    expect(applyLabelOffsets('a -> b "vers" { tech: "HTTP" }', offsets))
      .toBe('a -> b "vers" { tech: "HTTP" label-offset: -30 12 }')
    // Un déplacement déjà posé s'additionne, sinon une seconde passe ne peut rien affiner.
    expect(applyLabelOffsets('a -> b "vers" { label-offset: 10 -4 }', offsets))
      .toBe('a -> b "vers" { label-offset: -20 8 }')
  })

  it('refuses to rewrite what it cannot rewrite safely', () => {
    const offsets = [{ from: 'a', to: 'b', dx: 5, dy: 5 }]
    // Bloc étalé sur plusieurs lignes, et commentaire de fin de ligne.
    expect(applyLabelOffsets('a -> b "vers" {\n  tech: "HTTP"\n}', offsets)).toBeNull()
    expect(applyLabelOffsets('a -> b "vers" // à revoir', offsets)).toBeNull()
    // Une arête absente ne fabrique pas de ligne.
    expect(applyLabelOffsets('a -> c "vers"', offsets)).toBeNull()
    expect(applyLabelOffsets('a -> b "vers"', [])).toBeNull()
  })

  it('plans nothing for the official recipes', async () => {
    const api = await bgraphApi()
    const examples = JSON.parse(readResult(api, api.bgraph_examples())) as { name: string; source: string }[]
    for (const example of examples) {
      expect(planLabelOffsets(await layoutEmbedded(example.source)), example.name).toEqual([])
    }
  })
  it('clears the labels that overlap each other, not only those under a box', async () => {
    // Le moteur écarte les libellés des traits, pas les uns des autres — sa propre
    // note de conception le dit. Deux textes superposés se lisent comme un mot
    // coupé en deux, et le même `label-offset` les sépare.
    const tangled = ['1d2a8c88-block-1.bd', '1d2a8c88-state-3.bd']
    for (const name of tangled) {
      const source = fixture(name)
      const before = inspectBgraphGeometry(source, await layoutEmbedded(source))
      expect(before.map((issue) => issue.code), name).toContain('overlapping-labels')
      const repaired = await repairEmbedded(source)
      const after = inspectBgraphGeometry(repaired, await layoutEmbedded(repaired))
      expect(after.map((issue) => issue.code), name).not.toContain('overlapping-labels')
    }
  })
  it('moves one of two labels that collide, not both away from each other', () => {
    // Planifiés depuis le même instantané, deux libellés qui se gênent se fuient
    // mutuellement et se retrouvent superposés ailleurs. Le second doit voir où le
    // premier est parti.
    const layout: BgraphLayout = {
      canvas: { width: 600, height: 400 },
      groups: [],
      nodes: [{ id: 'a', label: ['A'], rect: { x: 0, y: 0, w: 40, h: 40 } }],
      edges: [
        {
          from: 'a', to: 'b', label: 'un', points: [[200, 100], [400, 100]],
          labelRect: { x: 280, y: 90, w: 60, h: 20 },
        },
        {
          from: 'c', to: 'd', label: 'deux', points: [[200, 105], [400, 105]],
          labelRect: { x: 290, y: 95, w: 60, h: 20 },
        },
      ],
      annotations: [],
    }
    const plans = planLabelOffsets(layout)
    expect(plans).toHaveLength(1)
    expect(plans[0]).toMatchObject({ from: 'a', to: 'b' })
  })
})

describe('SVG allowlist and the engine output', () => {
  it('accepts the drop shadow the engine emits for `shadow: on`', () => {
    // `shadow` est une propriété documentée qu'un modèle peut inventer. Le filtre
    // est inerte — ni script, ni ressource externe — et le refuser produisait un
    // rejet dur que la boucle de correction ne savait pas résoudre.
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><filter id="bg-shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-opacity="0.18"/></filter></defs><rect x="1" y="1" width="4" height="4" fill="#eee" stroke="#33415580" stroke-opacity="0.5" filter="url(#bg-shadow)"/></svg>'
    expect(() => sanitizeBgraphSvg(svg)).not.toThrow()
    expect(sanitizeBgraphSvg(svg)).toContain('filter="url(#bg-shadow)"')
  })

  it('still refuses an external reference inside a filter', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="1" height="1" filter="url(https://evil.test/x)"/></svg>'
    expect(() => sanitizeBgraphSvg(svg)).toThrow('URL interdite')
  })
})
