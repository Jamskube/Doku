// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  assertBgraphQuality,
  buildBgraphCorrectionPrompt,
  diagramTitle,
  extractBgraphSource,
  inspectBgraphQuality,
  sanitizeBgraphSvg,
} from './bgraph'
import { DIAGRAM_GENRES } from './diagram-studio'

interface TestBgraphApi {
  memory: WebAssembly.Memory
  bgraph_examples(): number
  bgraph_alloc(length: number): number
  bgraph_free(pointer: number, length: number): void
  bgraph_render(pointer: number, length: number): number
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
